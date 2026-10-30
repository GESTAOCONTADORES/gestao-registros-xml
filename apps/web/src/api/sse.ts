import type { RunEventDTO } from '@gestao/shared';
import { API_URL, get, getAccessToken, refreshSession } from './client';

export interface RunStreamHandlers {
  onEvent: (event: RunEventDTO, name: 'progress' | 'done') => void;
  onError?: (err: unknown) => void;
}

/**
 * Leitor de Server-Sent Events via fetch + ReadableStream (EventSource não envia
 * o cabeçalho Authorization). Reconecta com backoff e, entre tentativas,
 * consulta GET /runs/:id para não perder o estado.
 */
export function subscribeRun(runId: number, handlers: RunStreamHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;
  let attempt = 0;

  const isFinished = (e: RunEventDTO) => !['QUEUED', 'RUNNING'].includes(e.run.status);

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        let token = getAccessToken();
        let res = await fetch(`${API_URL}/runs/${runId}/events`, {
          headers: { Authorization: `Bearer ${token ?? ''}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401) {
          await refreshSession();
          token = getAccessToken();
          res = await fetch(`${API_URL}/runs/${runId}/events`, {
            headers: { Authorization: `Bearer ${token ?? ''}`, Accept: 'text/event-stream' },
            signal: controller.signal,
          });
        }
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        attempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let name = 'message';
            const data: string[] = [];
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) name = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (!data.length) continue;
            const payload = JSON.parse(data.join('\n')) as RunEventDTO;
            if (name === 'done' || isFinished(payload)) {
              finished = true;
              handlers.onEvent(payload, 'done');
            } else handlers.onEvent(payload, 'progress');
          }
        }
        if (finished) return;
      } catch (err) {
        if (stopped || (err as Error).name === 'AbortError') return;
        handlers.onError?.(err);
      }
      // conexão caiu: consulta o estado atual e tenta de novo
      try {
        const current = await get<RunEventDTO>(`/runs/${runId}`);
        if (isFinished(current)) {
          handlers.onEvent(current, 'done');
          return;
        }
        handlers.onEvent(current, 'progress');
      } catch {
        // servidor indisponível: continua tentando
      }
      attempt++;
      const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));
      await new Promise((r) => setTimeout(r, delay));
    }
  };
  void connect();
  return () => {
    stopped = true;
    controller.abort();
  };
}
