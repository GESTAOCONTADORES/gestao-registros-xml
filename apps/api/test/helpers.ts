import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createDb, migrate, seed, type Db } from '@gestao/database';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { MailMessage, Mailer } from '../src/services/mail';
import { AgentApi } from '../../windows-agent/src/api-client';
import { FileCache } from '../../windows-agent/src/cache';
import type { AgentConfig } from '../../windows-agent/src/config';
import { executeJob } from '../../windows-agent/src/jobs';
import { createLogger } from '../../windows-agent/src/logger';

export const AGENT_TOKEN = 'test-agent-token-0123456789abcdef';
export const MASTER = { username: 'Departamento pessoal', password: 'DP102030' };

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  baseUrl: string;
  mails: MailMessage[];
  root: string;
  close(): Promise<void>;
}

/**
 * Banco de teste: PGlite em memória por padrão. Com TEST_DATABASE_URL=postgres://... cada arquivo
 * de teste cria (e remove ao final) um banco próprio no PostgreSQL real.
 */
async function createTestDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return { db: await createDb('pglite://memory'), drop: async () => undefined };
  const name = `gestao_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = await createDb(url);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.close();
  const db = await createDb(url.replace(/\/[^/?]*(\?|$)/, `/${name}$1`));
  return {
    db,
    drop: async () => {
      const a = await createDb(url);
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.close();
    },
  };
}

export async function createTestEnv(): Promise<TestEnv> {
  const { db, drop } = await createTestDb();
  await migrate(db);
  await seed(db, { masterName: 'Departamento pessoal', masterDepartment: 'Departamento Pessoal', masterPassword: MASTER.password });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite://memory',
    JWT_ACCESS_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
    AGENT_API_TOKEN: AGENT_TOKEN,
    COOKIE_SECURE: 'false',
    DP_APPROVAL_EMAIL: 'dp@example.test',
    CORS_ORIGINS: 'http://localhost:5173',
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
  });
  const mails: MailMessage[] = [];
  const mail: Mailer = {
    configured: true,
    async send(m) {
      mails.push(m);
      return true;
    },
  };
  const app = await buildApp({ db, config, mail, logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const root = mkdtempSync(join(tmpdir(), 'dp-xml-root-'));
  return {
    app,
    db,
    baseUrl: `http://127.0.0.1:${port}`,
    mails,
    root,
    async close() {
      await app.close();
      await db.close();
      await drop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function login(env: TestEnv, username = MASTER.username, password = MASTER.password) {
  const res = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  return res.json().accessToken as string;
}

export function api(env: TestEnv, token?: string) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    env.app.inject({
      method,
      url,
      payload: payload as never,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    del: (url: string) => call('DELETE', url),
  };
}

/** Cria um usuário comum aprovado e devolve o token. */
export async function createActiveUser(env: TestEnv, masterToken: string, first = 'Bruno', last = 'Sales') {
  const res = await api(env, masterToken).post('/users', {
    firstName: first,
    lastName: last,
    department: 'Departamento Pessoal',
    password: 'senha123',
    role: 'USER',
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { token: await login(env, res.json().username, 'senha123'), user: res.json() };
}

export function writeXml(env: TestEnv, folder: string, name: string, content: string | Buffer) {
  const dir = join(env.root, folder, ...name.split('/').slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(env.root, folder, name), content);
}

export function agentConfig(env: TestEnv): AgentConfig {
  return {
    apiUrl: env.baseUrl,
    token: AGENT_TOKEN,
    rootPath: env.root,
    reportsFolderName: 'RELATORIOS ROBO',
    dataDir: join(env.root, '..', `agent-data-${Date.now()}`),
    pollIntervalMs: 50,
    heartbeatIntervalMs: 1000,
    batchMaxFiles: 3,
    batchMaxBytes: 16 * 1024 * 1024,
    maxFileBytes: 20 * 1024 * 1024,
    logRetentionDays: 1,
  };
}

/** Agente real (mesmo código do Windows) apontado para a API de teste. */
export function createTestAgent(env: TestEnv) {
  const config = agentConfig(env);
  const log = createLogger(null, 1, false);
  const agentApi = new AgentApi(config.apiUrl, config.token, log);
  const cache = new FileCache(join(config.dataDir, 'cache.json'));
  return {
    api: agentApi,
    config,
    async heartbeat() {
      await agentApi.heartbeat({
        version: 'test',
        hostname: 'test-host',
        rootPath: config.rootPath,
        reportsPath: join(config.rootPath, config.reportsFolderName),
        rootAccessible: true,
      });
    },
    /** Processa todos os jobs pendentes. */
    async drain(shuttingDown = () => false) {
      let n = 0;
      for (;;) {
        const job = await agentApi.nextJob();
        if (!job) return n;
        await executeJob({ api: agentApi, config, log, cache, shuttingDown }, job);
        n++;
      }
    },
  };
}

export const VALID_CNPJS = ['11222333000181', '45723174000110', '60701190000104', '33000167000101'];
