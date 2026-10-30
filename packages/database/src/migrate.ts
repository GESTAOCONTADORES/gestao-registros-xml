import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './client';

/** Pasta das migrations. Pode ser sobrescrita (build empacotado) via MIGRATIONS_DIR. */
export function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  // fonte (packages/database/src) ou build empacotado da API (apps/api/dist)
  const candidates = [join(here, '..', 'migrations'), join(here, 'migrations')];
  return candidates.find((c) => existsSync(join(c, '001_init.sql'))) ?? candidates[0]!;
}

export async function migrate(db: Db, dir = migrationsDir(), log: (msg: string) => void = () => undefined) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    executed.push(file);
    log(`migration aplicada: ${file}`);
  }
  return executed;
}
