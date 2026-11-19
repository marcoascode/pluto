/**
 * 0.18 · Cliente mínimo da Meta Graph API para os Perfis de contingência (Long-Lived User Token via Facebook Login;
 * Perfis legados ainda podem usar System User Token).
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
    // a Meta responde HTTP 400 (não 401/403) para token inválido (#190) e falta de permissão (#10, #200–#299, #294)
    if (e.code === 'api' && /\(#190\)/.test(e.message)) return new HttpError(422, 'meta_token_invalid', `Token recusado pela Meta: ${e.message}`);
    if (e.code === 'permission' || (e.code === 'api' && isMetaPermission(e))) return new HttpError(422, 'meta_permission', `Sem permissão na Meta: ${e.message}`);
    if (e.code === 'token') return new HttpError(422, 'meta_token_invalid', `Token recusado pela Meta: ${e.message}`);
    if (e.code === 'rate_limit') return new HttpError(429, 'meta_rate_limit', 'Limite de uso da Meta atingido. Tente de novo em instantes.');
    return new HttpError(502, 'meta_api', `Falha ao consultar a Meta: ${e.message}`);
  }
  return new HttpError(502, 'meta_api', 'Falha ao consultar a Meta.');
}

/** Erro de permissão da Graph API: códigos 10, 200–299 e 294 (ex.: "(#200) Permissions error"). */
export const isMetaPermission = (e: unknown) => e instanceof SyncError && /\(#(10|2\d\d|294)\)|Permissions error/i.test(e.message);

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

/** Escopos pedidos no Facebook Login e exigidos em todo Perfil conectado. */
export const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'public_profile'] as const;
export const missingScopes = (granted: string[]) => REQUIRED_SCOPES.filter((s) => !granted.includes(s));
export const missingMessage = (missing: string[]) => `O Perfil não concedeu ${missing.length > 1 ? 'as permissões' : 'a permissão'}: ${missing.join(', ')}. Clique em "Reconectar / Renovar" e marque ${missing.length > 1 ? 'todas' : 'essa permissão'} na janela da Meta.`;

export interface Permissions { granted: string[]; declined: string[] }
/** /me/permissions: permissões concedidas e recusadas pelo usuário que autorizou. */
export async function getPermissions(token: string): Promise<Permissions> {
  const p = await graphGet<{ data?: { permission: string; status: string }[] }>(token, 'me/permissions');
  const rows = p.data ?? [];
  return { granted: rows.filter((x) => x.status === 'granted').map((x) => x.permission), declined: rows.filter((x) => x.status !== 'granted').map((x) => x.permission) };
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

export interface AdAccountInfo { name: string | null; currency: string | null; status: number | null; userTasks: string[] | null }
/** user_tasks = o que o Perfil (usuário do token) pode fazer na conta: MANAGE, ADVERTISE, ANALYZE, DRAFT. */
export async function getAdAccountInfo(token: string, accountId: string): Promise<AdAccountInfo> {
  const a = await graphGet<{ name?: string; currency?: string; account_status?: number; user_tasks?: string[] }>(token, `act_${norm(accountId)}`, { fields: 'name,currency,account_status,user_tasks' });
  return { name: a.name ?? null, currency: a.currency ?? null, status: a.account_status ?? null, userTasks: Array.isArray(a.user_tasks) ? a.user_tasks : null };
}

const TASK_LABEL: Record<string, string> = { MANAGE: 'Gerenciar conta', ADVERTISE: 'Gerenciar campanhas', ANALYZE: 'Ver desempenho', DRAFT: 'Criar rascunhos' };
/**
 * Subir imagens e criar campanhas exige a tarefa ADVERTISE (ou MANAGE) do Perfil na conta. Sem ela a Meta responde só
 * "(#200) Permissions error". Devolve a mensagem de erro para a tela, ou null se o Perfil pode anunciar (ou se a Meta não informou).
 */
export function advertiseProblem(info: AdAccountInfo, accountId: string): string | null {
  const t = info.userTasks;
  if (!t || !t.length || t.includes('ADVERTISE') || t.includes('MANAGE')) return null;
  return `O Perfil não tem permissão para anunciar na conta ${info.name ? `"${info.name}" ` : ''}(${norm(accountId)}). Acesso atual: ${t.map((x) => TASK_LABEL[x] ?? x).join(', ')}. `
    + 'No Business Manager (Configurações do negócio → Contas de anúncios → Pessoas), dê a este Perfil o acesso "Gerenciar campanhas" (ou controle total) e tente de novo.';
}

/** Dica exibida junto a um "Permissions error" da Meta numa escrita (upload de imagem, criação de campanha). */
export const PERMISSION_HINT = 'Confira se o Perfil tem o acesso "Gerenciar campanhas" na conta de anúncios (Business Manager → Contas de anúncios → Pessoas), '
  + 'se a conta não está restrita/desativada e se o Perfil foi conectado concedendo a permissão ads_management. Depois clique em "Reconectar / Renovar" em Perfis & BMs.';

/* ---------------- eventos de conversão do Pixel (padrão + personalizados) ---------------- */
/** Nomes dos eventos padrão/automáticos do Pixel (o que não estiver aqui é evento personalizado — fbq('trackCustom', …)). */
const PIXEL_STANDARD = new Set(['PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead',
  'CompleteRegistration', 'Contact', 'CustomizeProduct', 'Donate', 'FindLocation', 'Schedule', 'StartTrial', 'SubmitApplication', 'Subscribe',
  'Microdata', 'SubscribedButtonClick', 'PageLeave', 'InputData']);

export interface MetaCustomConversion { id: string; name: string; eventType: string | null; pixelId: string | null; archived: boolean }
const toConversion = (c: any): MetaCustomConversion => ({ id: String(c.id), name: c.name ?? '', eventType: c.custom_event_type ?? null, pixelId: c.pixel?.id ? String(c.pixel.id) : null, archived: !!c.is_archived });

/** Conversões personalizadas da conta de anúncios (Gerenciador de Eventos → Conversões personalizadas). */
export async function listCustomConversions(token: string, accountId: string): Promise<MetaCustomConversion[]> {
  return (await graphList<any>(token, `act_${norm(accountId)}/customconversions`, { fields: 'id,name,custom_event_type,is_archived,pixel{id}' })).map(toConversion);
}
export async function getCustomConversion(token: string, id: string): Promise<MetaCustomConversion> {
  return toConversion(await graphGet<any>(token, id, { fields: 'id,name,custom_event_type,is_archived,pixel{id}' }));
}

/** Eventos personalizados recebidos pelo Pixel nos últimos `days` dias (estatística agregada por evento), mais recebidos primeiro. */
export async function listPixelCustomEvents(token: string, pixelId: string, days = 60): Promise<{ name: string; count: number }[]> {
  const start = Math.floor(Date.now() / 1000) - days * 86_400;
  const r = await graphGet<{ data?: { data?: { value?: string; count?: number }[] }[] }>(token, `${pixelId}/stats`, { aggregation: 'event', start_time: String(start) });
  const totals = new Map<string, number>();
  for (const bucket of r.data ?? []) for (const x of bucket.data ?? []) if (x.value && !PIXEL_STANDARD.has(x.value)) totals.set(x.value, (totals.get(x.value) ?? 0) + (Number(x.count) || 0));
  return [...totals.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
