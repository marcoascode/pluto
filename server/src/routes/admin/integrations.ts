import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { encrypt } from '../../lib/crypto.js';
import { requireSuperAdmin } from '../../auth/session.js';
import { refreshRates, latest } from '../../services/fx.js';
import { runProvider } from '../../services/sync/index.js';

export const integrationsRouter = Router();

const PROVIDERS = ['google-ads', 'meta', 'gam'] as const;
type Provider = (typeof PROVIDERS)[number];
const provider = z.enum(PROVIDERS);
const PAGE: Record<Provider, string> = { 'google-ads': 'google-ads', meta: 'meta-ads', gam: 'ad-manager' };

/* ---------- formato dos IDs ---------- */
const digits = (s: string) => s.replace(/\D/g, '');
function normalizeId(p: Provider, raw: string): string {
  const v = p === 'meta' ? raw.trim().replace(/^act_/i, '') : raw.trim();
  const d = digits(v);
  const ok = p === 'google-ads' ? d.length === 10 : p === 'meta' ? /^\d{5,20}$/.test(v) : /^\d{3,12}$/.test(v);
  if (!ok) throw new HttpError(422, 'invalid_external_id', p === 'google-ads' ? 'Customer ID precisa ter 10 dígitos.' : p === 'meta' ? 'Ad Account ID inválido (act_ + números).' : 'Network code inválido (só números).');
  return d;
}
const displayId = (p: string, id: string) => (p === 'google-ads' && id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : p === 'meta' ? `act_${id}` : id);

interface AccRow { id: string; provider: Provider; external_id: string; name: string; currency: string; timezone: string; imported: boolean; status: string; message: string | null; last_sync_at: string | null; domains: string[] }
const ACC_SQL = `
  SELECT a.id::text, a.provider, a.external_id, a.name, a.currency, a.timezone, a.imported, a.status, a.message, a.last_sync_at,
         COALESCE(array_agg(d.hostname ORDER BY d.hostname) FILTER (WHERE d.id IS NOT NULL), '{}') AS domains
    FROM integration_accounts a
    LEFT JOIN domain_accounts da ON da.account_id = a.id
    LEFT JOIN domains d ON d.id = da.domain_id`;
const toAccount = (a: AccRow) => ({
  id: a.id, provider: a.provider, name: a.name, externalId: displayId(a.provider, a.external_id), currency: a.currency, timezone: a.timezone,
  imported: a.imported, domains: a.domains, status: a.imported ? a.status : 'not_imported', lastSyncAt: a.last_sync_at, message: a.message ?? undefined,
});
const getAccount = async (p: Provider, id: string) => { const r = await one<AccRow>(`${ACC_SQL} WHERE a.provider = $1 AND a.id = $2 GROUP BY a.id`, [p, id]); return r ? toAccount(r) : null; };

/* ---------- resumo das conexões (tela Contas / topo das integrações) ---------- */
integrationsRouter.get('/integrations', async (_req, res) => {
  const conns = Object.fromEntries((await q('SELECT * FROM integration_connections')).map((c) => [c.provider, c]));
  const accs = (await q<AccRow>(`${ACC_SQL} GROUP BY a.id ORDER BY a.name`)).map(toAccount);
  const of = (p: Provider) => accs.filter((a) => a.provider === p).map(({ provider: _p, domains: _d, ...rest }) => rest);
  const c = (p: Provider) => conns[p] ?? {};
  const gamAcc = accs.find((a) => a.provider === 'gam');
  res.json({
    google: { connected: !!c('google-ads').refresh_token_enc, googleAccount: c('google-ads').account_email ?? '—', mccName: c('google-ads').display_name ?? '—', mccCustomerId: c('google-ads').external_id ? displayId('google-ads', c('google-ads').external_id) : '—', accountsFound: of('google-ads').length, lastSyncAt: c('google-ads').last_sync_at ?? null, accounts: of('google-ads') },
    meta: { connected: !!c('meta').access_token_enc, business: c('meta').display_name ?? '—', user: c('meta').account_email ?? '—', lastSyncAt: c('meta').last_sync_at ?? null, accounts: of('meta') },
    gam: { connected: !!c('gam').refresh_token_enc, googleAccount: c('gam').account_email ?? '—', networkName: gamAcc?.name ?? c('gam').display_name ?? '—', networkCode: gamAcc?.externalId ?? c('gam').external_id ?? '—', currency: gamAcc?.currency ?? 'USD', timezone: gamAcc?.timezone ?? config.appTz, status: c('gam').refresh_token_enc ? c('gam').status : 'disconnected', lastSyncAt: c('gam').last_sync_at ?? null, accounts: of('gam') },
  });
});

/* ---------- CRUD de contas ---------- */
const accBody = z.object({
  name: z.string().trim().min(2).max(120),
  externalId: z.string().trim().min(3).max(40),
  currency: z.enum(['USD', 'BRL', 'EUR']).default('USD'),
  timezone: z.string().trim().min(2).max(60).default(config.appTz),
  imported: z.boolean().default(true),
});

/* 0.18.8: domínios da conta não se editam mais aqui: vêm dos vínculos de Usuários & Squads (gestor → domínio → contas). */

integrationsRouter.get('/integrations/:provider/accounts', async (req, res) => {
  const p = parse(provider, req.params.provider);
  res.json({ accounts: (await q<AccRow>(`${ACC_SQL} WHERE a.provider = $1 GROUP BY a.id ORDER BY a.name`, [p])).map(toAccount) });
});

integrationsRouter.post('/integrations/:provider/accounts', async (req, res) => {
  const p = parse(provider, req.params.provider);
  const b = parse(accBody, req.body);
  const ext = normalizeId(p, b.externalId);
  if (await one('SELECT 1 FROM integration_accounts WHERE provider = $1 AND external_id = $2', [p, ext])) throw conflict('account_exists', 'Essa conta já está cadastrada.');
  const id = await tx(async (c) => {
    const r = await one<{ id: string }>(`INSERT INTO integration_accounts (provider, external_id, name, currency, timezone, imported, status, message)
      VALUES ($1, $2, $3, $4, $5, $6, 'late', 'Aguardando o primeiro sync') RETURNING id::text`, [p, ext, b.name, b.currency, b.timezone, b.imported], c);
    return r!.id;
  });
  res.status(201).json(await getAccount(p, id));
});

integrationsRouter.patch('/integrations/:provider/accounts/:id', async (req, res) => {
  const p = parse(provider, req.params.provider);
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const b = parse(accBody.omit({ externalId: true }).partial(), req.body);
  if (!(await one('SELECT 1 FROM integration_accounts WHERE provider = $1 AND id = $2', [p, id]))) throw notFound('Conta não encontrada.');
  await tx(async (c) => {
    await c.query(`UPDATE integration_accounts SET name = COALESCE($2, name), currency = COALESCE($3, currency), timezone = COALESCE($4, timezone), imported = COALESCE($5, imported) WHERE id = $1`,
      [id, b.name ?? null, b.currency ?? null, b.timezone ?? null, b.imported ?? null]);
  });
  res.json(await getAccount(p, id));
});

/** Excluir tira a conta do sync e dos domínios; o histórico em daily_metrics continua (campanhas saem em cascata). */
integrationsRouter.delete('/integrations/:provider/accounts/:id', async (req, res) => {
  const p = parse(provider, req.params.provider);
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const r = await q('DELETE FROM integration_accounts WHERE provider = $1 AND id = $2 RETURNING id', [p, id]);
  if (!r.length) throw notFound('Conta não encontrada.');
  res.status(204).end();
});

/* ---------- frequência das sincronizações ---------- */
const SYNC_SQL = `
  SELECT id, provider, label,
         CASE window_mode WHEN 'days' THEN 'D-' || window_days || CASE WHEN id = 'gam.close' THEN ' → D-4' ELSE ' → hoje' END
                          WHEN 'incremental' THEN 'incremental · desde a última execução' ELSE window_desc END AS "window",
         window_mode AS "windowMode", window_days AS "windowDays", window_mode <> 'fixed' AS "windowEditable",
         CASE WHEN id LIKE '%.cleanup' THEN true ELSE false END AS "hasRetention", retention_days AS "retentionDays",
         every_minutes AS "everyMinutes", enabled, last_run_at AS "lastRunAt", next_run_at AS "nextRunAt", last_status AS "lastStatus",
         (SELECT j.message FROM sync_jobs j WHERE j.setting_id = sync_settings.id ORDER BY j.id DESC LIMIT 1) AS "lastMessage"
    FROM sync_settings`;
integrationsRouter.get('/sync-settings', async (_req, res) => { res.json({ settings: await q(`${SYNC_SQL} ORDER BY provider, id`) }); });

/** Frequência, liga/desliga, janela (D-X → hoje ou incremental) e retenção da limpeza: só SuperAdmin. */
integrationsRouter.patch('/sync-settings/:id', requireSuperAdmin, async (req, res) => {
  const b = parse(z.object({
    everyMinutes: z.number().int().min(15).max(10080).optional(), enabled: z.boolean().optional(),
    windowMode: z.enum(['days', 'incremental']).optional(), windowDays: z.number().int().min(0).max(90).optional(),
    retentionDays: z.number().int().min(7).max(3650).nullable().optional(),
  }), req.body);
  const cur = await one<{ mode: string; days: number | null }>('SELECT window_mode AS mode, window_days AS days FROM sync_settings WHERE id = $1', [req.params.id]);
  if (!cur) throw notFound('Job não encontrado.');
  if ((b.windowMode || b.windowDays !== undefined) && cur.mode === 'fixed') throw new HttpError(422, 'window_fixed', 'Este job não tem janela de datas.');
  if (req.params.id === 'gam.close' && (b.windowMode === 'incremental' || (b.windowDays !== undefined && b.windowDays < 4))) throw new HttpError(422, 'invalid_window', 'O fechamento vai de D-X até D-4: use X a partir de 4.');
  if (b.retentionDays !== undefined && !String(req.params.id).endsWith('.cleanup')) throw new HttpError(422, 'no_retention', 'Só os jobs de limpeza têm retenção.');
  if (b.windowMode || b.windowDays !== undefined || b.retentionDays !== undefined)
    await q(`UPDATE sync_settings SET window_mode = COALESCE($2, window_mode), window_days = COALESCE($3, window_days),
               retention_days = CASE WHEN $4::boolean THEN $5::int ELSE retention_days END WHERE id = $1`,
      [req.params.id, b.windowMode ?? null, b.windowDays ?? (b.windowMode === 'days' && cur.days == null ? 3 : null), b.retentionDays !== undefined, b.retentionDays ?? null]);
  const r = await one(`UPDATE sync_settings SET every_minutes = COALESCE($2, every_minutes), enabled = COALESCE($3, enabled),
      next_run_at = CASE WHEN COALESCE($3, enabled) THEN COALESCE(last_run_at, now()) + make_interval(mins => COALESCE($2, every_minutes)) ELSE NULL END
    WHERE id = $1 RETURNING id`, [req.params.id, b.everyMinutes ?? null, b.enabled ?? null]);
  if (!r) throw notFound('Job não encontrado.');
  res.json(await one(`${SYNC_SQL} WHERE id = $1`, [req.params.id]));
});

/** "Sincronizar agora": responde 202 e roda em segundo plano. */
integrationsRouter.post('/integrations/:provider/sync', async (req, res) => {
  const p = parse(provider, req.params.provider);
  runProvider(p).catch((e) => console.error('[sync] manual', p, e));
  res.status(202).json({ queued: true });
});

/* ---------- câmbio ---------- */
integrationsRouter.post('/fx/refresh', async (_req, res) => {
  try { await refreshRates(); } catch (e) { throw new HttpError(502, 'fx_unavailable', `A API de câmbio não respondeu: ${(e as Error).message}`); }
  res.json(await latest());
});

/* ---------- OAuth ---------- */
const redirectUri = (p: Provider) => `${config.appUrl}/api/admin/integrations/${p}/oauth/callback`;
const sign = (s: string) => createHmac('sha256', Buffer.from(config.tokenEncKey, 'base64')).update(s).digest('base64url');
function makeState(p: Provider, userId: string) {
  const body = Buffer.from(JSON.stringify({ p, u: userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function checkState(state: string, p: Provider, userId: string) {
  const [body, sig] = String(state).split('.');
  const good = body && sig && sig.length === sign(body).length && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)));
  const s = good ? JSON.parse(Buffer.from(body, 'base64url').toString()) : null;
  if (!s || s.p !== p || s.u !== userId || s.exp < Date.now()) throw new HttpError(400, 'invalid_state', 'Sessão do OAuth inválida ou expirada. Tente conectar de novo.');
}
const GOOGLE_SCOPES: Record<'google-ads' | 'gam', string> = { 'google-ads': 'https://www.googleapis.com/auth/adwords', gam: 'https://www.googleapis.com/auth/admanager' };

/** Conectar (OAuth): só SuperAdmin. */
integrationsRouter.post('/integrations/:provider/oauth/start', requireSuperAdmin, async (req, res) => {
  const p = parse(provider, req.params.provider);
  const state = makeState(p, req.user!.id);
  if (p === 'meta') {
    if (!config.oauth.metaAppId) throw new HttpError(501, 'oauth_not_configured', 'Configure META_APP_ID e META_APP_SECRET no servidor.');
    const u = new URL(`https://www.facebook.com/${config.oauth.metaApiVersion}/dialog/oauth`);
    u.search = new URLSearchParams({ client_id: config.oauth.metaAppId, redirect_uri: redirectUri(p), state, scope: 'ads_read,business_management' }).toString();
    return res.json({ authorizeUrl: u.toString() });
  }
  if (!config.oauth.googleClientId) throw new HttpError(501, 'oauth_not_configured', 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: config.oauth.googleClientId, redirect_uri: redirectUri(p), response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: `openid email ${GOOGLE_SCOPES[p]}`, state }).toString();
  res.json({ authorizeUrl: u.toString() });
});

async function postForm(url: string, form: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(j.error_description ?? j.error?.message ?? j.error ?? `HTTP ${r.status}`);
  return j;
}
async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

/** O Google/Meta redireciona o navegador para cá (cookie de sessão vai junto: SameSite=Lax em GET de navegação). */
integrationsRouter.get('/integrations/:provider/oauth/callback', requireSuperAdmin, async (req, res) => {
  const p = parse(provider, req.params.provider);
  const back = (qs: string) => res.redirect(`${config.appUrl}/admin/integracoes/${PAGE[p]}?${qs}`);
  if (req.query.error) return back(`oauth_error=${encodeURIComponent(String(req.query.error))}`);
  checkState(String(req.query.state ?? ''), p, req.user!.id);
  const code = String(req.query.code ?? '');
  try {
    if (p === 'meta') {
      const v = config.oauth.metaApiVersion;
      const short = await getJson(`${config.api.metaGraph}/${v}/oauth/access_token?${new URLSearchParams({ client_id: config.oauth.metaAppId!, client_secret: config.oauth.metaAppSecret!, redirect_uri: redirectUri(p), code })}`);
      const long = await getJson(`${config.api.metaGraph}/${v}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: config.oauth.metaAppId!, client_secret: config.oauth.metaAppSecret!, fb_exchange_token: short.access_token })}`);
      const me = await getJson(`${config.api.metaGraph}/${v}/me?fields=name,email&access_token=${encodeURIComponent(long.access_token)}`);
      await q(`UPDATE integration_connections SET access_token_enc = $2, token_expires_at = now() + make_interval(secs => $3), account_email = $4, status = 'ok', connected_at = now() WHERE provider = $1`,
        [p, encrypt(long.access_token), Number(long.expires_in ?? 60 * 86400), me.email ?? me.name ?? null]);
      await discoverMetaAccounts(long.access_token).catch((e) => console.warn('[oauth] meta adaccounts:', e.message));
    } else {
      const t = await postForm(config.api.googleToken, { code, client_id: config.oauth.googleClientId!, client_secret: config.oauth.googleClientSecret!, redirect_uri: redirectUri(p), grant_type: 'authorization_code' });
      const email = t.id_token ? JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString()).email : null;
      if (!t.refresh_token) throw new Error('o Google não devolveu refresh_token (remova o acesso do app na conta Google e conecte de novo)');
      await q(`UPDATE integration_connections SET refresh_token_enc = $2, access_token_enc = $3, token_expires_at = now() + make_interval(secs => $4), account_email = $5, status = 'ok', connected_at = now() WHERE provider = $1`,
        [p, encrypt(t.refresh_token), encrypt(t.access_token), Number(t.expires_in ?? 3600), email]);
      if (p === 'gam') await discoverGamNetworks(t.access_token).catch((e) => console.warn('[oauth] gam networks:', e.message));
    }
    back('connected=1');
  } catch (e) {
    console.error('[oauth]', p, (e as Error).message);
    back(`oauth_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
  }
});

/** Meta: cadastra as contas de anúncio visíveis para o usuário que autorizou. */
async function discoverMetaAccounts(token: string) {
  const v = config.oauth.metaApiVersion;
  const j = await getJson(`${config.api.metaGraph}/${v}/me/adaccounts?fields=name,account_id,currency,timezone_name&limit=200&access_token=${encodeURIComponent(token)}`);
  for (const a of (j.data ?? []) as { name: string; account_id: string; currency: string; timezone_name: string }[]) {
    const cur = ['USD', 'BRL', 'EUR'].includes(a.currency) ? a.currency : 'USD';
    await q(`INSERT INTO integration_accounts (provider, external_id, name, currency, timezone, imported, status) VALUES ('meta', $1, $2, $3, $4, true, 'ok')
             ON CONFLICT (provider, external_id) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency, timezone = EXCLUDED.timezone`, [a.account_id, a.name, cur, a.timezone_name]);
  }
}
/** GAM: Ad Manager API v1 → networks do usuário. */
async function discoverGamNetworks(accessToken: string) {
  const j = await getJson(`${config.api.gam}/v1/networks`, { Authorization: `Bearer ${accessToken}` });
  for (const n of (j.networks ?? []) as { networkCode: string; displayName: string; currencyCode: string; timeZone: string }[]) {
    const cur = ['USD', 'BRL', 'EUR'].includes(n.currencyCode) ? n.currencyCode : 'USD';
    await q(`INSERT INTO integration_accounts (provider, external_id, name, currency, timezone, imported, status) VALUES ('gam', $1, $2, $3, $4, true, 'ok')
             ON CONFLICT (provider, external_id) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency, timezone = EXCLUDED.timezone`, [n.networkCode, n.displayName, cur, n.timeZone]);
    await q(`UPDATE integration_connections SET display_name = $1, external_id = $2 WHERE provider = 'gam'`, [n.displayName, n.networkCode]);
  }
}
