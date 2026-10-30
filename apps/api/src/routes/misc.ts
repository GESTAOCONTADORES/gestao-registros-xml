import type { FastifyInstance } from 'fastify';
import {
  auditQuerySchema,
  periodFilterSchema,
  reportRequestSchema,
  settingsUpdateSchema,
  type SettingsDTO,
} from '@gestao/shared';
import { HttpError, attachment, idParam, notFound, parse } from '../lib/http';
import { toAudit, toNotification, toReport } from '../lib/mappers';
import { authenticate, requireRole } from '../plugins/auth';
import { getAgentStatus } from '../services/agent';
import { audit } from '../services/audit';
import { generateReport, queueReportSave } from '../services/reports';
import { dashboardStats, yearsWithData } from '../services/stats';

export async function miscRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const auth = authenticate(ctx);
  const master = { preHandler: [auth, requireRole('MASTER')] };

  // ------------------------------------------------------------- dashboard
  app.get('/dashboard', { preHandler: auth }, async (req) => dashboardStats(ctx.db, parse(periodFilterSchema, req.query)));
  app.get('/years', { preHandler: auth }, async () => yearsWithData(ctx.db));

  // ------------------------------------------------------------- agente
  app.get('/agent-status', { preHandler: auth }, async () => getAgentStatus(ctx));

  // ------------------------------------------------------------- relatórios
  app.get('/reports', { preHandler: auth }, async (req) => {
    const q = req.query as { page?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 20;
    const total = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM reports');
    const { rows } = await ctx.db.query(
      `SELECT r.id, r.requested_by, r.filters, r.summary, r.filename, r.drive_path, r.drive_status, r.drive_error, r.created_at,
              (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = r.requested_by) AS requested_by_name
         FROM reports r ORDER BY r.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    );
    return { items: rows.map(toReport), total: total.rows[0]!.n, page, pageSize };
  });

  app.post('/reports', { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(reportRequestSchema, req.body);
    const name = `${req.user!.firstName} ${req.user!.lastName}`.trim();
    const { reportId } = await generateReport(ctx, req.user!.id, name, body, req);
    const { rows } = await ctx.db.query(
      `SELECT r.*, (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = r.requested_by) AS requested_by_name
         FROM reports r WHERE r.id = $1`,
      [reportId],
    );
    reply.code(201);
    return toReport(rows[0]!);
  });

  app.get('/reports/:id/pdf', { preHandler: auth }, async (req, reply) => {
    const id = idParam(req);
    const { rows } = await ctx.db.query<{ filename: string; pdf: Uint8Array }>('SELECT filename, pdf FROM reports WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Relatório não encontrado.');
    await audit(ctx.db, { req, action: 'DOWNLOAD', entity: 'report', entityId: id, details: { filename: rows[0].filename, format: 'pdf' } });
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', attachment(rows[0].filename)).header('Cache-Control', 'no-store');
    return Buffer.from(rows[0].pdf);
  });

  /** Nova tentativa de gravação em RELATORIOS ROBO. */
  app.post('/reports/:id/save-to-drive', { preHandler: auth }, async (req) => {
    const id = idParam(req);
    const { rows } = await ctx.db.query<{ filename: string; drive_status: string; requested_by: number | null }>(
      'SELECT filename, drive_status, requested_by FROM reports WHERE id = $1',
      [id],
    );
    const r = rows[0];
    if (!r) throw notFound('Relatório não encontrado.');
    if (req.user!.role !== 'MASTER' && r.requested_by !== req.user!.id) throw new HttpError(403, 'Você não tem permissão para realizar esta ação.');
    if (r.drive_status === 'SAVED') throw new HttpError(409, 'O relatório já está salvo no Drive.');
    await queueReportSave(ctx, id, r.filename, req.user!.id);
    return { ok: true };
  });

  // ------------------------------------------------------------- notificações
  app.get('/notifications', { preHandler: auth }, async (req) => {
    const q = req.query as { unread?: string; limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const { rows } = await ctx.db.query(
      `SELECT * FROM notifications WHERE user_id = $1 ${q.unread === 'true' ? 'AND NOT is_read' : ''}
        ORDER BY created_at DESC LIMIT ${limit}`,
      [req.user!.id],
    );
    const unread = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user!.id]);
    return { items: rows.map(toNotification), unread: unread.rows[0]!.n };
  });

  app.get('/notifications/unread-count', { preHandler: auth }, async (req) => {
    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user!.id]);
    return { unread: rows[0]!.n };
  });

  app.post('/notifications/:id/read', { preHandler: auth }, async (req) => {
    await ctx.db.query('UPDATE notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2', [idParam(req), req.user!.id]);
    return { ok: true };
  });

  app.post('/notifications/read-all', { preHandler: auth }, async (req) => {
    await ctx.db.query('UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND NOT is_read', [req.user!.id]);
    return { ok: true };
  });

  app.delete('/notifications/read', { preHandler: auth }, async (req) => {
    const res = await ctx.db.query('DELETE FROM notifications WHERE user_id = $1 AND is_read', [req.user!.id]);
    return { deleted: res.rowCount };
  });

  app.delete('/notifications/:id', { preHandler: auth }, async (req) => {
    await ctx.db.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [idParam(req), req.user!.id]);
    return { ok: true };
  });

  app.delete('/notifications', { preHandler: auth }, async (req) => {
    const res = await ctx.db.query('DELETE FROM notifications WHERE user_id = $1', [req.user!.id]);
    return { deleted: res.rowCount };
  });

  // ------------------------------------------------------------- configurações
  const loadSettings = async (): Promise<SettingsDTO> => {
    const agent = await getAgentStatus(ctx);
    const s = await ctx.db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    const map = Object.fromEntries(s.rows.map((r) => [r.key, r.value]));
    return {
      monitoredPath: agent.rootPath,
      reportsPath: agent.reportsPath,
      emailNotificationsEnabled: map.email_notifications_enabled !== false,
      smtpConfigured: ctx.mail.configured,
      approvalEmailConfigured: Boolean(ctx.config.approvalEmail),
      agent,
      lastSyncAt: agent.lastSeenAt,
    };
  };

  app.get('/settings', master, loadSettings);

  app.patch('/settings', master, async (req) => {
    const body = parse(settingsUpdateSchema, req.body);
    if (body.emailNotificationsEnabled !== undefined) {
      await ctx.db.query(
        `INSERT INTO settings (key, value, updated_by) VALUES ('email_notifications_enabled', $1::jsonb, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [JSON.stringify(body.emailNotificationsEnabled), req.user!.id],
      );
    }
    await audit(ctx.db, { req, action: 'SETTINGS_UPDATED', entity: 'settings', details: body });
    return loadSettings();
  });

  // ------------------------------------------------------------- auditoria
  app.get('/audit', master, async (req) => {
    const q = parse(auditQuerySchema, req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.action) {
      params.push(q.action);
      where.push(`a.action = $${params.length}`);
    }
    if (q.userId) {
      params.push(q.userId);
      where.push(`a.user_id = $${params.length}`);
    }
    if (q.dateFrom) {
      params.push(q.dateFrom);
      where.push(`a.created_at >= $${params.length}::date`);
    }
    if (q.dateTo) {
      params.push(q.dateTo);
      where.push(`a.created_at < ($${params.length}::date + interval '1 day')`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs a ${w}`, params);
    const { rows } = await ctx.db.query(
      `SELECT a.*, (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = a.user_id) AS user_name
         FROM audit_logs a ${w} ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    return { items: rows.map(toAudit), total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize };
  });
}
