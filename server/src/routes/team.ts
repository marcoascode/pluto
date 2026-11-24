/**
 * 0.18.9 · Gerente atribui domínios e contas aos gestores (Usuários & Squads → Gestores).
 * O vínculo continua sendo o de Usuários & Squads (o mesmo que o Admin edita em /admin/users); aqui o Gerente só mexe
 * nos domínios do alcance dele (Squads/Empresas) e nas contas ligadas a esses domínios, sem conta ou já usadas por
 * gestores desses domínios. O que estiver fora do alcance fica como está.
 *
 *   GET /team                       gestores + domínios e contas que dá para atribuir
 *   PUT /team/gestores/:id          { domains: [{ domain, googleAccounts, metaAccounts }] }
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { conflict, HttpError, notFound, parse } from '../lib/http.js';
import { isAdminRole } from '../auth/permissions.js';
import { adminScope, adminVisibleUserIds, allowedDomains, assertAdminUser } from '../auth/scope.js';
import { USER_SQL } from '../auth/session.js';
import { resyncAccounts, saveGestorLinks, type LinkScope } from '../services/gestorLinks.js';

export const teamRouter = Router();

async function scopeOf(req: Request): Promise<LinkScope | null> {
  const u = req.user!;
  if (u.role === 'superadmin') return null;
  // 0.18.11: Admin = domínios das Empresas em que é sócio, com qualquer conta de anúncios
  if (isAdminRole(u.role)) {
    const sc = (await adminScope(req))!;
    const acc = await q<{ id: string }>(`SELECT id::text FROM integration_accounts WHERE provider IN ('google-ads', 'meta')`);
    return { domainIds: new Set(sc.domainIds), accountIds: new Set(acc.map((x) => x.id)) };
  }
  if (u.role !== 'gerente') throw new HttpError(403, 'forbidden', 'Só Gerente, Admin ou SuperAdmin atribuem domínios e contas aos gestores.');
  const doms = (await allowedDomains(req)).ids;
  const acc = await q<{ id: string }>(`
    SELECT a.id::text FROM integration_accounts a WHERE a.provider IN ('google-ads', 'meta') AND (
      EXISTS (SELECT 1 FROM domain_accounts da WHERE da.account_id = a.id AND da.domain_id = ANY($1::bigint[]))
      OR NOT EXISTS (SELECT 1 FROM domain_accounts da WHERE da.account_id = a.id)
      OR EXISTS (SELECT 1 FROM manager_accounts ma JOIN domain_managers dm ON dm.user_id = ma.user_id WHERE ma.account_id = a.id AND dm.domain_id = ANY($1::bigint[])))`, [doms]);
  return { domainIds: new Set(doms), accountIds: new Set(acc.map((x) => x.id)) };
}

teamRouter.get('/', async (req, res) => {
  const sc = await scopeOf(req);
  const [users, domains, accounts] = await Promise.all([
    q<{ id: string; name: string; email: string; status: string; domains: { domain: string; googleAccounts: string[]; metaAccounts: string[] }[] }>(`${USER_SQL} WHERE u.role = 'gestor' ORDER BY u.name`),
    q<{ id: string; hostname: string; active: boolean }>(`SELECT id::text, hostname, active FROM domains WHERE NOT is_technical ${sc ? 'AND id = ANY($1::bigint[])' : ''} ORDER BY hostname`, sc ? [[...sc.domainIds]] : []),
    q<{ id: string; name: string; externalId: string; provider: 'google-ads' | 'meta' }>(`SELECT id::text, name, external_id AS "externalId", provider FROM integration_accounts
       WHERE provider IN ('google-ads', 'meta') ${sc ? 'AND id = ANY($1::bigint[])' : ''} ORDER BY name`, sc ? [[...sc.accountIds]] : []),
  ]);
  const hosts = new Set(domains.map((d) => d.hostname));
  // Gerente: gestores sem domínio ou com algum domínio do alcance dele; vê só os vínculos desses domínios
  const vis = await adminVisibleUserIds(req);   // 0.18.12: Admin só os usuários que cadastrou ou dos Squads das Empresas dele
  const list = users.filter((g) => (!vis || vis.has(g.id)) && (!sc || !g.domains.length || g.domains.some((d) => hosts.has(d.domain))));
  res.json({
    viewer: { role: req.user!.role },
    gestores: list.map((g) => ({ id: g.id, name: g.name, email: g.email, status: g.status,
      domains: g.domains.filter((d) => hosts.has(d.domain)), otherDomains: g.domains.filter((d) => !hosts.has(d.domain)).length })),
    domains,
    accounts: { google: accounts.filter((a) => a.provider === 'google-ads'), meta: accounts.filter((a) => a.provider === 'meta') },
  });
});

const ids = z.array(z.string().regex(/^\d+$/)).max(200);
const body = z.object({ domains: z.array(z.object({ domain: z.string().trim().toLowerCase().min(3).max(190), googleAccounts: ids.default([]), metaAccounts: ids.default([]) })).max(300) });
teamRouter.put('/gestores/:id', async (req, res) => {
  const sc = await scopeOf(req);
  const uid = parse(z.string().regex(/^\d+$/, 'id inválido'), req.params.id);
  const b = parse(body, req.body);
  await assertAdminUser(req, uid);
  const g = await one<{ role: string }>('SELECT role FROM users WHERE id = $1', [uid]);
  if (!g) throw notFound('Usuário não encontrado.');
  if (g.role !== 'gestor') throw conflict('not_gestor', 'Só Gestores recebem domínios e contas.');
  const moved = await tx((c) => saveGestorLinks(c, uid, b.domains, req.user!.id, sc ?? undefined));
  await resyncAccounts(moved);
  res.json({ ok: true });
});
