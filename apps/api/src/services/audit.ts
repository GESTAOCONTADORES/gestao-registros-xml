import type { FastifyRequest } from 'fastify';
import type { AuditAction } from '@gestao/shared';
import type { Db } from '@gestao/database';

export interface AuditEntry {
  userId?: number | null;
  action: AuditAction;
  entity?: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
  req?: FastifyRequest;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const userId = entry.userId !== undefined ? entry.userId : entry.req?.user?.id ?? null;
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      entry.action,
      entry.entity ?? null,
      entry.entityId != null ? String(entry.entityId) : null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.req?.ip ?? null,
      entry.req?.headers['user-agent']?.slice(0, 300) ?? null,
    ],
  );
}
