/**
 * 0.18.2 · Perfis Meta conectados via Facebook Login (OAuth 2.0) — contingência multi-perfil por gestor.
 *
 *  - URL de autorização com `state` assinado (HMAC, chave TOKEN_ENCRYPTION_KEY), preso ao usuário logado e com validade de 10 min;
 *  - code → short-lived token → Long-Lived User Access Token (~60 dias, fb_exchange_token);
 *  - sincronização dos ativos acessíveis pelo token (BMs, contas de anúncios, Páginas, Pixels/Datasets) para meta_profile_assets.
 *
 * Tokens nunca vão para log, para a URL de redirecionamento do navegador nem para o frontend.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { HttpError } from '../lib/http.js';
import { graphGet, graphList, listAdAccounts, REQUIRED_SCOPES } from './metaGraph.js';
import { requestJson, SyncError } from './sync/http.js';

const v = () => config.oauth.metaApiVersion;
const LONG_LIVED_FALLBACK_SECS = 60 * 86400;

/* ---------------- configuração ---------------- */
export function assertOAuthConfigured() {
  const { metaAppId, metaAppSecret } = config.oauth;
  if (!metaAppId || !metaAppSecret) throw new HttpError(501, 'oauth_not_configured', 'O Facebook Login não está configurado no servidor (META_APP_ID e META_APP_SECRET).');
  return { appId: metaAppId, appSecret: metaAppSecret };
}
/** Precisa estar em "URIs de redirecionamento do OAuth válidos" no App da Meta. O Nginx remove o /api antes de chegar na API. */
export const profilesRedirectUri = () => config.oauth.metaProfilesRedirectUri ?? `${config.appUrl}/api/meta/oauth/callback`;

/* ---------------- state assinado ---------------- */
const sign = (s: string) => createHmac('sha256', Buffer.from(config.tokenEncKey, 'base64')).update(`meta-profiles:${s}`).digest('base64url');
export type AuthMode = 'rerequest' | 'reauthenticate';
interface State { u: string; exp: number; n: string; p?: string }

export function makeState(userId: string, profileId?: string): string {
  const s: State = { u: userId, exp: Date.now() + 10 * 60_000, n: randomBytes(9).toString('base64url'), ...(profileId ? { p: profileId } : {}) };
  const body = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function checkState(state: string, userId: string): State {
  const [body, sig] = String(state).split('.');
  const good = !!body && !!sig && sig.length === sign(body).length && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)));
  let s: State | null = null;
  try { s = good ? (JSON.parse(Buffer.from(body, 'base64url').toString()) as State) : null; } catch { s = null; }
  if (!s || s.u !== userId || s.exp < Date.now()) throw new HttpError(400, 'invalid_state', 'A autorização expirou ou não pertence a esta sessão. Clique em "Conectar Perfil do Facebook" de novo.');
  return s;
}

/** URL do diálogo de login da Meta. rerequest: pede de novo permissões recusadas · reauthenticate: exige a senha do Perfil logado. */
export function authorizeUrl(userId: string, mode: AuthMode, profileId?: string): string {
  const { appId } = assertOAuthConfigured();
  const u = new URL(`https://www.facebook.com/${v()}/dialog/oauth`);
  u.search = new URLSearchParams({
    client_id: appId, redirect_uri: profilesRedirectUri(), state: makeState(userId, profileId), response_type: 'code',
    scope: REQUIRED_SCOPES.join(','), auth_type: mode,
  }).toString();
  return u.toString();
}

/* ---------------- troca de tokens ---------------- */
interface TokenResponse { access_token?: string; token_type?: string; expires_in?: number }
const tokenUrl = (params: Record<string, string>) => `${config.api.metaGraph}/${v()}/oauth/access_token?${new URLSearchParams(params)}`;

export interface LongLived { token: string; expiresAt: Date }
/** code → short-lived → Long-Lived User Access Token. Sem retry: o code só vale uma vez. */
export async function exchangeCode(code: string): Promise<LongLived> {
  const { appId, appSecret } = assertOAuthConfigured();
  const short = await requestJson<TokenResponse>(tokenUrl({ client_id: appId, client_secret: appSecret, redirect_uri: profilesRedirectUri(), code }), { retries: 0, timeoutMs: 20_000 });
  if (!short.access_token) throw new SyncError('api', 'A Meta não devolveu o access token.');
  const long = await requestJson<TokenResponse>(tokenUrl({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token }), { retries: 1, timeoutMs: 20_000 });
  if (!long.access_token) throw new SyncError('api', 'A Meta não devolveu o token de longa duração.');
  return { token: long.access_token, expiresAt: await expiryOf(long.access_token, long.expires_in) };
}

/** expires_in da troca; se faltar, pergunta ao debug_token (token do App); em último caso, 60 dias. */
async function expiryOf(token: string, expiresIn?: number): Promise<Date> {
  if (expiresIn && expiresIn > 0) return new Date(Date.now() + expiresIn * 1000);
  try {
    const { appId, appSecret } = assertOAuthConfigured();
    const d = await graphGet<{ data?: { expires_at?: number } }>(`${appId}|${appSecret}`, 'debug_token', { input_token: token });
    if (d.data?.expires_at) return new Date(d.data.expires_at * 1000);
  } catch { /* usa o padrão */ }
  return new Date(Date.now() + LONG_LIVED_FALLBACK_SECS * 1000);
}

export interface FbIdentity { id: string; name: string; email: string | null }
export async function getIdentity(token: string): Promise<FbIdentity> {
  const me = await graphGet<{ id: string; name?: string; email?: string }>(token, 'me', { fields: 'id,name,email' });
  return { id: String(me.id), name: me.name ?? `Perfil ${me.id}`, email: me.email ?? null };
}

/* ---------------- sincronização de ativos ---------------- */
type Kind = 'business' | 'ad_account' | 'page' | 'dataset';
interface Asset { id: string; name: string; data: Record<string, unknown> }
export interface SyncResult { counts: Record<Kind, number>; warnings: string[] }

const MAX_BUSINESSES = 50, MAX_ACCOUNTS_FOR_PIXELS = 100, CONCURRENCY = 4;

/** Executa fn em cada item com no máximo `n` chamadas simultâneas. */
async function each<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
const isTokenError = (e: unknown) => e instanceof SyncError && e.code === 'token';
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

/**
 * Lê na Graph API os ativos acessíveis pelo token e substitui os do Perfil. Só troca um tipo de ativo quando a leitura
 * principal dele deu certo (uma falha passageira não apaga o que já estava sincronizado). Token recusado → lança SyncError('token').
 */
export async function syncProfileAssets(profileId: string, token: string): Promise<SyncResult> {
  const warnings: string[] = [];
  const ok = new Set<Kind>();
  const warn = (what: string, e: unknown) => { if (isTokenError(e)) throw e; warnings.push(`${what}: ${short(e)}`); };

  // 1 · Business Managers
  let businesses: Asset[] = [];
  try {
    businesses = (await graphList<any>(token, 'me/businesses', { fields: 'id,name,verification_status' }))
      .map((b) => ({ id: String(b.id), name: b.name ?? '', data: { verificationStatus: b.verification_status ?? null } }));
    ok.add('business');
  } catch (e) { warn('Business Managers', e); }
  const bmIds = businesses.slice(0, MAX_BUSINESSES).map((b) => b.id);
  if (businesses.length > MAX_BUSINESSES) warnings.push(`Só os primeiros ${MAX_BUSINESSES} BMs tiveram Páginas e Datasets lidos.`);

  // 2 · contas de anúncios
  let accounts: Asset[] = [];
  try {
    accounts = (await listAdAccounts(token)).map((a) => ({ id: a.id, name: a.name, data: { status: a.status, currency: a.currency, timezone: a.timezone, businessId: a.businessId } }));
    ok.add('ad_account');
  } catch (e) { warn('Contas de anúncios', e); }

  // 3 · Páginas: as que o Perfil administra (me/accounts) + as dos BMs
  const pages = new Map<string, Asset>();
  try {
    for (const p of await graphList<any>(token, 'me/accounts', { fields: 'id,name,category,tasks' }))
      pages.set(String(p.id), { id: String(p.id), name: p.name ?? '', data: { category: p.category ?? null, tasks: p.tasks ?? [], via: 'profile' } });
    ok.add('page');
  } catch (e) { warn('Páginas', e); }
  await each(bmIds, CONCURRENCY, async (bm) => {
    for (const edge of ['owned_pages', 'client_pages']) {
      try {
        for (const p of await graphList<any>(token, `${bm}/${edge}`, { fields: 'id,name,category' }))
          if (!pages.has(String(p.id))) pages.set(String(p.id), { id: String(p.id), name: p.name ?? '', data: { category: p.category ?? null, tasks: [], via: 'business', businessId: bm } });
      } catch (e) { warn(`Páginas do BM ${bm}`, e); }
    }
  });

  // 4 · Pixels / Conjuntos de dados: dos BMs (owned/client) e de cada conta de anúncios
  interface DsData { lastFiredAt: string | null; unavailable: boolean; businessIds: string[]; adAccountIds: string[] }
  const datasets = new Map<string, Asset & { data: DsData }>();
  const addDs = (p: any, where: { businessId?: string; adAccountId?: string }) => {
    const id = String(p.id);
    const d: Asset & { data: DsData } = datasets.get(id) ?? { id, name: p.name ?? '', data: { lastFiredAt: p.last_fired_time ?? null, unavailable: !!p.is_unavailable, businessIds: [], adAccountIds: [] } };
    if (where.businessId && !d.data.businessIds.includes(where.businessId)) d.data.businessIds.push(where.businessId);
    if (where.adAccountId && !d.data.adAccountIds.includes(where.adAccountId)) d.data.adAccountIds.push(where.adAccountId);
    datasets.set(id, d);
  };
  const DS_FIELDS = 'id,name,last_fired_time,is_unavailable';
  let dsFailures = 0;
  await each(bmIds, CONCURRENCY, async (bm) => {
    for (const edge of ['owned_pixels', 'client_pixels']) {
      try { (await graphList<any>(token, `${bm}/${edge}`, { fields: DS_FIELDS })).forEach((p) => addDs(p, { businessId: bm })); } catch (e) { dsFailures++; warn(`Datasets do BM ${bm}`, e); }
    }
  });
  const accIds = accounts.slice(0, MAX_ACCOUNTS_FOR_PIXELS).map((a) => a.id);
  if (accounts.length > MAX_ACCOUNTS_FOR_PIXELS) warnings.push(`Só as primeiras ${MAX_ACCOUNTS_FOR_PIXELS} contas tiveram Pixels lidos.`);
  await each(accIds, CONCURRENCY, async (acc) => {
    try { (await graphList<any>(token, `act_${acc}/adspixels`, { fields: DS_FIELDS })).forEach((p) => addDs(p, { adAccountId: acc })); } catch (e) { dsFailures++; warn(`Pixels da conta ${acc}`, e); }
  });
  if (ok.has('ad_account') && (dsFailures === 0 || datasets.size > 0)) ok.add('dataset');

  const lists: Record<Kind, Asset[]> = { business: businesses, ad_account: accounts, page: [...pages.values()], dataset: [...datasets.values()] };
  await tx(async (c) => {
    for (const kind of ok) {
      await q('DELETE FROM meta_profile_assets WHERE profile_id = $1 AND kind = $2', [profileId, kind], c);
      if (lists[kind].length)
        await q(`INSERT INTO meta_profile_assets (profile_id, kind, external_id, name, data)
                 SELECT $1::bigint, $2::text, x.id, COALESCE(x.name, ''), COALESCE(x.data, '{}') FROM jsonb_to_recordset($3::jsonb) AS x(id text, name text, data jsonb)
                 ON CONFLICT (profile_id, kind, external_id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = now()`,
          [profileId, kind, JSON.stringify(lists[kind])], c);
    }
    await q('UPDATE meta_profiles SET last_synced_at = now(), sync_error = $2, updated_at = now() WHERE id = $1',
      [profileId, warnings.length ? warnings.slice(0, 8).join(' · ').slice(0, 1000) : null], c);
  });
  return { counts: { business: lists.business.length, ad_account: lists.ad_account.length, page: lists.page.length, dataset: lists.dataset.length }, warnings };
}

/* ---------------- leitura dos ativos sincronizados ---------------- */
export interface SyncedAsset { id: string; name: string; data: any }
export const syncedAssets = (profileId: string, kind: Kind) =>
  q<SyncedAsset>(`SELECT external_id AS id, name, data FROM meta_profile_assets WHERE profile_id = $1 AND kind = $2 ORDER BY lower(name), external_id`, [profileId, kind]);

export async function hasSyncedAsset(profileId: string, kind: Kind, id: string): Promise<SyncedAsset | null> {
  return one<SyncedAsset>('SELECT external_id AS id, name, data FROM meta_profile_assets WHERE profile_id = $1 AND kind = $2 AND external_id = $3', [profileId, kind, id]);
}
