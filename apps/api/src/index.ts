import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createDb, migrate, seed } from '@gestao/database';
import { buildApp } from './app';
import { loadConfig } from './config';
import { scheduleBackups } from './services/backup';
import { runWatchdog } from './services/runs';

/**
 * Carrega o .env da raiz do monorepo (ou da pasta atual). Caminhos relativos
 * (pglite://./data, LOGO_PATH=./apps/...) passam a valer a partir da pasta do .env.
 */
function loadEnv() {
  // ENV_FILE: caminho explícito (serviço do Windows: C:\ProgramData\GestaoXmlServidor\.env)
  const candidates = [process.env.ENV_FILE ?? '', resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].filter(Boolean);
  const file = candidates.find((f) => existsSync(f));
  if (!file) return;
  loadDotenv({ path: file });
  const base = dirname(file);
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('pglite://') && url !== 'pglite://memory') {
    const p = url.slice('pglite://'.length);
    if (!isAbsolute(p)) process.env.DATABASE_URL = `pglite://${resolve(base, p)}`;
  }
  for (const key of ['LOGO_PATH', 'BACKUP_DIR']) {
    const v = process.env[key];
    if (v && !isAbsolute(v)) process.env[key] = resolve(base, v);
  }
}

async function main() {
  loadEnv();
  const config = loadConfig();
  const db = await createDb(config.databaseUrl, { ssl: config.databaseSsl });
  const app = await buildApp({ db, config });

  if (config.autoMigrate) {
    await migrate(db, undefined, (m) => app.log.info(m));
    await seed(db, {}, (m) => app.log.info(m));
  }

  const backups = scheduleBackups(app.ctx);
  const watchdog = setInterval(() => {
    runWatchdog(app.ctx).catch((err) => app.log.error({ err }, 'Falha no vigia de execuções'));
  }, 30_000);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido — encerrando`);
    clearInterval(watchdog);
    if (backups) clearInterval(backups);
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
