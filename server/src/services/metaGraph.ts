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

/** Permissões que o System User Token precisa ter marcado ao ser gerado no Business Manager. */
export const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'] as const;
export const missingScopes = (granted: string[]) => REQUIRED_SCOPES.filter((s) => !granted.includes(s));
export const missingMessage = (missing: string[]) => `O token não tem ${missing.length > 1 ? 'as permissões' : 'a permissão'}: ${missing.join(', ')}. Gere o token de novo no Business Manager marcando ${missing.length > 1 ? 'todas' : 'essa permissão'}.`;

export interface TokenCheck {
  ok: boolean; systemUserId?: string; systemUserName?: string;
  /** Permissões concedidas ao token (debug_token; /me/permissions como reserva). */
  scopes: string[];
  /** Das 5 obrigatórias, as que faltam. Só é confiável quando ok = true. */
  missing: string[];
  appId?: string;
  /** null = o token não expira. */
  expiresAt?: string | null;
  message?: string;
}

interface DebugToken { data?: { is_valid?: boolean; app_id?: string; scopes?: string[]; expires_at?: number; error?: { message?: string } } }

/**
 * Valida o System User Token na Graph API:
 *  1. /me → identidade do System User;
 *  2. /debug_token (escopos reais, validade, App emissor). Usa o token do App (APP_ID|APP_SECRET) quando configurado e, sem ele, o próprio token;
 *  3. /me/permissions só como reserva se o debug_token não responder.
 * Se não for possível ler as permissões, lança erro (502) em vez de dar o token por completo.
 */
export async function validateToken(token: string): Promise<TokenCheck> {
  try {
    const me = await graphGet<{ id: string; name?: string }>(token, 'me', { fields: 'id,name' });
    const { metaAppId, metaAppSecret } = config.oauth;
    let scopes: string[] | null = null, appId: string | undefined, expiresAt: string | null | undefined;
    try {
      const inspector = metaAppId && metaAppSecret ? `${metaAppId}|${metaAppSecret}` : token;
      const d = (await graphGet<DebugToken>(inspector, 'debug_token', { input_token: token })).data;
      if (d) {
        if (d.is_valid === false) return { ok: false, scopes: [], missing: [...REQUIRED_SCOPES], message: d.error?.message ?? 'Token expirado ou revogado.' };
        appId = d.app_id;
        expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null;
        if (Array.isArray(d.scopes)) scopes = d.scopes;
      }
    } catch { /* cai para /me/permissions */ }
    if (metaAppId && appId && appId !== metaAppId) return { ok: false, scopes: [], missing: [...REQUIRED_SCOPES], appId, message: 'O token foi gerado para outro App. Na hora de gerar o token, selecione o App do Pluto Mídia.' };
    if (!scopes?.length) {
      const p = await graphGet<{ data?: { permission: string; status: string }[] }>(token, 'me/permissions');
      scopes = (p.data ?? []).filter((x) => x.status === 'granted').map((x) => x.permission);
    }
    if (!scopes.length) throw new HttpError(502, 'meta_scopes_unreadable', 'Não foi possível ler as permissões do token na Meta. Tente de novo.');
    return { ok: true, systemUserId: me.id, systemUserName: me.name, scopes, missing: missingScopes(scopes), appId, expiresAt };
  } catch (e) {
    if (e instanceof SyncError && (e.code === 'token' || e.code === 'permission' || (e.http && e.http < 500 && e.code !== 'rate_limit'))) return { ok: false, scopes: [], missing: [...REQUIRED_SCOPES], message: e.message };
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
