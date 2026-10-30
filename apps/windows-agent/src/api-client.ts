import http from 'node:http';
import https from 'node:https';
import type {
  AgentCompleteInput,
  AgentControlResponse,
  AgentFilesBatchInput,
  AgentFilesBatchResult,
  AgentHeartbeatInput,
  AgentJob,
  AgentProgressInput,
} from '@gestao/shared';
import type { Logger } from './logger';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawResponse {
  status: number;
  body: Buffer;
}

/** HTTP(S) com node:http — mais compatível que fetch em ambientes Windows restritos. */
function send(url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number) {
  return new Promise<RawResponse>((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`tempo esgotado após ${Math.round(timeoutMs / 1000)}s`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Cliente HTTP do agente. Toda comunicação é de SAÍDA, autenticada com AGENT_API_TOKEN. */
export class AgentApi {
  constructor(
    private baseUrl: string,
    private token: string,
    private log: Logger,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, opts: { retries?: number; raw?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const retries = opts.retries ?? 4;
    let attempt = 0;
    for (;;) {
      try {
        const res = await send(
          `${this.baseUrl}${path}`,
          method,
          {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body !== undefined ? JSON.stringify(body) : undefined,
          opts.timeoutMs ?? 120_000,
        );
        if (res.status < 200 || res.status >= 300) {
          let message = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(res.body.toString('utf8')) as { message?: string };
            if (j.message) message = j.message;
          } catch {
            // corpo não-JSON
          }
          throw new ApiError(res.status, message);
        }
        if (opts.raw) return res.body as T;
        return JSON.parse(res.body.toString('utf8')) as T;
      } catch (e) {
        const retriable = !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
        if (!retriable || attempt >= retries) throw e;
        const wait = Math.min(30_000, 1000 * 2 ** attempt);
        this.log.warn(`Falha de comunicação com a API (${(e as Error).message}); nova tentativa em ${wait / 1000}s`);
        attempt++;
        await sleep(wait);
      }
    }
  }

  heartbeat(input: AgentHeartbeatInput) {
    return this.request<{ ok: boolean }>('POST', '/agent/heartbeat', input, { retries: 0, timeoutMs: 15_000 });
  }

  async nextJob(): Promise<AgentJob | null> {
    const r = await this.request<{ job: AgentJob | null }>('POST', '/agent/jobs/next', {}, { retries: 0, timeoutMs: 15_000 });
    return r.job;
  }

  progress(jobId: number, input: AgentProgressInput) {
    return this.request<AgentControlResponse>('POST', `/agent/jobs/${jobId}/progress`, input);
  }

  async checkHashes(runId: number, hashes: string[]): Promise<Set<string>> {
    if (!hashes.length) return new Set();
    const r = await this.request<{ known: string[] }>('POST', `/agent/runs/${runId}/check-hashes`, { hashes });
    return new Set(r.known);
  }

  sendFiles(runId: number, batch: AgentFilesBatchInput) {
    return this.request<AgentFilesBatchResult>('POST', `/agent/runs/${runId}/files`, batch);
  }

  complete(jobId: number, input: AgentCompleteInput) {
    return this.request<{ ok: boolean }>('POST', `/agent/jobs/${jobId}/complete`, input);
  }

  reportPdf(reportId: number) {
    return this.request<Buffer>('GET', `/agent/reports/${reportId}/pdf`, undefined, { raw: true });
  }
}
