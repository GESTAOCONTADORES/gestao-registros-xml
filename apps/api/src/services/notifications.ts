import type { Db } from '@gestao/database';
import type { NotificationType } from '@gestao/shared';

export interface NewNotification {
  title: string;
  message: string;
  type?: NotificationType;
  link?: string | null;
}

export async function notifyUsers(db: Db, userIds: number[], n: NewNotification): Promise<void> {
  if (!userIds.length) return;
  await db.query(
    `INSERT INTO notifications (user_id, title, message, type, link)
     SELECT unnest($1::int[]), $2, $3, $4, $5`,
    [userIds, n.title, n.message, n.type ?? 'INFO', n.link ?? null],
  );
}

export async function notifyMasters(db: Db, n: NewNotification): Promise<void> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'MASTER' AND status = 'ACTIVE'`);
  await notifyUsers(db, rows.map((r) => r.id), n);
}

export async function notifyAllActive(db: Db, n: NewNotification): Promise<void> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM users WHERE status = 'ACTIVE'`);
  await notifyUsers(db, rows.map((r) => r.id), n);
}

/** Configuração "Notificações por e-mail" (página Configurações). */
export async function emailNotificationsEnabled(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'email_notifications_enabled'`);
  return rows[0]?.value !== false;
}
