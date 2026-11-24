/**
 * 0.17 · Contas × Sites: vínculo das contas de anúncios (Google Ads / Meta Ads) aos sites, com data, e atribuição
 * de domínios e contas aos gestores.
 *
 * 0.18.8: os vínculos são criados SÓ em Usuários & Squads (gestor → domínio → contas). Aqui fica a consulta
 * (quem paga qual site, desde quando) e o ajuste da data em que cada mudança passou a valer (Gerente/Admin/SuperAdmin).
 *
 * Quem fazia o quê até a 0.18.7:
 *   Gestor ............ vê só as contas e os domínios atribuídos a ele; liga/desliga as contas dele nos domínios dele.
 *                       A mudança vale a partir de HOJE (não escolhe data). Vínculos com domínios de outros ficam como estão.
 *   Gerente ........... vê os domínios do alcance dele (Squads/Empresas) e as contas ligadas a eles ou sem site;
 *                       liga contas a esses domínios escolhendo a data; edita e exclui datas do histórico;
 *                       atribui esses domínios e contas aos gestores.
 *   Admin / SuperAdmin  tudo isso em todos os domínios e contas (e continua podendo usar Admin → Domínios / Contas).
 * Toda mudança de vínculo grava o histórico (account_domain_history) e manda ressincronizar a despesa da plataforma.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { HttpError, conflict, notFound, parse } from '../lib/http.js';
import { today } from '../lib/dates.js';
import { isAdminRole } from '../auth/permissions.js';
import { adminScope, allowedDomains } from '../auth/scope.js';
import { applyCurrent, providersOf } from '../services/accountLinks.js';
import { requestRun } from '../services/sync/index.js';

export const linksRouter = Router();

const ID = z.string().regex(/^\d+$/);
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const canDate = (r: string) => r === 'gerente' || isAdminRole(r);
const forbid = (m: string) => new HttpError(403, 'forbidden', m);

interface Ctx { role: string; userId: string; domainIds: Set<string>; accountIds: Set<string> }

/** Domínios e contas que o usuário pode ver e ligar. */
async function ctxOf(req: Request): Promise<Ctx> {
  const u = req.user!;
  if (u.role === 'superadmin') {
    const [d, a] = await Promise.all([
      q<{ id: string }>('SELECT id::text FROM domains WHERE NOT is_technical'),
      q<{ id: string }>(`SELECT id::text FROM integration_accounts WHERE provider IN ('google-ads', 'meta')`),
    ]);
    return { role: u.role, userId: u.id, domainIds: new Set(d.map((x) => x.id)), accountIds: new Set(a.map((x) => x.id)) };
  }
  // 0.18.11: Admin, como o Gerente, só nos domínios do alcance dele (Empresas em que é sócio)
  if (u.role === 'gerente' || isAdminRole(u.role)) {
    const doms = isAdminRole(u.role) ? (await adminScope(req))!.domainIds : (await allowedDomains(req)).ids;
    const acc = await q<{ id: string }>(`
      SELECT a.id::text FROM integration_accounts a WHERE a.provider IN ('google-ads', 'meta') AND (
        EXISTS (SELECT 1 FROM domain_accounts da WHERE da.account_id = a.id AND da.domain_id = ANY($1::bigint[]))
        OR NOT EXISTS (SELECT 1 FROM domain_accounts da WHERE da.account_id = a.id)
        OR EXISTS (SELECT 1 FROM manager_accounts ma JOIN domain_managers dm ON dm.user_id = ma.user_id WHERE ma.account_id = a.id AND dm.domain_id = ANY($1::bigint[])))`, [doms]);
    return { role: u.role, userId: u.id, domainIds: new Set(doms), accountIds: new Set(acc.map((x) => x.id)) };
  }
  if (u.role === 'gestor') {
    const [d, a] = await Promise.all([
      q<{ id: string }>('SELECT dm.domain_id::text AS id FROM domain_managers dm JOIN domains d ON d.id = dm.domain_id WHERE dm.user_id = $1 AND NOT d.is_technical', [u.id]),
      q<{ id: string }>(`SELECT ma.account_id::text AS id FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id WHERE ma.user_id = $1 AND a.provider IN ('google-ads', 'meta')`, [u.id]),
    ]);
    return { role: u.role, userId: u.id, domainIds: new Set(d.map((x) => x.id)), accountIds: new Set(a.map((x) => x.id)) };
  }
  throw forbid('Sem acesso a Contas × Sites.');
}

const resync = (providers: Set<'google-ads' | 'meta'>) => {
  for (const p of providers) {
    requestRun(p === 'meta' ? 'meta.metrics' : 'google-ads.metrics');
    if (p === 'google-ads') requestRun('google-ads.placements');
  }
};

/* ---------------- lista ---------------- */
linksRouter.get('/', async (req, res) => {
  const cx = await ctxOf(req);
  const accIds = [...cx.accountIds], domIds = [...cx.domainIds];
  const [accounts, domains, hist] = await Promise.all([
    q<{ id: string; name: string; provider: string; externalId: string; imported: boolean; status: string | null; domains: { id: string; hostname: string }[] }>(`
      SELECT a.id::text, a.name, a.provider, a.external_id AS "externalId", a.imported, a.platform_status AS status,
             COALESCE(json_agg(json_build_object('id', d.id::text, 'hostname', d.hostname) ORDER BY d.hostname) FILTER (WHERE d.id IS NOT NULL), '[]') AS domains
        FROM integration_accounts a
        LEFT JOIN domain_accounts da ON da.account_id = a.id
        LEFT JOIN domains d ON d.id = da.domain_id
       WHERE a.id = ANY($1::bigint[])
       GROUP BY a.id ORDER BY a.provider, a.name`, [accIds]),
    q<{ id: string; hostname: string; active: boolean }>('SELECT id::text, hostname, active FROM domains WHERE id = ANY($1::bigint[]) ORDER BY hostname', [domIds]),
    q<{ id: string; accountId: string; from: string; domains: string[]; by: string | null; at: string }>(`
      SELECT h.id::text, h.account_id::text AS "accountId", h.valid_from::text AS "from",
             COALESCE((SELECT array_agg(d.hostname ORDER BY d.hostname) FROM domains d WHERE d.id = ANY(h.domain_ids)), '{}') AS domains,
             u.name AS by, h.created_at AS at
        FROM account_domain_history h LEFT JOIN users u ON u.id = h.created_by
       WHERE h.account_id = ANY($1::bigint[]) ORDER BY h.account_id, h.valid_from DESC`, [accIds]),
  ]);
  const t = today();
  res.json({
    viewer: { role: cx.role, canDate: canDate(cx.role), canAssign: false, today: t },
    domains,
    accounts: accounts.map((a) => {
      const h = hist.filter((x) => x.accountId === a.id);
      const cur = h.find((x) => x.from <= t);
      const hosts = new Set(domains.map((d) => d.hostname));
      return { ...a, since: cur && cur.from > '2000-01-01' ? cur.from : null,
        history: cx.role === 'admin' ? h.map((x) => ({ ...x, domains: x.domains.filter((hn) => hosts.has(hn)) })) : h,
        // o gestor só mexe nos domínios dele; o resto aparece, mas travado
        // 0.18.11: o Admin não vê domínios de Empresas das quais não é sócio
        domains: a.domains.filter((d) => cx.role !== 'admin' || cx.domainIds.has(d.id)).map((d) => ({ ...d, editable: cx.domainIds.has(d.id) })) };
    }),
  });
});

/* 0.18.8: ligar/desligar conta × site e atribuir domínios/contas a gestores saiu daqui (PUT /:accountId e /assignments).
   O vínculo usuário × domínio × conta é feito só em Usuários & Squads; esta tela mostra o resultado e o histórico. */

/* ---------------- histórico (só Gerente / Admin / SuperAdmin) ---------------- */
async function histRow(req: Request, id: string) {
  const cx = await ctxOf(req);
  if (!canDate(cx.role)) throw forbid('Só Gerente, Admin ou SuperAdmin editam a data do vínculo.');
  const h = await one<{ account_id: string; valid_from: string; domain_ids: string[] }>('SELECT account_id::text, valid_from::text, domain_ids::text[] FROM account_domain_history WHERE id = $1', [id]);
  if (!h) throw notFound('Período não encontrado.');
  if (!cx.accountIds.has(h.account_id)) throw forbid('Conta fora do seu alcance.');
  // Gerente: só períodos com domínios do alcance dele (ou vazios)
  if ((cx.role === 'gerente' || cx.role === 'admin') && h.domain_ids.some((d) => !cx.domainIds.has(d))) throw forbid('Este período tem domínio fora do seu alcance.');
  return h;
}

linksRouter.patch('/history/:id', async (req, res) => {
  const id = parse(ID, req.params.id);
  const b = parse(z.object({ from: ISO }), req.body);
  const h = await histRow(req, id);
  if (b.from > today()) throw conflict('future_date', 'A data do vínculo não pode ser no futuro.');
  await tx(async (c) => {
    if (await one('SELECT 1 FROM account_domain_history WHERE account_id = $1 AND valid_from = $2 AND id <> $3', [h.account_id, b.from, id], c))
      throw conflict('date_taken', 'Já existe uma mudança desta conta nessa data. Escolha outro dia.');
    // 0.18.8: só ajusta QUANDO a mudança valeu; a ordem das mudanças (e o vínculo de hoje, que vem de Usuários) não muda
    const near = await one<{ prev: string | null; next: string | null }>(`SELECT
        (SELECT max(valid_from)::text FROM account_domain_history WHERE account_id = $1 AND valid_from < $2) AS prev,
        (SELECT min(valid_from)::text FROM account_domain_history WHERE account_id = $1 AND valid_from > $2) AS next`, [h.account_id, h.valid_from], c);
    if ((near?.prev && b.from <= near.prev) || (near?.next && b.from >= near.next))
      throw conflict('date_order', 'A data precisa ficar entre a mudança anterior e a seguinte desta conta.');
    await c.query('UPDATE account_domain_history SET valid_from = $2, created_by = $3, created_at = now() WHERE id = $1', [id, b.from, req.user!.id]);
    await applyCurrent(c, h.account_id);
  });
  resync(await providersOf([h.account_id]));
  res.json({ ok: true });
});
