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
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { message?: string };
            if (j.message) message = j.message;
          } catch {
            // corpo não-JSON
          }
          // 4xx não adianta repetir (exceto 429)
          if (res.status < 500 && res.status !== 429) throw new ApiError(res.status, message);
          throw new ApiError(res.status, message);
        }
        if (opts.raw) return Buffer.from(await res.arrayBuffer()) as T;
        return (await res.json()) as T;
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
