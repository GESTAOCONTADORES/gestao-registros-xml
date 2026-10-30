import type { Db } from '@gestao/database';
import type { AgentStatusDTO, JobType } from '@gestao/shared';
import type { AppContext } from '../context';
import { iso } from '../lib/http';

export const AGENT_OFFLINE_MESSAGE = 'O servidor responsável pelo acesso à pasta compartilhada está offline.';

export async function getAgentStatus(ctx: AppContext): Promise<AgentStatusDTO> {
  const { rows } = await ctx.db.query<Record<string, any>>(
    `SELECT *, (last_seen_at > now() - make_interval(secs => $1)) AS online FROM agent_status WHERE agent_id = 'default'`,
    [ctx.config.agent.offlineAfterSeconds],
  );
  const r = rows[0];
  if (!r) {
    return {
      online: false,
      lastSeenAt: null,
      version: null,
      hostname: null,
      rootPath: null,
      reportsPath: null,
      rootAccessible: null,
      lastError: null,
    };
  }
  return {
    online: !!r.online,
    lastSeenAt: iso(r.last_seen_at),
    version: r.version,
    hostname: r.hostname,
    rootPath: r.root_path,
    reportsPath: r.reports_path,
    rootAccessible: r.root_accessible,
    lastError: r.last_error,
  };
}

export async function enqueueJob(
  db: Db,
  type: JobType,
  payload: Record<string, unknown>,
  createdBy: number | null,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO agent_jobs (type, payload, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [type, JSON.stringify(payload), createdBy],
  );
  return rows[0]!.id;
}

/** Solicita ao agente que verifique se as pastas das empresas existem. */
export async function requestFolderCheck(db: Db, companyIds: number[] | 'ALL', createdBy: number | null) {
  const { rows } = await db.query<{ id: number; folder_name: string }>(
    companyIds === 'ALL'
      ? `SELECT id, folder_name FROM companies WHERE deleted_at IS NULL`
      : `SELECT id, folder_name FROM companies WHERE deleted_at IS NULL AND id = ANY($1::int[])`,
    companyIds === 'ALL' ? [] : [companyIds],
  );
  // evita fila acumulada de verificações idênticas
  await db.query(`UPDATE agent_jobs SET status = 'CANCELLED', finished_at = now()
                  WHERE type = 'CHECK_FOLDERS' AND status = 'PENDING' AND $1::boolean`, [companyIds === 'ALL']);
  return enqueueJob(
    db,
    'CHECK_FOLDERS',
    { companies: rows.map((r) => ({ companyId: r.id, folderName: r.folder_name })), listUnlinked: companyIds === 'ALL' },
    createdBy,
  );
}
