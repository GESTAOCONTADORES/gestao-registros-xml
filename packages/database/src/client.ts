import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  readonly kind: 'pg' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Executa `fn` numa transação. Dentro dela use somente o `tx` recebido. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Executa SQL com vários comandos (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  ssl?: boolean;
}

/**
 * Cria a conexão.
 *  - postgres://...           → PostgreSQL (produção)
 *  - pglite://./data/pglite    → PostgreSQL embutido gravado em disco (desenvolvimento)
 *  - pglite://memory           → PostgreSQL embutido em memória (testes)
 */
export async function createDb(url: string, options: CreateDbOptions = {}): Promise<Db> {
  if (url.startsWith('pglite://')) return createPgliteDb(url.slice('pglite://'.length));
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return createPgDb(url, options);
  throw new Error('DATABASE_URL inválida: use postgres://... ou pglite://...');
}

function createPgDb(url: string, options: CreateDbOptions): Db {
  // datas "date" como texto para não sofrer com fuso horário
  pg.types.setTypeParser(1082, (v) => v);
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
  });

  const wrap = (client: pg.Pool | pg.PoolClient): Omit<Db, 'transaction' | 'close'> => ({
    kind: 'pg',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  const db: Db = {
    ...wrap(pool),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Db = {
          ...wrap(client),
          transaction: (inner) => inner(tx),
          close: async () => undefined,
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return db;
}

async function createPgliteDb(location: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  let dataDir: string | undefined;
  if (location && location !== 'memory') {
    dataDir = resolve(location);
    mkdirSync(dataDir, { recursive: true });
  }
  const lite = new PGlite({ dataDir, extensions: { pg_trgm } });
  await lite.waitReady;

  type LiteLike = Pick<InstanceType<typeof PGlite>, 'query' | 'exec'>;
  const wrap = (client: LiteLike): Omit<Db, 'transaction' | 'close'> => ({
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query<T>(sql, params as unknown[]);
      // em SELECT o PGlite informa affectedRows = 0: vale o número de linhas retornadas
      return { rows: res.rows, rowCount: Math.max(res.rows.length, res.affectedRows ?? 0) };
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
  });

  const db: Db = {
    ...wrap(lite),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return lite.transaction(async (liteTx) => {
        const tx: Db = {
          ...wrap(liteTx as unknown as LiteLike),
          transaction: (inner) => inner(tx),
          close: async () => undefined,
        };
        return fn(tx);
      }) as Promise<T>;
    },
    async close() {
      await lite.close();
    },
  };
  return db;
}
