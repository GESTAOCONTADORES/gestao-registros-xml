import type { FastifyInstance } from 'fastify';
import { companySchema } from '@gestao/shared';
import type { Db } from '@gestao/database';
import { HttpError, conflict, idParam, notFound, parse } from '../lib/http';
import { toCompany } from '../lib/mappers';
import { authenticate, requireRole } from '../plugins/auth';
import { enqueueJob, getAgentStatus, requestFolderCheck } from '../services/agent';
import { audit } from '../services/audit';

const COMPANY_SELECT = `SELECT c.*,
   (SELECT count(*)::int FROM imported_files f WHERE f.company_id = c.id) AS total_files,
   (SELECT max(f.imported_at) FROM imported_files f WHERE f.company_id = c.id) AS last_import_at
 FROM companies c`;

async function loadCompany(db: Db, id: number) {
  const { rows } = await db.query(`${COMPANY_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound('Empresa não encontrada.');
  return toCompany(rows[0]);
}

function translateUnique(e: unknown): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code === '23505') {
    const msg = String(err.constraint ?? err.message ?? '');
    if (msg.includes('cnpj')) throw conflict('Já existe uma empresa cadastrada com este CNPJ.');
    if (msg.includes('folder')) throw conflict('Esta pasta já está vinculada a outra empresa.');
  }
  throw e;
}

export async function companyRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const auth = authenticate(ctx);
  const master = { preHandler: [auth, requireRole('MASTER')] };

  // Lista para todos os perfis (seletores de empresa); dados de cadastro completos.
  app.get('/companies', { preHandler: auth }, async (req) => {
    const q = req.query as { status?: string };
    const where = ['c.deleted_at IS NULL'];
    if (q.status === 'ACTIVE' || q.status === 'INACTIVE') where.push(`c.status = '${q.status}'`);
    const { rows } = await ctx.db.query(`${COMPANY_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.corporate_name`);
    return rows.map(toCompany);
  });

  app.get('/companies/:id', { preHandler: auth }, async (req) => loadCompany(ctx.db, idParam(req)));

  app.post('/companies', master, async (req, reply) => {
    const body = parse(companySchema, req.body);
    let id: number;
    try {
      const { rows } = await ctx.db.query<{ id: number }>(
        `INSERT INTO companies (corporate_name, trade_name, cnpj, folder_name, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [body.corporateName, body.tradeName, body.cnpj, body.folderName.trim(), body.notes, req.user!.id],
      );
      id = rows[0]!.id;
    } catch (e) {
      translateUnique(e);
    }
    await audit(ctx.db, { req, action: 'COMPANY_CREATED', entity: 'company', entityId: id, details: { ...body } });
    // verifica imediatamente se a pasta existe (nunca cria sem autorização)
    await requestFolderCheck(ctx.db, [id], req.user!.id);
    reply.code(201);
    return loadCompany(ctx.db, id);
  });

  app.patch('/companies/:id', master, async (req) => {
    const id = idParam(req);
    const before = await loadCompany(ctx.db, id);
    const body = parse(companySchema, req.body);
    try {
      await ctx.db.query(
        `UPDATE companies SET corporate_name = $2, trade_name = $3, cnpj = $4, folder_name = $5, notes = $6,
                folder_status = CASE WHEN lower(folder_name) <> lower($5) THEN 'UNKNOWN' ELSE folder_status END,
                updated_at = now()
          WHERE id = $1`,
        [id, body.corporateName, body.tradeName, body.cnpj, body.folderName.trim(), body.notes],
      );
    } catch (e) {
      translateUnique(e);
    }
    await audit(ctx.db, {
      req,
      action: 'COMPANY_UPDATED',
      entity: 'company',
      entityId: id,
      details: { before: { ...before, totalFiles: undefined, lastImportAt: undefined }, after: body },
    });
    if (before.folderName.toLowerCase() !== body.folderName.trim().toLowerCase()) {
      await requestFolderCheck(ctx.db, [id], req.user!.id);
    }
    return loadCompany(ctx.db, id);
  });

  app.post('/companies/:id/activate', master, async (req) => {
    const id = idParam(req);
    await loadCompany(ctx.db, id);
    await ctx.db.query(`UPDATE companies SET status = 'ACTIVE', deactivated_at = NULL, updated_at = now() WHERE id = $1`, [id]);
    await audit(ctx.db, { req, action: 'COMPANY_ACTIVATED', entity: 'company', entityId: id });
    return loadCompany(ctx.db, id);
  });

  app.post('/companies/:id/deactivate', master, async (req) => {
    const id = idParam(req);
    await loadCompany(ctx.db, id);
    await ctx.db.query(`UPDATE companies SET status = 'INACTIVE', deactivated_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await audit(ctx.db, { req, action: 'COMPANY_DEACTIVATED', entity: 'company', entityId: id });
    return loadCompany(ctx.db, id);
  });

  /**
   * Exclui a empresa da base do robô (exclusão lógica). Os registros já
   * importados são mantidos e NENHUM arquivo em G:\ é apagado.
   */
  app.delete('/companies/:id', master, async (req) => {
    const id = idParam(req);
    const company = await loadCompany(ctx.db, id);
    const active = await ctx.db.query(
      `SELECT 1 FROM import_run_companies irc JOIN import_runs r ON r.id = irc.run_id
        WHERE irc.company_id = $1 AND r.status IN ('QUEUED', 'RUNNING')`,
      [id],
    );
    if (active.rowCount) throw conflict('A empresa está em uma pesquisa em andamento.');
    await ctx.db.query(
      `UPDATE companies SET deleted_at = now(), status = 'INACTIVE', deactivated_at = COALESCE(deactivated_at, now()), updated_at = now()
        WHERE id = $1`,
      [id],
    );
    await audit(ctx.db, {
      req,
      action: 'COMPANY_DELETED',
      entity: 'company',
      entityId: id,
      details: { corporateName: company.corporateName, cnpj: company.cnpj, folderName: company.folderName },
    });
    return { ok: true };
  });

  app.post('/companies/check-folders', master, async (req) => {
    const agent = await getAgentStatus(ctx);
    if (!agent.online) throw new HttpError(503, 'O servidor responsável pelo acesso à pasta compartilhada está offline.', 'AGENT_OFFLINE');
    const jobId = await requestFolderCheck(ctx.db, 'ALL', req.user!.id);
    await audit(ctx.db, { req, action: 'FOLDERS_CHECK_REQUESTED', entity: 'agent_job', entityId: jobId });
    return { jobId };
  });

  /** Criação de pasta: somente com autorização explícita do Master. */
  app.post('/companies/:id/create-folder', master, async (req) => {
    const id = idParam(req);
    const company = await loadCompany(ctx.db, id);
    const body = (req.body ?? {}) as { confirm?: boolean };
    if (body.confirm !== true) throw new HttpError(400, 'Confirme a criação da pasta.');
    if (company.folderStatus === 'FOUND') throw conflict('A pasta já existe.');
    const agent = await getAgentStatus(ctx);
    if (!agent.online) throw new HttpError(503, 'O servidor responsável pelo acesso à pasta compartilhada está offline.', 'AGENT_OFFLINE');
    const jobId = await enqueueJob(ctx.db, 'CREATE_FOLDER', { companyId: id, folderName: company.folderName }, req.user!.id);
    await audit(ctx.db, {
      req,
      action: 'COMPANY_FOLDER_CREATE_REQUESTED',
      entity: 'company',
      entityId: id,
      details: { folderName: company.folderName },
    });
    return { jobId };
  });

  /** Pastas existentes na unidade que ainda não estão vinculadas a nenhuma empresa. */
  app.get('/companies/folders/unlinked', master, async () => {
    const { rows } = await ctx.db.query<{ value: { folders: string[]; checkedAt: string } }>(
      `SELECT value FROM settings WHERE key = 'unlinked_folders'`,
    );
    const v = rows[0]?.value ?? { folders: [], checkedAt: null };
    const linked = await ctx.db.query<{ f: string }>('SELECT lower(folder_name) AS f FROM companies WHERE deleted_at IS NULL');
    const set = new Set(linked.rows.map((r) => r.f));
    return { folders: (v.folders ?? []).filter((f) => !set.has(f.toLowerCase())), checkedAt: v.checkedAt ?? null };
  });
}
