import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createDb } from './client';
import { migrate } from './migrate';
import { seed } from './seed';

// .env da raiz do monorepo
config({ path: resolve(process.cwd(), '../../.env') });
config();

async function main() {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example)');
  // caminhos relativos do PGlite partem da raiz do monorepo
  const resolvedUrl = url.startsWith('pglite://./') ? `pglite://${resolve(process.cwd(), '../..', url.slice(9))}` : url;
  const db = await createDb(resolvedUrl, { ssl: process.env.DATABASE_SSL === 'true' });
  try {
    if (command === 'migrate') {
      const done = await migrate(db, undefined, console.log);
      console.log(done.length ? `${done.length} migration(s) aplicada(s).` : 'Banco já está atualizado.');
    } else if (command === 'seed') {
      await migrate(db);
      await seed(db, {}, console.log);
    } else {
      console.log('uso: cli.ts migrate | seed');
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
