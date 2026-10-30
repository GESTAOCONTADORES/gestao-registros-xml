import type { SessionDTO } from '@gestao/shared';

// "same-origin": o site é servido pela própria API (instalação local / teste)
const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3333';
export const API_URL = RAW_API_URL === 'same-origin' ? '' : RAW_API_URL.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// O token de acesso fica somente em memória (nunca em localStorage).
let accessToken: string | null = null;
let onSession: ((s: SessionDTO | null) => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
/** Callback chamado quando a sessão é renovada ou perdida. */
export function onSessionChange(cb: (s: SessionDTO | null) => void) {
  onSession = cb;
}

let refreshing: Promise<SessionDTO | null> | null = null;

/** Renovação "single-flight": várias requisições com 401 aguardam a mesma renovação. */
export function refreshSession(): Promise<SessionDTO | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await res.json()) as SessionDTO;
      setAccessToken(session.accessToken);
      onSession?.(session);
      return session;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  let body: { message?: string; code?: string; details?: Record<string, string> } = {};
  try {
    body = await res.json();
  } catch {
    // corpo não-JSON
  }
  const fallback =
    res.status === 403
      ? 'Você não tem permissão para realizar esta ação.'
      : res.status === 404
        ? 'Registro não encontrado.'
        : res.status >= 500
          ? 'Erro no servidor. Tente novamente em instantes.'
          : 'Não foi possível concluir a operação.';
  return new ApiError(res.status, body.message ?? fallback, body.code, body.details);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | number[]>;
  signal?: AbortSignal;
  /** Não tenta renovar a sessão em caso de 401 (rotas de login). */
  noRefresh?: boolean;
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function rawRequest(path: string, opts: RequestOptions = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${buildQuery(opts.query)}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: path.startsWith('/auth/') ? 'include' : 'omit',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.', 'NETWORK');
  }
  if (res.status === 401 && !opts.noRefresh && !retried) {
    const session = await refreshSession();
    if (session) return rawRequest(path, opts, true);
    onSession?.(null);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // ignora
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** Download autenticado: busca com o token, gera um blob local e dispara o "salvar como". */
export async function download(path: string, opts: { method?: string; body?: unknown; fallbackName?: string } = {}) {
  const res = await rawRequest(path, { method: opts.method, body: opts.body });
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get('Content-Disposition'), opts.fallbackName ?? 'arquivo');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

/** Abre o conteúdo (ex.: HTML) numa nova aba a partir de um blob local. */
export async function openBlob(path: string) {
  const win = window.open('', '_blank');
  const res = await rawRequest(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
