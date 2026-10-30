import type { Db } from '@gestao/database';
import {
  RUN_STATUS_LABELS,
  describePeriod,
  formatDuration,
  type RunEventDTO,
  type RunStatus,
  type StartRunInput,
} from '@gestao/shared';
import type { AppContext } from '../context';
import { HttpError, conflict, notFound } from '../lib/http';
import { RUN_COLUMNS, toRun, toRunCompany } from '../lib/mappers';
import { AGENT_OFFLINE_MESSAGE, enqueueJob, getAgentStatus } from './agent';
import { audit } from './audit';
import { emailNotificationsEnabled, notifyAllActive } from './notifications';

export async function getRunEvent(db: Db, runId: number): Promise<RunEventDTO> {
  const { rows } = await db.query(`SELECT ${RUN_COLUMNS} FROM import_runs r WHERE r.id = $1`, [runId]);
  if (!rows[0]) throw notFound('Execução não encontrada.');
  const companies = await db.query(
    `SELECT irc.*, c.corporate_name AS company_name, c.folder_name
       FROM import_run_companies irc JOIN companies c ON c.id = irc.company_id
      WHERE irc.run_id = $1 ORDER BY c.corporate_name`,
    [runId],
  );
  return { run: toRun(rows[0]), companies: companies.rows.map(toRunCompany) };
}

/** Empresas que entram na pesquisa. Empresas inativas nunca entram em lote automático. */
export async function resolveRunCompanies(db: Db, input: StartRunInput) {
  if (input.scope === 'ALL' || input.scope === 'ACTIVE') {
    const { rows } = await db.query<{ id: number; folder_name: string; corporate_name: string }>(
      `SELECT id, folder_name, corporate_name FROM companies
        WHERE deleted_at IS NULL AND status = 'ACTIVE' ORDER BY corporate_name`,
    );
    return rows;
  }
  const { rows } = await db.query<{ id: number; folder_name: string; corporate_name: string }>(
    `SELECT id, folder_name, corporate_name FROM companies
      WHERE deleted_at IS NULL AND id = ANY($1::int[]) ORDER BY corporate_name`,
    [input.companyIds],
  );
  if (rows.length !== new Set(input.companyIds).size) {
    throw new HttpError(400, 'Uma ou mais empresas selecionadas não existem mais.');
  }
  return rows;
}

export async function startRun(ctx: AppContext, userId: number, input: StartRunInput, req?: Parameters<typeof audit>[1]['req']) {
  const agent = await getAgentStatus(ctx);
  if (!agent.online) throw new HttpError(503, AGENT_OFFLINE_MESSAGE, 'AGENT_OFFLINE');

  const companies = await resolveRunCompanies(ctx.db, input);
  if (!companies.length) throw new HttpError(400, 'Nenhuma empresa ativa para pesquisar.');

  const year = input.year ?? null;
  const month = input.month ?? null;
  let runId: number;
  try {
    runId = await ctx.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number }>(
        `INSERT INTO import_runs (requested_by, scope, filters, year, month, full_rescan, total_companies)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, input.scope, JSON.stringify({ companyIds: input.companyIds }), year, month, input.fullRescan, companies.length],
      );
      const id = rows[0]!.id;
      await tx.query(
        `INSERT INTO import_run_companies (run_id, company_id) SELECT $1, unnest($2::int[])`,
        [id, companies.map((c) => c.id)],
      );
      const jobId = await enqueueJob(
        tx,
        'SCAN',
        {
          runId: id,
          year,
          month,
          fullRescan: input.fullRescan,
          companies: companies.map((c) => ({ companyId: c.id, folderName: c.folder_name, companyName: c.corporate_name })),
        },
        userId,
      );
      await tx.query('UPDATE import_runs SET job_id = $1 WHERE id = $2', [jobId, id]);
      return id;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw conflict('Já existe uma pesquisa em andamento. Aguarde a conclusão para iniciar outra.');
    }
    throw e;
  }

  await audit(ctx.db, {
    userId,
    req,
    action: 'RUN_STARTED',
    entity: 'import_run',
    entityId: runId,
    details: { scope: input.scope, companies: companies.length, period: describePeriod(year, month) },
  });
  return getRunEvent(ctx.db, runId);
}

/** Recalcula o percentual com base no que o agente realmente verificou. */
export async function recomputeProgress(db: Db, runId: number) {
  await db.query(
    `UPDATE import_runs SET
       progress = CASE
         WHEN total_files > 0 THEN LEAST(100, files_checked * 100.0 / total_files)
         WHEN total_companies > 0 THEN LEAST(100, companies_processed * 100.0 / total_companies)
         ELSE 0 END,
       updated_at = now()
     WHERE id = $1`,
    [runId],
  );
}

export async function finishRun(
  ctx: AppContext,
  runId: number,
  outcome: 'DONE' | 'FAILED' | 'CANCELLED',
  message?: string | null,
) {
  const current = await ctx.db.query<{ status: RunStatus }>('SELECT status FROM import_runs WHERE id = $1', [runId]);
  const prev = current.rows[0]?.status;
  if (!prev || !['QUEUED', 'RUNNING'].includes(prev)) return;

  await ctx.db.query(
    `UPDATE import_runs r SET
       status = CASE
         WHEN $2 = 'CANCELLED' THEN 'CANCELLED'
         WHEN $2 = 'FAILED' THEN 'FAILED'
         WHEN r.errors > 0 OR EXISTS (
           SELECT 1 FROM import_run_companies irc
            WHERE irc.run_id = r.id AND irc.status IN ('FOLDER_NOT_FOUND', 'ERROR')) THEN 'COMPLETED_WITH_ERRORS'
         ELSE 'COMPLETED' END,
       progress = CASE WHEN $2 = 'DONE' THEN 100 ELSE progress END,
       error_message = COALESCE($3, error_message),
       current_company_id = NULL,
       finished_at = now(),
       updated_at = now()
     WHERE r.id = $1`,
    [runId, outcome, message ?? null],
  );
  await ctx.db.query(
    `UPDATE import_run_companies SET status = CASE WHEN $2 = 'CANCELLED' THEN 'CANCELLED' ELSE 'ERROR' END,
            message = COALESCE(message, CASE WHEN $2 = 'CANCELLED' THEN 'Pesquisa cancelada' ELSE 'Não processada' END)
      WHERE run_id = $1 AND status IN ('PENDING', 'RUNNING') AND $2 <> 'DONE'`,
    [runId, outcome],
  );
  await ctx.db.query(
    `UPDATE agent_jobs SET status = $2, finished_at = now()
      WHERE id = (SELECT job_id FROM import_runs WHERE id = $1) AND status IN ('PENDING', 'RUNNING')`,
    [runId, outcome === 'DONE' ? 'DONE' : outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED'],
  );

  const { run } = await getRunEvent(ctx.db, runId);
  const elapsed = run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : NaN;
  const summary = {
    title: `Pesquisa #${run.id} — ${RUN_STATUS_LABELS[run.status]}`,
    message:
      `Período: ${describePeriod(run.year, run.month)} · Empresas analisadas: ${run.companiesProcessed}/${run.totalCompanies} · ` +
      `Arquivos encontrados: ${run.newFiles + run.duplicates + run.errors} · Novos: ${run.newFiles} · ` +
      `Já importados: ${run.duplicates} · Erros: ${run.errors}` +
      (Number.isFinite(elapsed) ? ` · Tempo total: ${formatDuration(elapsed)}` : '') +
      (run.errorMessage ? ` · ${run.errorMessage}` : ''),
    type: run.status === 'COMPLETED' ? 'SUCCESS' : run.status === 'CANCELLED' ? 'WARNING' : run.status === 'FAILED' ? 'ERROR' : 'RUN',
    link: `/historico/${run.id}`,
  } as const;
  await notifyAllActive(ctx.db, summary);
  if (ctx.config.approvalEmail && (await emailNotificationsEnabled(ctx.db))) {
    void ctx.mail.send({
      to: ctx.config.approvalEmail,
      subject: `[REGISTROS XML-PDF] ${summary.title}`,
      text: `${summary.message.replace(/ · /g, '\n')}\n\nDetalhes: ${ctx.config.appPublicUrl}${summary.link}\n`,
    });
  }
  await audit(ctx.db, {
    userId: run.requestedBy,
    action: 'RUN_FINISHED',
    entity: 'import_run',
    entityId: run.id,
    details: {
      status: run.status,
      newFiles: run.newFiles,
      duplicates: run.duplicates,
      errors: run.errors,
      message: run.errorMessage,
    },
  });
}

/**
 * Vigia: execuções sem notícias do agente viram "Falha" (o que já foi
 * importado permanece) e jobs auxiliares travados são encerrados.
 */
export async function runWatchdog(ctx: AppContext) {
  const stale = ctx.config.agent.runStaleSeconds;
  const { rows } = await ctx.db.query<{ id: number; status: string }>(
    `SELECT id, status FROM import_runs
      WHERE status IN ('QUEUED', 'RUNNING')
        AND COALESCE(last_agent_update_at, started_at, created_at) < now() - make_interval(secs => $1)`,
    [stale],
  );
  for (const r of rows) {
    await finishRun(
      ctx,
      r.id,
      'FAILED',
      r.status === 'QUEUED'
        ? 'O agente não iniciou a pesquisa (agente offline).'
        : 'O agente parou de se comunicar durante o processamento.',
    );
  }
  const stuck = await ctx.db.query<{ id: number; type: string; payload: { reportId?: number } }>(
    `UPDATE agent_jobs SET status = 'FAILED', finished_at = now(), error_message = 'Tempo esgotado'
      WHERE type <> 'SCAN' AND status = 'RUNNING'
        AND started_at < now() - make_interval(secs => $1)
      RETURNING id, type, payload`,
    [Math.max(stale, 600)],
  );
  for (const job of stuck.rows) {
    if (job.type === 'SAVE_REPORT' && job.payload.reportId) {
      await ctx.db.query(
        `UPDATE reports SET drive_status = 'FAILED', drive_error = 'Tempo esgotado ao gravar no Drive' WHERE id = $1`,
        [job.payload.reportId],
      );
    }
  }
}
