/**
 * 0.18 · Cliente mínimo da Meta Graph API para os Perfis/BMs de contingência (System User Access Token).
 * O token vai no cabeçalho Authorization (nunca na URL, para não aparecer em logs) e nunca é logado nem devolvido.
 */
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { isMetaRateLimit, requestJson, sleep, SyncError } from './sync/http.js';

const base = () => `${config.api.metaGraph}/${config.oauth.metaApiVersion}`;
const MAX_PAGES = 20;

/** Erro da Graph API → HttpError (nunca 401, que na tela significa "sessão expirada"). */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof SyncError) {
    if (e.code === 'token') return new HttpError(422, 'meta_token_invalid', `Token recusado pela Meta: ${e.message}`);
    if (e.code === 'permission') return new HttpError(422, 'meta_permission', `Sem permissão na Meta: ${e.message}`);
    if (e.code === 'rate_limit') return new HttpError(429, 'meta_rate_limit', 'Limite de uso da Meta atingido. Tente de novo em instantes.');
    return new HttpError(502, 'meta_api', `Falha ao consultar a Meta: ${e.message}`);
  }
  return new HttpError(502, 'meta_api', 'Falha ao consultar a Meta.');
}

export async function graphGet<T = any>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  return requestJson<T>(`${base()}/${path}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, retries: 2, timeoutMs: 30_000 });
}

/** Lista paginada (cursor `after`; não segue paging.next para nunca mandar o token a outro host). */
export async function graphList<T = any>(token: string, path: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await graphGet<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(token, path, { limit: '100', ...params, ...(after ? { after } : {}) });
    out.push(...(r.data ?? []));
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

export interface TokenCheck { ok: boolean; systemUserId?: string; systemUserName?: string; scopes: string[]; message?: string }

/** Valida o System User Token: /me (identidade) + /me/permissions (escopos concedidos). */
export async function validateToken(token: string): Promise<TokenCheck> {
  try {
    const me = await graphGet<{ id: string; name?: string }>(token, 'me', { fields: 'id,name' });
    let scopes: string[] = [];
    try {
      const p = await graphGet<{ data?: { permission: string; status: string }[] }>(token, 'me/permissions');
      scopes = (p.data ?? []).filter((x) => x.status === 'granted').map((x) => x.permission);
    } catch { /* System Users nem sempre expõem /me/permissions; o token continua válido */ }
    return { ok: true, systemUserId: me.id, systemUserName: me.name, scopes };
  } catch (e) {
    if (e instanceof SyncError && (e.code === 'token' || e.code === 'permission' || (e.http && e.http < 500 && e.code !== 'rate_limit'))) return { ok: false, scopes: [], message: e.message };
    throw toHttpError(e);
  }
}

const norm = (id: string) => id.replace(/^act_/, '');

export interface MetaAdAccount { id: string; name: string; status: number | null; currency: string | null; timezone: string | null; businessId: string | null }
export async function listAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const rows = await graphList<any>(token, 'me/adaccounts', { fields: 'account_id,id,name,account_status,currency,timezone_name,business{id}' });
  return rows.map((a) => ({ id: norm(String(a.account_id ?? a.id)), name: a.name ?? '', status: a.account_status ?? null, currency: a.currency ?? null, timezone: a.timezone_name ?? null, businessId: a.business?.id ?? null }));
}

export interface MetaPage { id: string; name: string; category: string | null; tasks: string[] }
export async function listPages(token: string, businessId: string | null): Promise<MetaPage[]> {
  const map = new Map<string, MetaPage>();
  const add = (rows: any[]) => rows.forEach((p) => map.set(String(p.id), { id: String(p.id), name: p.name ?? '', category: p.category ?? null, tasks: p.tasks ?? [] }));
  add(await graphList<any>(token, 'me/accounts', { fields: 'id,name,category,tasks' }).catch(() => []));
  if (businessId) for (const edge of ['owned_pages', 'client_pages']) add(await graphList<any>(token, `${businessId}/${edge}`, { fields: 'id,name,category' }).catch(() => []));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface MetaDataset { id: string; name: string; lastFiredAt: string | null; unavailable: boolean }
const toDataset = (p: any): MetaDataset => ({ id: String(p.id), name: p.name ?? '', lastFiredAt: p.last_fired_time ?? null, unavailable: !!p.is_unavailable });
const DS_FIELDS = 'id,name,last_fired_time,is_unavailable';
/** Datasets do Business Manager (owned + client). */
export async function listBusinessDatasets(token: string, businessId: string): Promise<MetaDataset[]> {
  const map = new Map<string, MetaDataset>();
  for (const edge of ['owned_pixels', 'client_pixels']) (await graphList<any>(token, `${businessId}/${edge}`, { fields: DS_FIELDS }).catch(() => [])).forEach((p) => map.set(String(p.id), toDataset(p)));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** Pixels de uma conta de anúncios. */
export async function listAdAccountPixels(token: string, accountId: string): Promise<MetaDataset[]> {
  return (await graphList<any>(token, `act_${norm(accountId)}/adspixels`, { fields: DS_FIELDS })).map(toDataset);
}

/* ---------------- escrita (Etapa 3) ---------------- */
/** Esperas antes de repetir uma chamada que bateu no limite de uso da Meta (5s, 15s, 45s). */
const RATE_LIMIT_WAITS_MS = [5_000, 15_000, 45_000];

export interface CallInfo { attempts: number; rateLimited: boolean }

/**
 * Executa uma escrita na Graph API. Só repete quando a Meta diz que o limite de uso foi atingido (a chamada foi recusada,
 * então repetir não duplica nada). Falha de rede/5xx NÃO é repetida: a criação pode ter acontecido e repetir geraria
 * objetos duplicados — o erro sobe e fica registrado na etapa.
 */
export async function withRateLimit<T>(fn: () => Promise<T>, info: CallInfo, onWait?: (ms: number) => void): Promise<T> {
  for (let i = 0; ; i++) {
    info.attempts++;
    try { return await fn(); } catch (e) {
      const limited = e instanceof SyncError && (e.code === 'rate_limit' || isMetaRateLimit(e));
      if (!limited) throw e;
      info.rateLimited = true;
      if (i >= RATE_LIMIT_WAITS_MS.length) throw e;
      onWait?.(RATE_LIMIT_WAITS_MS[i]);
      await sleep(RATE_LIMIT_WAITS_MS[i]);
    }
  }
}

/** POST JSON (objetos aninhados vão direto no corpo). Sem retry interno do requestJson (ver withRateLimit). */
export function graphPost<T = any>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
  return requestJson<T>(`${base()}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body, retries: 0, timeoutMs: 45_000 });
}

export function graphDelete<T = any>(token: string, path: string): Promise<T> {
  return requestJson<T>(`${base()}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, retries: 0, timeoutMs: 30_000 });
}

/** Sobe UMA imagem (direto do buffer em memória) para a biblioteca da conta e devolve o image_hash. Nada é gravado em disco. */
export async function uploadAdImage(token: string, accountId: string, data: Buffer, filename: string): Promise<{ hash: string; url: string | null }> {
  const form = new FormData();
  form.append('filename', new Blob([new Uint8Array(data)]), filename);   // o nome do campo vira a chave em `images`
  const r = await requestJson<{ images?: Record<string, { hash?: string; url?: string }> }>(`${base()}/act_${norm(accountId)}/adimages`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, retries: 0, timeoutMs: 90_000 });
  const img = Object.values(r.images ?? {})[0];
  if (!img?.hash) throw new SyncError('api', 'A Meta não devolveu o image_hash da imagem.');
  return { hash: img.hash, url: img.url ?? null };
}

export interface AdAccountInfo { currency: string | null; status: number | null }
export async function getAdAccountInfo(token: string, accountId: string): Promise<AdAccountInfo> {
  const a = await graphGet<{ currency?: string; account_status?: number }>(token, `act_${norm(accountId)}`, { fields: 'currency,account_status' });
  return { currency: a.currency ?? null, status: a.account_status ?? null };
}
