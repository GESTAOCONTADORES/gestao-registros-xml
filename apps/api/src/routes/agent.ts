import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentJob } from '@gestao/shared';
import { HttpError, idParam, notFound, parse } from '../lib/http';
import { authenticateAgent } from '../plugins/auth';
import { notifyMasters, notifyUsers } from '../services/notifications';
import { ingestBatch } from '../services/imports';
import { finishRun, recomputeProgress } from '../services/runs';

const heartbeatSchema = z.object({
  version: z.string().max(50),
  hostname: z.string().max(200),
  rootPath: z.string().max(500),
  reportsPath: z.string().max(500),
  rootAccessible: z.boolean(),
  lastError: z.string().max(2000).nullable().optional(),
  currentJobId: z.number().int().nullable().optional(),
});

const progressSchema = z.object({
  phase: z.enum(['ENUMERATING', 'PROCESSING', 'FINISHING']),
  totalFiles: z.number().int().nonnegative().optional(),
  filesChecked: z.number().int().nonnegative().optional(),
  companiesProcessed: z.number().int().nonnegative().optional(),
  currentCompanyId: z.number().int().nullable().optional(),
  companyUpdates: z
    .array(
      z.object({
        companyId: z.number().int(),
        status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FOLDER_NOT_FOUND', 'ERROR', 'CANCELLED']),
        totalFiles: z.number().int().nonnegative().optional(),
        message: z.string().max(1000).nullable().optional(),
      }),
    )
    .max(5000)
    .optional(),
});

const completeSchema = z.object({
  status: z.enum(['DONE', 'FAILED', 'CANCELLED']),
  message: z.string().max(2000).nullable().optional(),
  result: z.record(z.unknown()).optional(),
});

const hashesSchema = z.object({ hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).max(1000) });

/**
 * Interface usada exclusivamente pelo Gestão XML Agent (AGENT_API_TOKEN).
 * O agente só faz conexões de saída para esta API; nenhuma porta é aberta no Windows.
 */
export async function agentRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const opts = { preHandler: authenticateAgent(ctx), config: { rateLimit: false as const } };

  const scanJob = async (jobId: number) => {
    const { rows } = await ctx.db.query<{ id: number; type: string; status: string; run_id: number | null }>(
      `SELECT j.id, j.type, j.status, (j.payload->>'runId')::int AS run_id FROM agent_jobs j WHERE j.id = $1`,
      [jobId],
    );
    const job = rows[0];
    if (!job) throw notFound('Job não encontrado.');
    return job;
  };

  app.post('/agent/heartbeat', opts, async (req) => {
    const body = parse(heartbeatSchema, req.body);
    await ctx.db.query(
      `INSERT INTO agent_status (agent_id, last_seen_at, version, hostname, root_path, reports_path, root_accessible, last_error, current_job_id, updated_at)
       VALUES ('default', now(), $1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (agent_id) DO UPDATE SET last_seen_at = now(), version = $1, hostname = $2, root_path = $3, reports_path = $4,
         root_accessible = $5, last_error = $6, current_job_id = $7, updated_at = now()`,
      [body.version, body.hostname, body.rootPath, body.reportsPath, body.rootAccessible, body.lastError ?? null, body.currentJobId ?? null],
    );
    // agente reiniciado no meio de um job: o job é encerrado de forma explícita
    if (!body.currentJobId) {
      const orphan = await ctx.db.query<{ id: number; type: string; run_id: number | null }>(
        `SELECT id, type, (payload->>'runId')::int AS run_id FROM agent_jobs
          WHERE status = 'RUNNING' AND started_at < now() - interval '30 seconds'`,
      );
      for (const j of orphan.rows) {
        await ctx.db.query(`UPDATE agent_jobs SET status = 'FAILED', finished_at = now(), error_message = 'Agente reiniciado' WHERE id = $1`, [j.id]);
        if (j.type === 'SCAN' && j.run_id) await finishRun(ctx, j.run_id, 'FAILED', 'O agente foi reiniciado durante o processamento.');
      }
    }
    return { ok: true, serverTime: new Date().toISOString() };
  });

  /** Entrega o próximo trabalho pendente (o mais antigo primeiro). */
  app.post('/agent/jobs/next', opts, async () => {
    const job = await ctx.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number; type: string; payload: Record<string, unknown> }>(
        `UPDATE agent_jobs SET status = 'RUNNING', started_at = now()
          WHERE id = (SELECT id FROM agent_jobs WHERE status = 'PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id, type, payload`,
      );
      const j = rows[0];
      if (j?.type === 'SCAN') {
        await tx.query(
          `UPDATE import_runs SET status = 'RUNNING', started_at = now(), last_agent_update_at = now(), updated_at = now()
            WHERE id = $1 AND status = 'QUEUED'`,
          [Number(j.payload.runId)],
        );
      }
      return j;
    });
    if (!job) return { job: null };
    return { job: { id: job.id, type: job.type, payload: job.payload } as unknown as AgentJob };
  });

  app.post('/agent/jobs/:id/progress', opts, async (req) => {
    const jobId = idParam(req);
    const job = await scanJob(jobId);
    if (job.type !== 'SCAN' || !job.run_id) throw new HttpError(400, 'Progresso só se aplica a pesquisas.');
    const body = parse(progressSchema, req.body);
    await ctx.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE import_runs SET
           total_files = COALESCE($2, total_files),
           files_checked = COALESCE($3, files_checked),
           companies_processed = COALESCE($4, companies_processed),
           current_company_id = CASE WHEN $5::boolean THEN $6 ELSE current_company_id END,
           last_agent_update_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'RUNNING'`,
        [
          job.run_id,
          body.totalFiles ?? null,
          body.filesChecked ?? null,
          body.companiesProcessed ?? null,
          body.currentCompanyId !== undefined,
          body.currentCompanyId ?? null,
        ],
      );
      for (const u of body.companyUpdates ?? []) {
        await tx.query(
          `UPDATE import_run_companies SET status = $3, total_files = COALESCE($4, total_files), message = COALESCE($5, message)
            WHERE run_id = $1 AND company_id = $2`,
          [job.run_id, u.companyId, u.status, u.totalFiles ?? null, u.message ?? null],
        );
        if (u.status === 'FOLDER_NOT_FOUND') {
          await tx.query(`UPDATE companies SET folder_status = 'NOT_FOUND', folder_checked_at = now() WHERE id = $1`, [u.companyId]);
        } else if (u.status === 'RUNNING' || u.status === 'DONE') {
          await tx.query(`UPDATE companies SET folder_status = 'FOUND', folder_checked_at = now() WHERE id = $1`, [u.companyId]);
        }
      }
    });
    await recomputeProgress(ctx.db, job.run_id);
    const { rows } = await ctx.db.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM import_runs WHERE id = $1', [job.run_id]);
    return { cancelRequested: !!rows[0]?.cancel_requested };
  });

  /** Quais destes hashes já estão registrados? (evita reenviar conteúdo já importado) */
  app.post('/agent/runs/:id/check-hashes', opts, async (req) => {
    const body = parse(hashesSchema, req.body);
    const { rows } = await ctx.db.query<{ file_hash: string }>(
      'SELECT file_hash FROM imported_files WHERE file_hash = ANY($1::char(64)[])',
      [body.hashes.map((h) => h.toLowerCase())],
    );
    return { known: rows.map((r) => r.file_hash.trim()) };
  });

  app.post('/agent/runs/:id/files', { ...opts, bodyLimit: 64 * 1024 * 1024 }, async (req) => ingestBatch(ctx, idParam(req), req.body));

  app.post('/agent/jobs/:id/complete', opts, async (req) => {
    const jobId = idParam(req);
    const body = parse(completeSchema, req.body);
    const { rows } = await ctx.db.query<{ id: number; type: string; status: string; payload: Record<string, any>; created_by: number | null }>(
      'SELECT id, type, status, payload, created_by FROM agent_jobs WHERE id = $1',
      [jobId],
    );
    const job = rows[0];
    if (!job) throw notFound('Job não encontrado.');
    const result = body.result ?? {};

    if (job.type === 'SCAN') {
      await ctx.db.query(
        `UPDATE import_runs SET companies_processed = COALESCE($2, companies_processed), files_checked = COALESCE($3, files_checked)
          WHERE id = $1`,
        [job.payload.runId, (result.companiesProcessed as number) ?? null, (result.filesChecked as number) ?? null],
      );
      await finishRun(ctx, Number(job.payload.runId), body.status, body.message ?? null);
    } else if (job.type === 'CHECK_FOLDERS') {
      const folders = (result.folders as { companyId: number; exists: boolean }[] | undefined) ?? [];
      for (const f of folders) {
        await ctx.db.query(
          `UPDATE companies SET folder_status = $2, folder_checked_at = now() WHERE id = $1`,
          [f.companyId, f.exists ? 'FOUND' : 'NOT_FOUND'],
        );
      }
      if (Array.isArray(result.unlinked)) {
        await ctx.db.query(
          `INSERT INTO settings (key, value) VALUES ('unlinked_folders', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ folders: result.unlinked, checkedAt: new Date().toISOString() })],
        );
      }
    } else if (job.type === 'CREATE_FOLDER') {
      if (body.status === 'DONE') {
        await ctx.db.query(`UPDATE companies SET folder_status = 'FOUND', folder_checked_at = now() WHERE id = $1`, [job.payload.companyId]);
      }
      if (job.created_by) {
        await notifyUsers(ctx.db, [job.created_by], {
          title: body.status === 'DONE' ? 'Pasta criada' : 'Falha ao criar pasta',
          message: body.status === 'DONE' ? `A pasta "${job.payload.folderName}" foi criada.` : body.message ?? 'Erro desconhecido',
          type: body.status === 'DONE' ? 'SUCCESS' : 'ERROR',
          link: '/empresas',
        });
      }
    } else if (job.type === 'SAVE_REPORT') {
      const saved = body.status === 'DONE';
      await ctx.db.query(
        `UPDATE reports SET drive_status = $2, drive_path = COALESCE($3, drive_path), drive_error = $4,
                saved_at = CASE WHEN $2 = 'SAVED' THEN now() ELSE saved_at END
          WHERE id = $1`,
        [job.payload.reportId, saved ? 'SAVED' : 'FAILED', (result.drivePath as string) ?? null, saved ? null : body.message ?? 'Erro'],
      );
      const target = job.created_by ? [job.created_by] : [];
      if (target.length) {
        await notifyUsers(ctx.db, target, {
          title: saved ? 'Relatório salvo no Drive' : 'Falha ao salvar relatório no Drive',
          message: saved ? `${job.payload.filename} salvo em ${result.drivePath}` : `${job.payload.filename}: ${body.message ?? 'erro'}`,
          type: saved ? 'REPORT' : 'ERROR',
          link: '/relatorios',
        });
      } else if (!saved) {
        await notifyMasters(ctx.db, { title: 'Falha ao salvar relatório', message: body.message ?? '', type: 'ERROR' });
      }
    }

    await ctx.db.query(
      `UPDATE agent_jobs SET status = CASE WHEN status IN ('DONE','FAILED','CANCELLED') THEN status ELSE $2 END,
              finished_at = COALESCE(finished_at, now()), result = $3, error_message = $4
        WHERE id = $1`,
      [jobId, body.status, JSON.stringify(result), body.message ?? null],
    );
    return { ok: true };
  });

  app.get('/agent/reports/:id/pdf', opts, async (req, reply) => {
    const { rows } = await ctx.db.query<{ pdf: Uint8Array }>('SELECT pdf FROM reports WHERE id = $1', [idParam(req)]);
    if (!rows[0]) throw notFound('Relatório não encontrado.');
    reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'no-store');
    return Buffer.from(rows[0].pdf);
  });
}
