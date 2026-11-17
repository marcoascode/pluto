/**
 * 0.18 · Criação automatizada de campanhas Meta — Perfis de contingência e ativos.
 * Montado em /meta atrás de requireMetaCampaigns (flag can_create_meta_campaigns, atribuída só pelo SuperAdmin).
 *
 * 0.18.2: os Perfis são conectados pelo Facebook Login (OAuth 2.0) — /meta/oauth/url → diálogo da Meta → /meta/oauth/callback.
 * O callback troca o code por um Long-Lived User Access Token (~60 dias), confere /me e /me/permissions, salva o Perfil
 * (token criptografado com TOKEN_ENCRYPTION_KEY) e sincroniza BMs, contas de anúncios, Páginas e Pixels/Datasets.
 *
 * Multi-tenant: todo Perfil pertence a um usuário e TODA consulta filtra por user_id (id de outro usuário = 404).
 * Contas de anúncios só aparecem se o admin já atribuiu a conta ao gestor (manager_accounts), com os sites ligados a ela.
 */
import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import rateLimit from 'express-rate-limit';
import { scope } from '../auth/scope.js';
import { metaCampaignsRouter } from './metaCampaigns.js';
import { copyRequest, generateCopies } from '../services/metaCopies.js';
import { suggestCampaign } from '../services/metaHistory.js';
import { buildMetaTrackedUrl } from '../services/utm.js';
import { getPermissions, missingMessage, REQUIRED_SCOPES, toHttpError } from '../services/metaGraph.js';
import { authorizeUrl, checkState, exchangeCode, getIdentity, syncedAssets, syncProfileAssets } from '../services/metaProfiles.js';
import { SyncError } from '../services/sync/http.js';


export const metaRouter = Router();
metaRouter.use(metaCampaignsRouter);   // Etapa 3: já herda requireMetaCampaigns do mount em /meta

const ID = z.string().regex(/^\d+$/, 'id inválido');

/** Campos públicos do Perfil (o token nunca sai da API). status 'expired' quando o token de 60 dias já venceu. */
const PUBLIC = `p.id::text, p.name, p.source, p.fb_user_id AS "fbUserId", p.fb_email AS "email",
  p.business_id AS "businessId", p.system_user_name AS "systemUserName", p.token_last4 AS "tokenLast4",
  CASE WHEN p.token_expires_at IS NOT NULL AND p.token_expires_at <= now() THEN 'expired' ELSE p.status END AS status,
  p.message, p.scopes, p.declined_scopes AS "declinedScopes", p.token_expires_at AS "tokenExpiresAt",
  p.last_validated_at AS "lastValidatedAt", p.last_synced_at AS "lastSyncedAt", p.sync_error AS "syncError",
  json_build_object(
    'businesses', (SELECT count(*) FROM meta_profile_assets a WHERE a.profile_id = p.id AND a.kind = 'business'),
    'adAccounts', (SELECT count(*) FROM meta_profile_assets a WHERE a.profile_id = p.id AND a.kind = 'ad_account'),
    'pages',      (SELECT count(*) FROM meta_profile_assets a WHERE a.profile_id = p.id AND a.kind = 'page'),
    'datasets',   (SELECT count(*) FROM meta_profile_assets a WHERE a.profile_id = p.id AND a.kind = 'dataset')) AS counts,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const publicProfile = (id: string) => one(`SELECT ${PUBLIC} FROM meta_profiles p WHERE p.id = $1`, [id]);

/** Perfis legados (System User) não têm public_profile; os conectados via Facebook Login precisam dos 6 escopos. */
const requiredFor = (source: string) => (source === 'oauth' ? [...REQUIRED_SCOPES] : REQUIRED_SCOPES.filter((s) => s !== 'public_profile'));
const missingOf = (source: string, granted: string[]) => requiredFor(source).filter((s) => !granted.includes(s));

interface Profile { id: string; source: string; token: string }
/** Perfil do próprio usuário (404 se não existir ou for de outro). */
async function own(req: Request): Promise<Profile> {
  const r = await one<{ id: string; source: string; token_enc: Buffer }>(
    'SELECT id::text, source, token_enc FROM meta_profiles WHERE id = $1 AND user_id = $2', [parse(ID, req.params.id), req.user!.id]);
  if (!r) throw notFound('Perfil não encontrado.');
  return { id: r.id, source: r.source, token: decrypt(r.token_enc) };
}

/* ---------------- Facebook Login (OAuth 2.0) ---------------- */
const PROFILES_PAGE = '/perfis-meta';
const backTo = (params: Record<string, string>) => `${config.appUrl}${PROFILES_PAGE}?${new URLSearchParams(params)}`;

/**
 * URL do diálogo de login da Meta. ?mode=rerequest (padrão: conectar Perfil, pede de novo permissões recusadas)
 * ou reauthenticate (exige a senha do Perfil logado). ?profileId= marca a renovação de um Perfil já conectado.
 */
metaRouter.get('/oauth/url', async (req, res) => {
  const mode = parse(z.enum(['rerequest', 'reauthenticate']).default('rerequest'), req.query.mode);
  const profileId = parse(ID.optional(), req.query.profileId);
  if (profileId && !(await one('SELECT 1 FROM meta_profiles WHERE id = $1 AND user_id = $2', [profileId, req.user!.id]))) throw notFound('Perfil não encontrado.');
  res.json({ url: authorizeUrl(req.user!.id, mode, profileId) });
});

/**
 * A Meta redireciona o navegador para cá (o cookie de sessão vai junto: SameSite=Lax em navegação GET).
 * Sempre termina num redirect para a tela de Perfis com ?meta_oauth=ok|error — nunca com o token na URL.
 */
metaRouter.get('/oauth/callback', async (req, res) => {
  if (req.query.error) {
    const why = req.query.error_reason === 'user_denied' ? 'Você cancelou a autorização na Meta.' : String(req.query.error_description ?? req.query.error).slice(0, 200);
    return res.redirect(backTo({ meta_oauth: 'error', message: why }));
  }
  const state = checkState(String(req.query.state ?? ''), req.user!.id);
  const code = parse(z.string().min(10).max(2000), req.query.code);
  let lt;
  try { lt = await exchangeCode(code); } catch (e) {
    console.warn('[meta-oauth] troca do code falhou:', (e as Error).message);
    throw new HttpError(502, 'meta_oauth_exchange', 'A Meta não confirmou a autorização. Tente conectar de novo.');
  }
  const [me, perms] = await Promise.all([getIdentity(lt.token), getPermissions(lt.token)]).catch((e) => { throw toHttpError(e); });
  const missing = missingOf('oauth', perms.granted);
  const why = missing.length ? missingMessage(missing) : null;

  const r = await one<{ id: string; inserted: boolean }>(`
    INSERT INTO meta_profiles (user_id, name, source, fb_user_id, fb_email, token_enc, token_last4, token_expires_at, status, message, scopes, declined_scopes, last_validated_at)
    VALUES ($1, $2, 'oauth', $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    ON CONFLICT (user_id, fb_user_id) WHERE fb_user_id IS NOT NULL DO UPDATE SET
      name = EXCLUDED.name, source = 'oauth', fb_email = EXCLUDED.fb_email, token_enc = EXCLUDED.token_enc, token_last4 = EXCLUDED.token_last4,
      token_expires_at = EXCLUDED.token_expires_at, status = EXCLUDED.status, message = EXCLUDED.message, scopes = EXCLUDED.scopes,
      declined_scopes = EXCLUDED.declined_scopes, last_validated_at = now(), updated_at = now()
    RETURNING id::text, (xmax = 0) AS inserted`,
  [req.user!.id, me.name, me.id, me.email, encrypt(lt.token), lt.token.slice(-4), lt.expiresAt, why ? 'invalid' : 'valid', why, perms.granted, perms.declined]);
  const id = r!.id;

  const out: Record<string, string> = { meta_oauth: why ? 'missing_scopes' : 'ok', profile: id, name: me.name, created: r!.inserted ? '1' : '0' };
  if (why) out.missing = missing.join(',');
  // pediu para renovar um Perfil, mas o navegador estava logado em outro Perfil do Facebook
  if (state.p && state.p !== id) out.other = '1';
  if (!why) {
    try {
      const s = await syncProfileAssets(id, lt.token);
      if (s.warnings.length) out.warnings = String(s.warnings.length);
    } catch (e) {
      console.warn('[meta-oauth] sincronização inicial falhou:', (e as Error).message);
      await q('UPDATE meta_profiles SET sync_error = $2 WHERE id = $1', [id, `Sincronização inicial falhou: ${(e as Error).message}`.slice(0, 500)]);
      out.sync = 'failed';
    }
  }
  res.redirect(backTo(out));
});

/** Qualquer erro no callback (sessão expirada, state inválido, Meta fora do ar) volta para a tela de Perfis com a mensagem. */
export const oauthCallbackErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof HttpError ? err.message : 'Falha ao conectar o Perfil do Facebook. Tente de novo.';
  if (!(err instanceof HttpError)) console.error('[meta-oauth] callback', err);
  res.redirect(backTo({ meta_oauth: 'error', message: message.slice(0, 200) }));
};

/* ---------------- Perfis ---------------- */
metaRouter.get('/profiles', async (req, res) => {
  res.json({
    profiles: await q(`SELECT ${PUBLIC} FROM meta_profiles p WHERE p.user_id = $1 ORDER BY (p.source = 'oauth') DESC, lower(p.name)`, [req.user!.id]),
    required: REQUIRED_SCOPES,
  });
});

metaRouter.delete('/profiles/:id', async (req, res) => {
  const r = await q('DELETE FROM meta_profiles WHERE id = $1 AND user_id = $2 RETURNING id', [parse(ID, req.params.id), req.user!.id]);
  if (!r.length) throw notFound('Perfil não encontrado.');
  res.status(204).end();
});

/** Uma sincronização por Perfil por vez. */
const syncing = new Set<string>();

/**
 * Re-sincroniza um Perfil sob demanda: confere o token (/me + /me/permissions), atualiza status/permissões e
 * substitui BMs, contas de anúncios, Páginas e Pixels/Datasets. Token expirado/revogado → 422 e Perfil marcado como recusado.
 */
metaRouter.post('/profiles/:id/sync', async (req, res) => {
  const p = await own(req);
  if (syncing.has(p.id)) throw new HttpError(409, 'sync_in_progress', 'Este Perfil já está sendo sincronizado. Aguarde.');
  syncing.add(p.id);
  try {
    let me, perms;
    try { [me, perms] = await Promise.all([getIdentity(p.token), getPermissions(p.token)]); } catch (e) {
      if (e instanceof SyncError && (e.code === 'token' || e.code === 'permission')) {
        const why = 'A Meta recusou o token (expirado, revogado ou senha alterada). Clique em "Reconectar / Renovar".';
        await q(`UPDATE meta_profiles SET status = 'invalid', message = $2, last_validated_at = now(), updated_at = now() WHERE id = $1`, [p.id, why]);
        throw new HttpError(422, 'meta_token_invalid', why);
      }
      throw toHttpError(e);
    }
    const missing = missingOf(p.source, perms.granted);
    const why = missing.length ? missingMessage(missing) : null;
    await q(`UPDATE meta_profiles SET status = $2, message = $3, scopes = $4, declined_scopes = $5, last_validated_at = now(), updated_at = now(),
               name = CASE WHEN source = 'oauth' THEN $6 ELSE name END, system_user_name = CASE WHEN source = 'oauth' THEN system_user_name ELSE $6 END,
               fb_email = COALESCE($7, fb_email)
             WHERE id = $1`, [p.id, why ? 'invalid' : 'valid', why, perms.granted, perms.declined, me.name, me.email]);
    if (why) throw new HttpError(422, 'meta_scopes_missing', why);
    const sync = await syncProfileAssets(p.id, p.token).catch((e) => { throw toHttpError(e); });
    res.json({ profile: await publicProfile(p.id), sync });
  } finally { syncing.delete(p.id); }
});

/* ---------------- ativos sincronizados do Perfil (consumidos pelo Wizard) ---------------- */

/**
 * Contas de anúncios sincronizadas ∩ contas atribuídas ao gestor (integration_accounts/manager_accounts),
 * com os sites que ele ligou a cada conta. Contas do Perfil que não foram atribuídas a ele não aparecem.
 */
metaRouter.get('/profiles/:id/ad-accounts', async (req, res) => {
  const p = await own(req);
  const [remote, mine] = await Promise.all([
    syncedAssets(p.id, 'ad_account'),
    q<{ id: string; externalId: string; name: string; sites: string[] }>(`
      SELECT a.id::text, a.external_id AS "externalId", a.name,
             COALESCE((SELECT array_agg(d.hostname ORDER BY d.hostname) FROM domain_manager_accounts x JOIN domains d ON d.id = x.domain_id
                        WHERE x.user_id = ma.user_id AND x.account_id = a.id), '{}') AS sites
        FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id
       WHERE ma.user_id = $1 AND a.provider = 'meta'`, [req.user!.id]),
  ]);
  const byExt = new Map(mine.map((m) => [m.externalId, m]));
  const adAccounts = remote.filter((a) => byExt.has(a.id)).map((a) => ({
    id: a.id, name: a.name, status: a.data.status ?? null, currency: a.data.currency ?? null, timezone: a.data.timezone ?? null, businessId: a.data.businessId ?? null,
    plutoAccountId: byExt.get(a.id)!.id, sites: byExt.get(a.id)!.sites,
  }));
  res.json({ adAccounts, hiddenCount: remote.length - adAccounts.length });
});

/** Páginas sincronizadas do Perfil. */
metaRouter.get('/profiles/:id/pages', async (req, res) => {
  const p = await own(req);
  res.json({ pages: (await syncedAssets(p.id, 'page')).map((x) => ({ id: x.id, name: x.name, category: x.data.category ?? null, tasks: x.data.tasks ?? [] })) });
});

const toDataset = (x: { id: string; name: string; data: any }) => ({ id: x.id, name: x.name, lastFiredAt: x.data.lastFiredAt ?? null, unavailable: !!x.data.unavailable });
const ACC = z.string().regex(/^(act_)?\d+$/, 'adAccountId inválido').transform((v) => v.replace(/^act_/, ''));

/** A conta de anúncios precisa estar atribuída ao gestor. */
async function assertAccount(req: Request, acc: string) {
  const ok = await one(`SELECT 1 FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id WHERE ma.user_id = $1 AND a.provider = 'meta' AND a.external_id = $2`, [req.user!.id, acc]);
  if (!ok) throw notFound('Conta de anúncios não atribuída a você.');
}

/** Pixels/Datasets sincronizados: os dos BMs e, com ?adAccountId=, também os da conta de anúncios. */
metaRouter.get('/profiles/:id/datasets', async (req, res) => {
  const p = await own(req);
  const acc = req.query.adAccountId === undefined ? null : parse(ACC, req.query.adAccountId);
  if (acc) await assertAccount(req, acc);
  const all = await syncedAssets(p.id, 'dataset');
  res.json({ datasets: all.filter((d) => (d.data.businessIds ?? []).length > 0 || (acc && (d.data.adAccountIds ?? []).includes(acc))).map(toDataset) });
});

/** Pixels sincronizados de uma conta de anúncios (?adAccountId=...), que precisa ser uma das atribuídas ao gestor. */
metaRouter.get('/profiles/:id/pixels', async (req, res) => {
  const p = await own(req);
  const acc = parse(ACC, req.query.adAccountId);
  await assertAccount(req, acc);
  res.json({ pixels: (await syncedAssets(p.id, 'dataset')).filter((d) => (d.data.adAccountIds ?? []).includes(acc)).map(toDataset) });
});

/* ================= Etapa 2 · Motor de inteligência e histórico ================= */

/** Site (domínio) selecionado: precisa estar no escopo do usuário (gestor: só os dele). Devolve id, host e filtro de linhas. */
async function siteOf(req: Request, site: unknown) {
  const host = parse(z.string().trim().toLowerCase().min(3).max(253), site);
  const sc = await scope(req, host);
  return { id: sc.ids[0], hostname: sc.hosts[0], filter: sc.filter };
}

/** Chamadas à IA custam dinheiro: limite por usuário. */
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`, validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Muitas gerações seguidas. Aguarde um minuto.' } }); } });

/** Gera X variações completas de copy (título, texto principal, descrição, CTA) numa única chamada à IA. */
metaRouter.post('/copies/generate', aiLimiter, async (req, res) => {
  const b = parse(copyRequest.extend({ site: z.string() }), req.body);
  const site = await siteOf(req, b.site);
  res.json({ site: site.hostname, ...(await generateCopies(b, site.hostname)) });
});

/** Sugestão de campanha (objetivo, orçamento diário, público, posicionamentos, janela) a partir do histórico Meta do site. */
metaRouter.get('/campaign-suggestion', async (req, res) => {
  const site = await siteOf(req, req.query.site);
  const days = parse(z.coerce.number().int().min(14).max(180).default(60), req.query.days);
  res.json(await suggestCampaign({ domainId: site.id, hostname: site.hostname, filter: site.filter, days }));
});

/** URL de destino já parametrizada com o template de UTM do Pluto (link limpo + url_tags + preview). */
metaRouter.post('/tracked-url', async (req, res) => {
  const b = parse(z.object({ site: z.string(), url: z.string().max(2000) }), req.body);
  const site = await siteOf(req, b.site);
  res.json({ site: site.hostname, ...(await buildMetaTrackedUrl(b.url, site.hostname)) });
});
