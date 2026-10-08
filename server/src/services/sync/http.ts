/** HTTP com retry/backoff para as APIs externas (429, 5xx, timeouts). */

export class SyncError extends Error {
  /** code: not_connected | not_configured | token | permission | rate_limit | too_much_data | api | fx_missing | config */
  constructor(public code: string, message: string) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ReqOpts { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; retries?: number }

/** Busca JSON. Repete em 429/500/502/503/504 e falhas de rede com backoff exponencial (1s, 2s, 4s…). */
export async function requestJson<T = any>(url: string, o: ReqOpts = {}): Promise<T> {
  const retries = o.retries ?? 4;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        method: o.method ?? 'GET',
        headers: { Accept: 'application/json', ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
      });
      const text = await r.text();
      let j: any = null;
      try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 300) }; }
      if (r.ok) return j as T;
      const msg = errorMessage(j) ?? `HTTP ${r.status}`;
      // Meta "Please reduce the amount of data…" (código 1, HTTP 500): repetir igual não adianta, quem chamou precisa pedir menos
      if (TOO_MUCH_DATA.test(msg)) throw new SyncError('too_much_data', msg);
      if ([429, 500, 502, 503, 504].includes(r.status) && i < retries) { await sleep(retryAfter(r) ?? 1000 * 2 ** i); last = new SyncError('rate_limit', msg); continue; }
      if (r.status === 401) throw new SyncError('token', msg);
      if (r.status === 403) throw new SyncError('permission', msg);
      throw new SyncError('api', msg);
    } catch (e) {
      if (e instanceof SyncError) throw e;
      last = e;
      if (i < retries) { await sleep(1000 * 2 ** i); continue; }
    }
  }
  throw last instanceof SyncError ? last : new SyncError('api', `Falha de rede: ${(last as Error)?.message ?? last}`);
}

function retryAfter(r: Response) { const v = Number(r.headers.get('retry-after')); return v > 0 ? Math.min(v, 60) * 1000 : null; }

/** Mensagem de erro dos formatos Google ({error:{message}}), Meta ({error:{message,code}}) e OAuth. */
function errorMessage(j: any): string | null {
  if (!j) return null;
  if (Array.isArray(j) && j[0]?.error) j = j[0];
  const e = j.error;
  if (typeof e === 'string') return j.error_description ?? e;
  if (e?.message) {
    const detail = e.details?.[0]?.errors?.[0]?.message;   // Google Ads: detalhe do GoogleAdsFailure
    return detail ? `${e.message} · ${detail}` : e.message;
  }
  return null;
}

const TOO_MUCH_DATA = /reduce the amount of data/i;
/** Meta: consulta pesada demais (janela longa × level=ad × country). Solução: janela menor ou página menor. */
export function isMetaTooMuchData(e: unknown) {
  return e instanceof SyncError && (e.code === 'too_much_data' || TOO_MUCH_DATA.test(e.message));
}

/** Meta: erro de limite de uso (códigos 4, 17, 32, 613, 80004) → espera e tenta de novo. */
export function isMetaRateLimit(e: unknown) {
  return e instanceof SyncError && /\(#(4|17|32|613|80000|80004)\)|User request limit|too many calls|request limit reached/i.test(e.message);
}
export { sleep };
