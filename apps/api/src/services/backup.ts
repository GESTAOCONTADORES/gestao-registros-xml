import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context';

const PATTERN = /^backup-\d{4}-\d{2}-\d{2}_\d{6}\.tar\.gz$/;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function listBackups(dir: string) {
  try {
    return readdirSync(dir)
      .filter((f) => PATTERN.test(f))
      .map((f) => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** Gera um backup completo do banco embutido e remove os mais antigos. */
export async function runBackup(ctx: AppContext): Promise<string | null> {
  const { dir, keep } = ctx.config.backup;
  if (!dir || !ctx.db.backup) return null;
  mkdirSync(dir, { recursive: true });
  const data = await ctx.db.backup();
  const file = join(dir, `backup-${stamp()}.tar.gz`);
  writeFileSync(file, data);
  for (const old of listBackups(dir).slice(keep)) {
    try {
      unlinkSync(old.path);
    } catch {
      // ignora
    }
  }
  ctx.log.info({ file, bytes: data.length }, 'Backup do banco concluído');
  return file;
}

/** Agenda backups automáticos (somente banco embutido com BACKUP_DIR definido). */
export function scheduleBackups(ctx: AppContext): NodeJS.Timeout | null {
  const { dir, intervalHours } = ctx.config.backup;
  if (!dir || !ctx.db.backup) return null;
  const due = () => {
    const last = listBackups(dir)[0];
    return !last || Date.now() - last.mtime >= intervalHours * 3600_000;
  };
  const tick = () => {
    if (due()) runBackup(ctx).catch((err) => ctx.log.error({ err }, 'Falha no backup do banco'));
  };
  setTimeout(tick, 60_000); // 1 min após iniciar
  return setInterval(tick, 3600_000); // confere a cada hora
}
