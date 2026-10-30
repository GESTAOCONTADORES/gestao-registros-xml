import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Log técnico com rotação diária (agent-AAAA-MM-DD.log) e retenção configurável.
 * Formato: 2026-10-30 11:30:01 INFO Pesquisa iniciada
 */
export function createLogger(dir: string | null, retentionDays = 30, echo = true): Logger {
  let currentDay = '';
  if (dir) mkdirSync(dir, { recursive: true });

  const prune = () => {
    if (!dir) return;
    const limit = Date.now() - retentionDays * 86400_000;
    for (const f of readdirSync(dir)) {
      if (!/^agent-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      try {
        if (statSync(join(dir, f)).mtimeMs < limit) unlinkSync(join(dir, f));
      } catch {
        // ignora
      }
    }
  };

  const write = (level: Level, msg: string) => {
    const now = new Date();
    const line = `${stamp(now)} ${level} ${msg}`;
    if (echo) (level === 'ERROR' ? console.error : console.log)(line);
    if (!dir) return;
    const d = day(now);
    if (d !== currentDay) {
      currentDay = d;
      prune();
    }
    try {
      appendFileSync(join(dir, `agent-${d}.log`), line + '\n', 'utf8');
    } catch {
      // disco cheio ou sem permissão: não derruba o agente
    }
  };

  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    debug: (m) => {
      if (process.env.AGENT_DEBUG === 'true') write('DEBUG', m);
    },
  };
}
