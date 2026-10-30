import type { FastifyRequest } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Sessão expirada. Faça login novamente.') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Você não tem permissão para realizar esta ação.') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg: string) => new HttpError(409, msg, 'CONFLICT');

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new HttpError(400, Object.values(fields)[0] ?? 'Dados inválidos', 'VALIDATION_ERROR', fields);
  }
  return result.data;
}

export function idParam(req: FastifyRequest, name = 'id'): number {
  const raw = (req.params as Record<string, string>)[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Identificador inválido');
  return id;
}

/** Content-Disposition com nome ASCII + UTF-8 (RFC 6266). */
export function attachment(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
