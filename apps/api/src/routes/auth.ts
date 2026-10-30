import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  accessRequestSchema,
  buildUsername,
  changePasswordSchema,
  loginSchema,
  normalizeUsername,
  type SessionDTO,
} from '@gestao/shared';
import { getDummyHash, hashPassword, verifyPassword } from '@gestao/database';
import type { AppContext } from '../context';
import { HttpError, parse, unauthorized } from '../lib/http';
import { USER_COLUMNS, toUser } from '../lib/mappers';
import { authenticate, newRefreshToken, sha256, signAccessToken } from '../plugins/auth';
import { audit } from '../services/audit';
import { escapeHtml } from '../services/mail';
import { emailNotificationsEnabled, notifyMasters } from '../services/notifications';

export const REFRESH_COOKIE = 'dp_rt';

const STATUS_MESSAGES: Record<string, string> = {
  PENDING: 'Seu cadastro está aguardando aprovação do Departamento Pessoal.',
  REJECTED: 'Sua solicitação de acesso foi rejeitada. Procure o Departamento Pessoal.',
  BLOCKED: 'Seu usuário está bloqueado. Procure o Departamento Pessoal.',
};

function setRefreshCookie(ctx: AppContext, reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookie.secure,
    sameSite: ctx.config.cookie.sameSite,
    domain: ctx.config.cookie.domain,
    path: '/auth',
    expires,
  });
}

function clearRefreshCookie(ctx: AppContext, reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, {
    path: '/auth',
    domain: ctx.config.cookie.domain,
    secure: ctx.config.cookie.secure,
    sameSite: ctx.config.cookie.sameSite,
  });
}

async function issueSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: number,
  familyId: string = randomUUID(),
): Promise<SessionDTO & { refreshTokenId: number }> {
  const { rows } = await ctx.db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [userId]);
  const user = toUser(rows[0]!);
  const refresh = newRefreshToken();
  const expires = new Date(Date.now() + ctx.config.refreshTokenTtlDays * 86400_000);
  const ins = await ctx.db.query<{ id: number }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, sha256(refresh), familyId, expires, req.ip, req.headers['user-agent']?.slice(0, 300) ?? null],
  );
  setRefreshCookie(ctx, reply, refresh, expires);
  return {
    accessToken: await signAccessToken(ctx, user),
    expiresIn: ctx.config.accessTokenTtlSeconds,
    user,
    refreshTokenId: ins.rows[0]!.id,
  };
}

async function uniqueUsername(ctx: AppContext, base: string): Promise<string> {
  const { rows } = await ctx.db.query<{ username: string }>(
    `SELECT lower(username) AS username FROM users WHERE lower(username) = $1 OR lower(username) ~ ('^' || $2 || '[0-9]+$')`,
    [base, base.replace(/\./g, '\\.')],
  );
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export async function authRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const auth = authenticate(ctx);

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: ctx.config.login.ratePerMinute, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const username = normalizeUsername(body.username);
      const { rows } = await ctx.db.query<{
        id: number;
        password_hash: string;
        status: string;
        failed_login_attempts: number;
        locked_until: Date | null;
      }>('SELECT id, password_hash, status, failed_login_attempts, locked_until FROM users WHERE lower(username) = $1', [
        username,
      ]);
      const user = rows[0];
      const invalid = new HttpError(401, 'Usuário ou senha inválidos.', 'INVALID_CREDENTIALS');

      if (!user) {
        await verifyPassword(await getDummyHash(), body.password); // tempo constante
        await audit(ctx.db, { userId: null, req, action: 'LOGIN_FAILED', details: { username } });
        throw invalid;
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        throw new HttpError(429, `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`, 'LOCKED');
      }
      const ok = await verifyPassword(user.password_hash, body.password);
      if (!ok) {
        const attempts = user.failed_login_attempts + 1;
        const lock = attempts >= ctx.config.login.maxAttempts;
        await ctx.db.query(
          `UPDATE users SET failed_login_attempts = $2,
                  locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
            WHERE id = $1`,
          [user.id, lock ? 0 : attempts, lock, ctx.config.login.lockMinutes],
        );
        await audit(ctx.db, { userId: user.id, req, action: 'LOGIN_FAILED', details: { attempts, locked: lock } });
        throw invalid;
      }
      // a situação do cadastro só é revelada a quem conhece a senha
      if (user.status !== 'ACTIVE') {
        await audit(ctx.db, { userId: user.id, req, action: 'LOGIN_FAILED', details: { status: user.status } });
        throw new HttpError(403, STATUS_MESSAGES[user.status] ?? 'Acesso não autorizado.', `USER_${user.status}`);
      }
      await ctx.db.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
        [user.id],
      );
      const session = await issueSession(ctx, req, reply, user.id);
      await audit(ctx.db, { userId: user.id, req, action: 'LOGIN' });
      const { refreshTokenId: _ignored, ...dto } = session;
      return dto;
    },
  );

  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized();
    const { rows } = await ctx.db.query<{
      id: number;
      user_id: number;
      family_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      status: string;
    }>(
      `SELECT t.id, t.user_id, t.family_id, t.expires_at, t.revoked_at, u.status
         FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
      [sha256(token)],
    );
    const t = rows[0];
    if (!t) {
      clearRefreshCookie(ctx, reply);
      throw unauthorized();
    }
    if (t.revoked_at) {
      // reutilização de token já trocado: revoga toda a família (possível roubo)
      await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [t.family_id]);
      clearRefreshCookie(ctx, reply);
      throw unauthorized();
    }
    if (new Date(t.expires_at) < new Date() || t.status !== 'ACTIVE') {
      await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [t.id]);
      clearRefreshCookie(ctx, reply);
      throw unauthorized();
    }
    const session = await issueSession(ctx, req, reply, t.user_id, t.family_id);
    await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [t.id, session.refreshTokenId]);
    const { refreshTokenId: _ignored, ...dto } = session;
    return dto;
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const { rows } = await ctx.db.query<{ user_id: number; family_id: string }>(
        'SELECT user_id, family_id FROM refresh_tokens WHERE token_hash = $1',
        [sha256(token)],
      );
      if (rows[0]) {
        await ctx.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
          rows[0].family_id,
        ]);
        await audit(ctx.db, { userId: rows[0].user_id, req, action: 'LOGOUT' });
      }
    }
    clearRefreshCookie(ctx, reply);
    return { ok: true };
  });

  app.post(
    '/auth/request-access',
    { config: { rateLimit: { max: ctx.config.login.ratePerMinute, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = parse(accessRequestSchema, req.body);
      const username = await uniqueUsername(ctx, buildUsername(body.firstName, body.lastName));
      const { rows } = await ctx.db.query<{ id: number }>(
        `INSERT INTO users (first_name, last_name, username, department, password_hash, role, status, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, 'USER', 'PENDING', now()) RETURNING id`,
        [body.firstName, body.lastName, username, body.department, await hashPassword(body.password)],
      );
      const userId = rows[0]!.id;
      const fullName = `${body.firstName} ${body.lastName}`;
      await audit(ctx.db, { userId, req, action: 'USER_REQUESTED', entity: 'user', entityId: userId, details: { username } });
      await notifyMasters(ctx.db, {
        title: 'Nova solicitação de acesso',
        message: `${fullName} (${body.department}) solicitou acesso. Identificador: ${username}.`,
        type: 'ACCESS_REQUEST',
        link: '/usuarios?status=PENDING',
      });
      if (ctx.config.approvalEmail && (await emailNotificationsEnabled(ctx.db))) {
        const link = `${ctx.config.appPublicUrl}/usuarios?status=PENDING`;
        void ctx.mail.send({
          to: ctx.config.approvalEmail,
          subject: `[REGISTROS XML-PDF] Solicitação de acesso — ${fullName}`,
          text:
            `Nova solicitação de acesso ao sistema REGISTROS XML-PDF.\n\n` +
            `Nome: ${fullName}\nSetor: ${body.department}\nIdentificador: ${username}\n\n` +
            `Para aprovar ou rejeitar, acesse: ${link}\n`,
          html:
            `<p>Nova solicitação de acesso ao sistema <strong>REGISTROS XML-PDF</strong>.</p>` +
            `<p><strong>Nome:</strong> ${escapeHtml(fullName)}<br><strong>Setor:</strong> ${escapeHtml(body.department)}<br>` +
            `<strong>Identificador:</strong> ${escapeHtml(username)}</p>` +
            `<p><a href="${escapeHtml(link)}">Aprovar ou rejeitar a solicitação</a></p>`,
        });
      } else {
        ctx.log.warn({}, 'E-mail de aprovação não enviado (DP_APPROVAL_EMAIL ausente ou notificações por e-mail desativadas)');
      }
      reply.code(201);
      return { username, status: 'PENDING', message: 'Solicitação enviada. Aguardando aprovação.' };
    },
  );

  app.get('/auth/me', { preHandler: auth }, async (req) => {
    const { rows } = await ctx.db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [req.user!.id]);
    return toUser(rows[0]!);
  });

  app.post('/auth/change-password', { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(changePasswordSchema, req.body);
    const { rows } = await ctx.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!(await verifyPassword(rows[0]!.password_hash, body.currentPassword))) {
      throw new HttpError(400, 'Senha atual incorreta.', 'VALIDATION_ERROR', { currentPassword: 'Senha atual incorreta.' });
    }
    await ctx.db.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [
      req.user!.id,
      await hashPassword(body.newPassword),
    ]);
    await audit(ctx.db, { req, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: req.user!.id });
    return { ok: true };
  });
}
