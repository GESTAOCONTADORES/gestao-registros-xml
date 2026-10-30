/**
 * Manutenção do banco embutido (serviço da API PARADO):
 *   node dist/maintenance.js backup              → gera backup-<data>.tar.gz em BACKUP_DIR
 *   node dist/maintenance.js restore <arquivo>   → restaura um backup
 * Lê a configuração de ENV_FILE (ou .env da pasta atual).
 * Na restauração, a pasta de dados atual é preservada com o sufixo ".antes-da-restauracao-<data>".
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createDb, restorePglite } from '@gestao/database';

function loadEnv() {
  for (const f of [process.env.ENV_FILE ?? '', resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (f && existsSync(f)) {
      loadDotenv({ path: f });
      return;
    }
  }
}

function pgliteDir(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('pglite://') || url === 'pglite://memory') {
    throw new Error('Disponível somente para o banco embutido (DATABASE_URL=pglite://...). Para PostgreSQL use pg_dump/pg_restore.');
  }
  const dir = url.slice('pglite://'.length);
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function backup() {
  const dir = pgliteDir();
  const out = process.env.BACKUP_DIR || join(dir, '..', 'backups');
  mkdirSync(out, { recursive: true });
  const db = await createDb(`pglite://${dir}`);
  const data = await db.backup!();
  await db.close();
  const file = join(out, `backup-${stamp()}.tar.gz`);
  writeFileSync(file, data);
  console.log(`Backup gerado: ${file}`);
}

async function restore(file: string | undefined) {
  if (!file || !existsSync(file)) throw new Error('Informe um arquivo de backup existente (backup-....tar.gz).');
  const dir = pgliteDir();
  const tag = stamp();
  // 1º restaura numa pasta temporária; o banco atual só é trocado se tudo der certo
  const temp = `${dir}.restaurando-${tag}`;
  try {
    await restorePglite(temp, readFileSync(file));
  } catch (e) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`O backup não pôde ser lido; o banco atual NÃO foi alterado. (${(e as Error).message})`);
  }
  if (existsSync(dir)) {
    const keep = `${dir}.antes-da-restauracao-${tag}`;
    renameSync(dir, keep);
    console.log(`Banco atual preservado em: ${keep}`);
  }
  renameSync(temp, dir);
  console.log(`Backup restaurado: ${file}`);
}

async function main() {
  loadEnv();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'backup') await backup();
  else if (cmd === 'restore') await restore(arg);
  else throw new Error('uso: maintenance.js backup | restore <arquivo>');
}

main().catch((e) => {
  console.error(`Falha: ${(e as Error).message}`);
  process.exit(1);
});
