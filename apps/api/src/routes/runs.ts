import type { FastifyInstance } from 'fastify';
import { runFilesQuerySchema, runsQuerySchema, startRunSchema } from '@gestao/shared';
import { HttpError, attachment, idParam, notFound, parse } from '../lib/http';
import { RUN_COLUMNS, toRun, toRunFile } from '../lib/mappers';
import { authenticate, requireRole } from '../plugins/auth';
import { audit } from '../services/audit';
import { finishRun, getRunEvent, resolveRunCompanies, startRun } from '../services/runs';

export async function runRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const auth = authenticate(ctx);

  // Usuários e Master podem iniciar pesquisas (Seção 58, itens 6 e 7)
  app.post('/runs', { preHandler: auth }, async (req, reply) => {
    const body = parse(startRunSchema, req.body);
    const event = await startRun(ctx, req.user!.id, body, req);
    reply.code(201);
    return event;
  });

  /** Pré-visualização do resumo antes de iniciar (Seção 40). */
  app.post('/runs/preview', { preHandler: auth }, async (req) => {
    const body = parse(startRunSchema, req.body);
    const companies = await resolveRunCompanies(ctx.db, body);
    const inactive = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM companies WHERE deleted_at IS NULL AND status = 'INACTIVE'`,
    );
    return {
      companies: companies.map((c) => ({ id: c.id, name: c.corporate_name, folderName: c.folder_name })),
      ignoredInactive: body.scope === 'ALL' || body.scope === 'ACTIVE' ? inactive.rows[0]!.n : 0,
    };
  });

  app.get('/runs', { preHandler: auth }, async (req) => {
    const q = parse(runsQuerySchema, req.query);
    const params: unknown[] = [];
    let where = '';
    if (q.status) {
      params.push(q.status);
      where = `WHERE r.status = $1`;
    }
    const total = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM import_runs r ${where}`, params);
    const { rows } = await ctx.db.query(
      `SELECT ${RUN_COLUMNS},
              (SELECT array_agg(c.corporate_name ORDER BY c.corporate_name) FROM import_run_companies irc
                 JOIN companies c ON c.id = irc.company_id WHERE irc.run_id = r.id) AS company_names
         FROM import_runs r ${where}
        ORDER BY r.created_at DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    return { items: rows.map(toRun), total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize };
  });

  /** Execução ativa — permite recuperar o progresso após fechar o navegador. */
  app.get('/runs/active', { preHandler: auth }, async () => {
    const { rows } = await ctx.db.query<{ id: number }>(
      `SELECT id FROM import_runs WHERE status IN ('QUEUED', 'RUNNING') ORDER BY created_at DESC LIMIT 1`,
    );
    return rows[0] ? getRunEvent(ctx.db, rows[0].id) : null;
  });

  app.get('/runs/:id', { preHandler: auth }, async (req) => getRunEvent(ctx.db, idParam(req)));

  app.get('/runs/:id/files', { preHandler: auth }, async (req) => {
    const id = idParam(req);
    const q = parse(runFilesQuerySchema, req.query);
    const params: unknown[] = [id];
    let where = 'WHERE rf.run_id = $1';
    if (q.status) {
      params.push(q.status);
      where += ` AND rf.status = $2`;
    }
    const total = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM import_run_files rf ${where}`, params);
    const { rows } = await ctx.db.query(
      `SELECT rf.id, rf.run_id, rf.company_id, rf.filename, rf.relative_path, rf.file_hash, rf.file_size, rf.file_modified_at,
              rf.status, rf.error_message, rf.imported_file_id, rf.year, rf.month, rf.created_at,
              (rf.content IS NOT NULL) AS has_content, c.corporate_name AS company_name
         FROM import_run_files rf LEFT JOIN companies c ON c.id = rf.company_id
         ${where}
        ORDER BY CASE rf.status WHEN 'ERROR' THEN 0 WHEN 'IMPORTED' THEN 1 ELSE 2 END, rf.id
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    return { items: rows.map(toRunFile), total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize };
  });

  /** Conteúdo bruto de um arquivo com erro (para análise). */
  app.get('/runs/:id/files/:fileId/content', { preHandler: auth }, async (req, reply) => {
    const id = idParam(req);
    const fileId = idParam(req, 'fileId');
    const { rows } = await ctx.db.query<{ filename: string; content: Uint8Array | null }>(
      'SELECT filename, content FROM import_run_files WHERE id = $1 AND run_id = $2',
      [fileId, id],
    );
    const f = rows[0];
    if (!f?.content) throw notFound('Conteúdo do arquivo não disponível.');
    await audit(ctx.db, { req, action: 'DOWNLOAD', entity: 'import_run_file', entityId: fileId, details: { filename: f.filename, format: 'xml-erro' } });
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', attachment(f.filename))
      .header('Cache-Control', 'no-store');
    return Buffer.from(f.content);
  });

  /** Cancelamento: somente Master. O agente encerra após o arquivo atual. */
  app.post('/runs/:id/cancel', { preHandler: [auth, requireRole('MASTER')] }, async (req) => {
    const id = idParam(req);
    const { rows } = await ctx.db.query<{ status: string; job_status: string | null }>(
      `SELECT r.status, j.status AS job_status FROM import_runs r LEFT JOIN agent_jobs j ON j.id = r.job_id WHERE r.id = $1`,
      [id],
    );
    const run = rows[0];
    if (!run) throw notFound('Execução não encontrada.');
    if (!['QUEUED', 'RUNNING'].includes(run.status)) throw new HttpError(409, 'Esta pesquisa não está em andamento.');
    await ctx.db.query(
      `UPDATE import_runs SET cancel_requested = true, cancel_requested_by = $2, updated_at = now() WHERE id = $1`,
      [id, req.user!.id],
    );
    await audit(ctx.db, { req, action: 'RUN_CANCEL_REQUESTED', entity: 'import_run', entityId: id });
    if (run.status === 'QUEUED' && run.job_status === 'PENDING') {
      // ainda não começou: cancela direto
      await finishRun(ctx, id, 'CANCELLED', 'Cancelada antes do início');
    }
    return getRunEvent(ctx.db, id);
  });

  /**
   * Progresso em tempo real via Server-Sent Events.
   * O estado é lido do banco, então funciona após reabrir o navegador e com várias instâncias da API.
   */
  app.get('/runs/:id/events', { preHandler: auth }, async (req, reply) => {
    const id = idParam(req);
    let event = await getRunEvent(ctx.db, id);
    reply.hijack();
    const raw = reply.raw;
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string;
    raw.writeHead(200, {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (name: string, data: unknown) => raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    send('progress', event);

    let closed = false;
    let lastStamp = event.run.updatedAt;
    let ticks = 0;
    const finished = () => !['QUEUED', 'RUNNING'].includes(event.run.status);
    const stop = () => {
      closed = true;
      clearInterval(timer);
      raw.end();
    };
    req.raw.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
    const timer = setInterval(async () => {
      if (closed) return;
      ticks++;
      try {
        const stamp = await ctx.db.query<{ updated_at: Date }>('SELECT updated_at FROM import_runs WHERE id = $1', [id]);
        const current = stamp.rows[0] ? new Date(stamp.rows[0].updated_at).toISOString() : lastStamp;
        if (current !== lastStamp) {
          lastStamp = current;
          event = await getRunEvent(ctx.db, id);
          send('progress', event);
        } else if (ticks % 15 === 0) {
          raw.write(': keep-alive\n\n');
        }
        if (finished()) {
          send('done', event);
          stop();
        }
      } catch (err) {
        ctx.log.error({ err }, 'Falha no SSE de progresso');
        stop();
      }
    }, 1000);
    if (finished()) {
      send('done', event);
      stop();
    }
  });
}
