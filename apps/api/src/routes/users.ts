import type { FastifyInstance } from 'fastify';
import {
  buildUsername,
  createUserSchema,
  resetPasswordSchema,
  stripAccents,
  updateUserSchema,
  userListQuerySchema,
  type AuditAction,
  type UserStatus,
} from '@gestao/shared';
import { hashPassword } from '@gestao/database';
import { HttpError, badRequest, idParam, notFound, parse } from '../lib/http';
import { USER_COLUMNS, toUser } from '../lib/mappers';
import { authenticate, requireRole } from '../plugins/auth';
import { audit } from '../services/audit';
import { notifyUsers } from '../services/notifications';

const TRANSITIONS: Record<string, { from: UserStatus[]; to: UserStatus; action: AuditAction; label: string }> = {
  approve: { from: ['PENDING', 'REJECTED'], to: 'ACTIVE', action: 'USER_APPROVED', label: 'aprovado' },
  reject: { from: ['PENDING'], to: 'REJECTED', action: 'USER_REJECTED', label: 'rejeitado' },
  block: { from: ['ACTIVE', 'PENDING'], to: 'BLOCKED', action: 'USER_BLOCKED', label: 'bloqueado' },
  reactivate: { from: ['BLOCKED', 'REJECTED'], to: 'ACTIVE', action: 'USER_REACTIVATED', label: 'reativado' },
};

export async function userRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const master = { preHandler: [authenticate(ctx), requireRole('MASTER')] };

  app.get('/users', master, async (req) => {
    const q = parse(userListQuerySchema, req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`u.status = $${params.length}`);
    }
    if (q.search) {
      params.push(`%${stripAccents(q.search).toLowerCase()}%`);
      where.push(`(lower(u.first_name || ' ' || u.last_name) LIKE $${params.length} OR lower(u.username) LIKE $${params.length}
                   OR lower(u.department) LIKE $${params.length})`);
    }
    const { rows } = await ctx.db.query(
      `SELECT ${USER_COLUMNS} FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE u.status WHEN 'PENDING' THEN 0 ELSE 1 END, u.first_name, u.last_name`,
      params,
    );
    const counts = await ctx.db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM users GROUP BY status');
    return { items: rows.map(toUser), counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) };
  });

  app.post('/users', master, async (req, reply) => {
    const body = parse(createUserSchema, req.body);
    const base = buildUsername(body.firstName, body.lastName);
    const taken = await ctx.db.query<{ username: string }>(
      `SELECT lower(username) AS username FROM users WHERE lower(username) = $1 OR lower(username) ~ ('^' || $2 || '[0-9]+$')`,
      [base, base.replace(/\./g, '\\.')],
    );
    const set = new Set(taken.rows.map((r) => r.username));
    let username = base;
    for (let i = 2; set.has(username); i++) username = `${base}${i}`;
    const { rows } = await ctx.db.query<{ id: number }>(
      `INSERT INTO users (first_name, last_name, username, department, password_hash, role, status, approved_at, approved_by, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', now(), $7, now()) RETURNING id`,
      [body.firstName, body.lastName, username, body.department, await hashPassword(body.password), body.role, req.user!.id],
    );
    const id = rows[0]!.id;
    await audit(ctx.db, { req, action: 'USER_CREATED', entity: 'user', entityId: id, details: { username, role: body.role } });
    const user = await ctx.db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
    reply.code(201);
    return toUser(user.rows[0]!);
  });

  app.patch('/users/:id', master, async (req) => {
    const id = idParam(req);
    const body = parse(updateUserSchema, req.body);
    const current = await ctx.db.query<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1', [id]);
    if (!current.rows[0]) throw notFound('Usuário não encontrado.');
    if (body.role && body.role !== 'MASTER' && current.rows[0].role === 'MASTER') {
      const masters = await ctx.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM users WHERE role = 'MASTER' AND status = 'ACTIVE' AND id <> $1`,
        [id],
      );
      if (masters.rows[0]!.n === 0) throw badRequest('É necessário manter ao menos um usuário Master ativo.');
    }
    await ctx.db.query(
      `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
              department = COALESCE($4, department), role = COALESCE($5, role), updated_at = now()
        WHERE id = $1`,
      [id, body.firstName ?? null, body.lastName ?? null, body.department ?? null, body.role ?? null],
    );
    await audit(ctx.db, { req, action: 'USER_UPDATED', entity: 'user', entityId: id, details: body });
    const { rows } = await ctx.db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
    return toUser(rows[0]!);
  });

  for (const [name, t] of Object.entries(TRANSITIONS)) {
    app.post(`/users/:id/${name}`, master, async (req) => {
      const id = idParam(req);
      if (id === req.user!.id && t.to !== 'ACTIVE') throw badRequest('Você não pode alterar a situação do seu próprio usuário.');
      const current = await ctx.db.query<{ status: UserStatus; role: string }>('SELECT status, role FROM users WHERE id = $1', [id]);
      const u = current.rows[0];
      if (!u) throw notFound('Usuário não encontrado.');
      if (!t.from.includes(u.status)) {
        throw new HttpError(409, `Não é possível deixar um usuário "${u.status}" como ${t.label}.`, 'INVALID_TRANSITION');
      }
      if (u.role === 'MASTER' && t.to !== 'ACTIVE') {
        const masters = await ctx.db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM users WHERE role = 'MASTER' AND status = 'ACTIVE' AND id <> $1`,
          [id],
        );
        if (masters.rows[0]!.n === 0) throw badRequest('É necessário manter ao menos um usuário Master ativo.');
      }
      await ctx.db.query(
        `UPDATE users SET status = $2, updated_at = now(),
                approved_at = CASE WHEN $2 = 'ACTIVE' AND approved_at IS NULL THEN now() ELSE approved_at END,
                approved_by = CASE WHEN $2 = 'ACTIVE' AND approved_by IS NULL THEN $3::int ELSE approved_by END,
                failed_login_attempts = 0, locked_until = NULL
          WHERE id = $1`,
        [id, t.to, req.user!.id],
      );
      if (t.to !== 'ACTIVE') {
        await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      } else {
        await notifyUsers(ctx.db, [id], {
          title: 'Acesso liberado',
          message: 'Seu acesso ao sistema REGISTROS XML-PDF foi aprovado. Bem-vindo(a)!',
          type: 'SUCCESS',
        });
      }
      await audit(ctx.db, { req, action: t.action, entity: 'user', entityId: id, details: { from: u.status, to: t.to } });
      const { rows } = await ctx.db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
      return toUser(rows[0]!);
    });
  }

  app.post('/users/:id/reset-password', master, async (req) => {
    const id = idParam(req);
    const body = parse(resetPasswordSchema, req.body);
    const res = await ctx.db.query(
      'UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
      [id, await hashPassword(body.newPassword)],
    );
    if (!res.rowCount) throw notFound('Usuário não encontrado.');
    await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(ctx.db, { req, action: 'USER_PASSWORD_RESET', entity: 'user', entityId: id });
    return { ok: true };
  });
}
