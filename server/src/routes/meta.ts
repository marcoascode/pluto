/**
 * 0.18 · Criação automatizada de campanhas Meta — Etapa 1: Perfis/BMs de contingência e sincronização de ativos.
 * Montado em /meta atrás de requireMetaCampaigns (flag can_create_meta_campaigns, atribuída só pelo SuperAdmin).
 *
 * Multi-tenant: todo Perfil pertence a um usuário e TODA consulta filtra por user_id (id de outro usuário = 404).
 * Contas de anúncios vindas da Meta só aparecem se o admin já atribuiu a conta ao gestor (manager_accounts);
 * cada conta traz os sites (domínios) que o gestor tem ligados a ela (domain_manager_accounts).
 * O System User Token é criptografado (AES-256-GCM) e nunca sai da API.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import rateLimit from 'express-rate-limit';
import { scope } from '../auth/scope.js';
import { copyRequest, generateCopies } from '../services/metaCopies.js';
import { suggestCampaign } from '../services/metaHistory.js';
import { buildMetaTrackedUrl } from '../services/utm.js';
import { listAdAccountPixels, listAdAccounts, listBusinessDatasets, listPages, toHttpError, validateToken } from '../services/metaGraph.js';

export const metaRouter = Router();

const ID = z.string().regex(/^\d+$/, 'id inválido');
const TOKEN = z.string().trim().min(20).max(1000).regex(/^\S+$/, 'token inválido');
const BUSINESS = z.string().trim().regex(/^\d{5,25}$/, 'use só os dígitos do ID do Business Manager');
const NAME = z.string().trim().min(2).max(120);

const PUBLIC = `id::text, name, business_id AS "businessId", system_user_id AS "systemUserId", system_user_name AS "systemUserName",
  token_last4 AS "tokenLast4", status, message, scopes, last_validated_at AS "lastValidatedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

interface Profile { id: string; businessId: string | null }
/** Perfil do próprio usuário (404 se não existir ou for de outro). */
async function own(req: Request): Promise<Profile & { token: string }> {
  const r = await one<{ id: string; business_id: string | null; token_enc: Buffer }>(
    'SELECT id::text, business_id, token_enc FROM meta_profiles WHERE id = $1 AND user_id = $2', [parse(ID, req.params.id), req.user!.id]);
  if (!r) throw notFound('Perfil não encontrado.');
  return { id: r.id, businessId: r.business_id, token: decrypt(r.token_enc) };
}

async function saveValidation(id: string, v: Awaited<ReturnType<typeof validateToken>>) {
  await q(`UPDATE meta_profiles SET status = $2, message = $3, system_user_id = $4, system_user_name = $5, scopes = $6, last_validated_at = now(), updated_at = now() WHERE id = $1`,
    [id, v.ok ? 'valid' : 'invalid', v.ok ? null : (v.message ?? 'Token inválido.').slice(0, 500), v.systemUserId ?? null, v.systemUserName ?? null, v.scopes]);
}

/* ---------------- CRUD de Perfis ---------------- */
metaRouter.get('/profiles', async (req, res) => {
  res.json({ profiles: await q(`SELECT ${PUBLIC} FROM meta_profiles WHERE user_id = $1 ORDER BY lower(name)`, [req.user!.id]) });
});

/** Cadastra o Perfil e já valida o token na Meta (o Perfil fica salvo mesmo se o token for recusado, com status "invalid"). */
metaRouter.post('/profiles', async (req, res) => {
  const b = parse(z.object({ name: NAME, businessId: BUSINESS.optional(), token: TOKEN }), req.body);
  const v = await validateToken(b.token);
  const r = await one<{ id: string }>(
    `INSERT INTO meta_profiles (user_id, name, business_id, token_enc, token_last4) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
    [req.user!.id, b.name, b.businessId ?? null, encrypt(b.token), b.token.slice(-4)]);
  await saveValidation(r!.id, v);
  res.status(201).json(await one(`SELECT ${PUBLIC} FROM meta_profiles WHERE id = $1`, [r!.id]));
});

/** Edita nome/BM e/ou troca o token (token novo é revalidado). */
metaRouter.patch('/profiles/:id', async (req, res) => {
  const pid = parse(ID, req.params.id);
  const b = parse(z.object({ name: NAME.optional(), businessId: BUSINESS.nullable().optional(), token: TOKEN.optional() }), req.body);
  if (!(await one('SELECT 1 FROM meta_profiles WHERE id = $1 AND user_id = $2', [pid, req.user!.id]))) throw notFound('Perfil não encontrado.');
  const v = b.token ? await validateToken(b.token) : null;
  await q(`UPDATE meta_profiles SET name = COALESCE($3, name), business_id = CASE WHEN $4 THEN $5 ELSE business_id END,
             token_enc = COALESCE($6, token_enc), token_last4 = COALESCE($7, token_last4), updated_at = now() WHERE id = $1 AND user_id = $2`,
    [pid, req.user!.id, b.name ?? null, b.businessId !== undefined, b.businessId ?? null, b.token ? encrypt(b.token) : null, b.token ? b.token.slice(-4) : null]);
  if (v) await saveValidation(pid, v);
  res.json(await one(`SELECT ${PUBLIC} FROM meta_profiles WHERE id = $1`, [pid]));
});

metaRouter.delete('/profiles/:id', async (req, res) => {
  const r = await q('DELETE FROM meta_profiles WHERE id = $1 AND user_id = $2 RETURNING id', [parse(ID, req.params.id), req.user!.id]);
  if (!r.length) throw notFound('Perfil não encontrado.');
  res.status(204).end();
});

/** Revalida o token salvo na Meta. */
metaRouter.post('/profiles/:id/validate', async (req, res) => {
  const p = await own(req);
  await saveValidation(p.id, await validateToken(p.token));
  res.json(await one(`SELECT ${PUBLIC} FROM meta_profiles WHERE id = $1`, [p.id]));
});

/* ---------------- ativos do Perfil (lidos na Graph API com o token) ---------------- */

/**
 * Contas de anúncios do token ∩ contas atribuídas ao gestor (integration_accounts/manager_accounts),
 * com os sites que ele ligou a cada conta. Contas do token que não foram atribuídas a ele não aparecem.
 */
metaRouter.get('/profiles/:id/ad-accounts', async (req, res) => {
  const p = await own(req);
  const [remote, mine] = await Promise.all([
    listAdAccounts(p.token).catch((e) => { throw toHttpError(e); }),
    q<{ id: string; externalId: string; name: string; sites: string[] }>(`
      SELECT a.id::text, a.external_id AS "externalId", a.name,
             COALESCE((SELECT array_agg(d.hostname ORDER BY d.hostname) FROM domain_manager_accounts x JOIN domains d ON d.id = x.domain_id
                        WHERE x.user_id = ma.user_id AND x.account_id = a.id), '{}') AS sites
        FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id
       WHERE ma.user_id = $1 AND a.provider = 'meta'`, [req.user!.id]),
  ]);
  const byExt = new Map(mine.map((m) => [m.externalId, m]));
  const adAccounts = remote.filter((a) => byExt.has(a.id)).map((a) => ({ ...a, plutoAccountId: byExt.get(a.id)!.id, sites: byExt.get(a.id)!.sites }));
  res.json({ adAccounts, hiddenCount: remote.length - adAccounts.length });
});

/** Páginas do token (só do Perfil do próprio gestor). */
metaRouter.get('/profiles/:id/pages', async (req, res) => {
  const p = await own(req);
  res.json({ pages: await listPages(p.token, p.businessId).catch((e) => { throw toHttpError(e); }) });
});

/** Datasets do Business Manager (precisa do businessId no Perfil). */
metaRouter.get('/profiles/:id/datasets', async (req, res) => {
  const p = await own(req);
  if (!p.businessId) throw new HttpError(422, 'business_required', 'Informe o ID do Business Manager no Perfil para listar Datasets.');
  res.json({ datasets: await listBusinessDatasets(p.token, p.businessId).catch((e) => { throw toHttpError(e); }) });
});

/** Pixels de uma conta de anúncios (?adAccountId=...), que precisa ser uma das atribuídas ao gestor. */
metaRouter.get('/profiles/:id/pixels', async (req, res) => {
  const p = await own(req);
  const acc = parse(z.string().regex(/^(act_)?\d+$/, 'adAccountId inválido'), req.query.adAccountId).replace(/^act_/, '');
  const ok = await one(`SELECT 1 FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id WHERE ma.user_id = $1 AND a.provider = 'meta' AND a.external_id = $2`, [req.user!.id, acc]);
  if (!ok) throw notFound('Conta de anúncios não atribuída a você.');
  res.json({ pixels: await listAdAccountPixels(p.token, acc).catch((e) => { throw toHttpError(e); }) });
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
