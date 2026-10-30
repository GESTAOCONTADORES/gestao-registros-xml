import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@gestao/shared';
import type { AppContext } from '../context';
import { forbidden, unauthorized } from '../lib/http';

const ISSUER = 'gestao-registros-xml';

export async function signAccessToken(ctx: AppContext, user: { id: number; role: Role }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ctx.config.accessTokenTtlSeconds}s`)
    .sign(new TextEncoder().encode(ctx.config.jwtSecret));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(sha256(a));
  const bb = Buffer.from(sha256(b));
  return timingSafeEqual(ab, bb);
}

/**
 * Valida o token de acesso e recarrega o usuário do banco a cada requisição:
 * um usuário bloqueado perde o acesso imediatamente.
 */
export function authenticate(ctx: AppContext) {
  const key = new TextEncoder().encode(ctx.config.jwtSecret);
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let userId: number;
    try {
      const { payload } = await jwtVerify(header.slice(7), key, { issuer: ISSUER, algorithms: ['HS256'] });
      userId = Number(payload.sub);
    } catch {
      throw unauthorized();
    }
    const { rows } = await ctx.db.query<{
      id: number;
      role: Role;
      status: string;
      first_name: string;
      last_name: string;
      department: string;
      username: string;
    }>('SELECT id, role, status, first_name, last_name, department, username FROM users WHERE id = $1', [userId]);
    const u = rows[0];
    if (!u || u.status !== 'ACTIVE') throw unauthorized('Acesso não autorizado.');
    req.user = {
      id: u.id,
      role: u.role,
      firstName: u.first_name,
      lastName: u.last_name,
      department: u.department,
      username: u.username,
    };
  };
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}

/** Autenticação do Agente Windows via AGENT_API_TOKEN (comparação em tempo constante). */
export function authenticateAgent(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ') || !safeEqual(header.slice(7), ctx.config.agent.token)) {
      throw unauthorized('Agente não autorizado.');
    }
  };
}
