import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface AgentConfig {
  apiUrl: string;
  token: string;
  rootPath: string;
  reportsFolderName: string;
  dataDir: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  batchMaxFiles: number;
  batchMaxBytes: number;
  maxFileBytes: number;
  logRetentionDays: number;
}

export const AGENT_VERSION = '1.0.0';

/** Lê um arquivo .env simples (CHAVE=valor) sem sobrescrever variáveis já definidas. */
export function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const apiUrl = (env.API_URL ?? '').replace(/\/+$/, '');
  const token = env.AGENT_API_TOKEN ?? '';
  if (!apiUrl) throw new Error('API_URL não configurada (.env do agente)');
  if (token.length < 24) throw new Error('AGENT_API_TOKEN não configurado ou muito curto (.env do agente)');
  const url = new URL(apiUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local && env.ALLOW_INSECURE_HTTP !== 'true') {
    throw new Error('API_URL deve usar HTTPS (o token do agente nunca deve trafegar sem criptografia)');
  }
  const defaultData = process.platform === 'win32' ? join(env.ProgramData ?? 'C:\\ProgramData', 'GestaoXmlAgent') : join(process.cwd(), 'agent-data');
  return {
    apiUrl,
    token,
    rootPath: env.ROOT_PATH || 'G:\\Drives compartilhados\\Departamento Pessoal\\REGISTROS ROBO XML - PDF',
    reportsFolderName: env.REPORTS_FOLDER_NAME || 'RELATORIOS ROBO',
    dataDir: env.DATA_DIR || defaultData,
    pollIntervalMs: num(env.POLL_INTERVAL_MS, 3000),
    heartbeatIntervalMs: num(env.HEARTBEAT_INTERVAL_MS, 15000),
    batchMaxFiles: num(env.BATCH_MAX_FILES, 50),
    batchMaxBytes: num(env.BATCH_MAX_MB, 16) * 1024 * 1024,
    maxFileBytes: num(env.MAX_XML_FILE_MB, 20) * 1024 * 1024,
    logRetentionDays: num(env.LOG_RETENTION_DAYS, 30),
  };
}

/** Pasta do executável (onde fica o .env em produção). */
export function appDir(): string {
  return process.argv[1] ? dirname(process.argv[1]) : process.cwd();
}
