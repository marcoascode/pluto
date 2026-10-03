/**
 * Cliente HTTP único do front.
 * - Chama sempre /api/* (o Next repassa para o Node.js via rewrite, ver next.config.mjs).
 * - Envia o cookie de sessão (credentials: 'include'); o token nunca fica no JavaScript.
 * - Em modo mock (VITE_API_MOCK=true) responde com dados gerados no navegador.
 */
import type { ApiErrorBody } from '@/types/api';

export const API_BASE = '/api';
export const IS_MOCK = import.meta.env.VITE_API_MOCK === 'true';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
/** O AuthProvider registra aqui o que fazer quando a sessão expira (401). */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: Method, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  if (IS_MOCK) {
    const { mockRequest } = await import('@/mocks/handlers');
    return mockRequest<T>(method, path, opts.query, opts.body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (res.status === 401 && onUnauthorized) onUnauthorized();
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Erro ${res.status}`);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') throw new ApiError(0, 'timeout', 'O servidor demorou para responder. Tente de novo.');
    throw new ApiError(0, 'network', 'Sem conexão com o servidor.');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
};
