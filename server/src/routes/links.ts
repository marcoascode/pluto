/**
 * 0.17 · Contas × Sites: vínculo das contas de anúncios (Google Ads / Meta Ads) aos sites, com data, e atribuição
 * de domínios e contas aos gestores.
 *
 * Quem faz o quê:
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
import { allowedDomains } from '../auth/scope.js';
import { applyCurrent, providersOf, snapshotAccount } from '../services/accountLinks.js';
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
  if (isAdminRole(u.role)) {
    const [d, a] = await Promise.all([
      q<{ id: string }>('SELECT id::text FROM domains WHERE NOT is_technical'),
      q<{ id: string }>(`SELECT id::text FROM integration_accounts WHERE provider IN ('google-ads', 'meta')`),
    ]);
    return { role: u.role, userId: u.id, domainIds: new Set(d.map((x) => x.id)), accountIds: new Set(a.map((x) => x.id)) };
  }
  if (u.role === 'gerente') {
    const doms = (await allowedDomains(req)).ids;
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
    viewer: { role: cx.role, canDate: canDate(cx.role), canAssign: canDate(cx.role), today: t },
    domains,
    accounts: accounts.map((a) => {
      const h = hist.filter((x) => x.accountId === a.id);
      const cur = h.find((x) => x.from <= t);
      return { ...a, since: cur && cur.from > '2000-01-01' ? cur.from : null, history: h,
        // o gestor só mexe nos domínios dele; o resto aparece, mas travado
        domains: a.domains.map((d) => ({ ...d, editable: cx.domainIds.has(d.id) })) };
    }),
  });
});

/* ---------------- ligar / desligar ---------------- */
const linkBody = z.object({ domainIds: z.array(ID).max(50), from: ISO.optional() });
linksRouter.put('/:accountId', async (req, res) => {
  const cx = await ctxOf(req);
  const accountId = parse(ID, req.params.accountId);
  const b = parse(linkBody, req.body);
  if (!cx.accountIds.has(accountId)) throw forbid('Esta conta não está atribuída a você.');
  const wanted = [...new Set(b.domainIds)];
  const bad = wanted.filter((d) => !cx.domainIds.has(d));
  if (bad.length) throw forbid('Algum domínio da lista não está atribuído a você.');
  // data: Gerente/Admin escolhem (padrão hoje); Gestor sempre hoje
  if (b.from && !canDate(cx.role) && b.from !== today()) throw forbid('Só Gerente, Admin ou SuperAdmin escolhem a data do vínculo.');
  const from = canDate(cx.role) && b.from ? b.from : today();
  if (from > today()) throw conflict('future_date', 'A data do vínculo não pode ser no futuro.');
  const changed = await tx(async (c) => {
    if (wanted.length && (await q('SELECT 1 FROM domains WHERE id = ANY($1::bigint[]) AND is_technical', [wanted], c)).length) throw conflict('technical_domain', '"Sem domínio" não recebe vínculo.');
    const cur = (await q<{ id: string }>('SELECT domain_id::text AS id FROM domain_accounts WHERE account_id = $1', [accountId], c)).map((r) => r.id);
    // fica o que o usuário não pode mexer + o que ele escolheu
    const next = [...new Set([...cur.filter((d) => !cx.domainIds.has(d)), ...wanted])];
    const removed = cur.filter((d) => !next.includes(d)), added = next.filter((d) => !cur.includes(d));
    if (!removed.length && !added.length && from === today()) return false;
    await c.query('DELETE FROM domain_accounts WHERE account_id = $1 AND domain_id = ANY($2::bigint[])', [accountId, removed]);
    for (const d of added) await c.query('INSERT INTO domain_accounts (domain_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d, accountId]);
    if (cx.role === 'gestor') {
      // o gestor passa a ver (ou deixa de ver) as campanhas desta conta nos domínios dele
      for (const d of added) await c.query('INSERT INTO domain_manager_accounts (domain_id, user_id, account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [d, cx.userId, accountId]);
      await c.query('DELETE FROM domain_manager_accounts WHERE user_id = $1 AND account_id = $2 AND domain_id = ANY($3::bigint[])', [cx.userId, accountId, removed]);
    }
    return snapshotAccount(c, accountId, from, cx.userId);
  });
  if (changed) resync(await providersOf([accountId]));
  res.json({ ok: true, from, changed });
});

/* ---------------- histórico (só Gerente / Admin / SuperAdmin) ---------------- */
async function histRow(req: Request, id: string) {
  const cx = await ctxOf(req);
  if (!canDate(cx.role)) throw forbid('Só Gerente, Admin ou SuperAdmin editam a data do vínculo.');
  const h = await one<{ account_id: string; valid_from: string; domain_ids: string[] }>('SELECT account_id::text, valid_from::text, domain_ids::text[] FROM account_domain_history WHERE id = $1', [id]);
  if (!h) throw notFound('Período não encontrado.');
  if (!cx.accountIds.has(h.account_id)) throw forbid('Conta fora do seu alcance.');
  // Gerente: só períodos com domínios do alcance dele (ou vazios)
  if (cx.role === 'gerente' && h.domain_ids.some((d) => !cx.domainIds.has(d))) throw forbid('Este período tem domínio fora do seu alcance.');
  return h;
}

linksRouter.patch('/history/:id', async (req, res) => {
  const id = parse(ID, req.params.id);
  const b = parse(z.object({ from: ISO }), req.body);
  const h = await histRow(req, id);
  if (b.from > today()) throw conflict('future_date', 'A data do vínculo não pode ser no futuro.');
  await tx(async (c) => {
    if (await one('SELECT 1 FROM account_domain_history WHERE account_id = $1 AND valid_from = $2 AND id <> $3', [h.account_id, b.from, id], c))
      throw conflict('date_taken', 'Já existe uma mudança desta conta nessa data. Exclua uma delas ou escolha outro dia.');
    await c.query('UPDATE account_domain_history SET valid_from = $2, created_by = $3, created_at = now() WHERE id = $1', [id, b.from, req.user!.id]);
    await applyCurrent(c, h.account_id);
  });
  resync(await providersOf([h.account_id]));
  res.json({ ok: true });
});

linksRouter.delete('/history/:id', async (req, res) => {
  const id = parse(ID, req.params.id);
  const h = await histRow(req, id);
  await tx(async (c) => {
    await c.query('DELETE FROM account_domain_history WHERE id = $1', [id]);
    await applyCurrent(c, h.account_id);
  });
  resync(await providersOf([h.account_id]));
  res.status(204).end();
});

/* ---------------- atribuição aos gestores (Gerente / Admin / SuperAdmin) ---------------- */
linksRouter.get('/assignments', async (req, res) => {
  const cx = await ctxOf(req);
  if (!canDate(cx.role)) throw forbid('Só Gerente, Admin ou SuperAdmin atribuem domínios e contas aos gestores.');
  const [gestores, accounts, domains] = await Promise.all([
    q<{ id: string; name: string; email: string; domains: string[]; accounts: string[] }>(`
      SELECT u.id::text, u.name, u.email,
             COALESCE((SELECT array_agg(dm.domain_id::text) FROM domain_managers dm WHERE dm.user_id = u.id), '{}') AS domains,
             COALESCE((SELECT array_agg(ma.account_id::text) FROM manager_accounts ma WHERE ma.user_id = u.id), '{}') AS accounts
        FROM users u WHERE u.role = 'gestor' AND u.status <> 'disabled' ORDER BY u.name`),
    q<{ id: string; name: string; provider: string }>(`SELECT id::text, name, provider FROM integration_accounts WHERE id = ANY($1::bigint[]) ORDER BY provider, name`, [[...cx.accountIds]]),
    q<{ id: string; hostname: string }>('SELECT id::text, hostname FROM domains WHERE id = ANY($1::bigint[]) AND NOT is_technical ORDER BY hostname', [[...cx.domainIds]]),
  ]);
  // Gerente: só os gestores que já têm domínio no alcance dele ou nenhum domínio
  const list = cx.role === 'gerente' ? gestores.filter((g) => !g.domains.length || g.domains.some((d) => cx.domainIds.has(d))) : gestores;
  res.json({
    gestores: list.map((g) => ({ ...g,
      domains: g.domains.filter((d) => cx.domainIds.has(d)), accounts: g.accounts.filter((a) => cx.accountIds.has(a)),
      otherDomains: g.domains.filter((d) => !cx.domainIds.has(d)).length, otherAccounts: g.accounts.filter((a) => !cx.accountIds.has(a)).length })),
    accounts, domains,
  });
});

linksRouter.put('/assignments/:userId', async (req, res) => {
  const cx = await ctxOf(req);
  if (!canDate(cx.role)) throw forbid('Só Gerente, Admin ou SuperAdmin atribuem domínios e contas aos gestores.');
  const uid = parse(ID, req.params.userId);
  const b = parse(z.object({ domainIds: z.array(ID).max(300).optional(), accountIds: z.array(ID).max(300).optional() }), req.body);
  const g = await one<{ role: string }>('SELECT role FROM users WHERE id = $1', [uid]);
  if (!g) throw notFound('Usuário não encontrado.');
  if (g.role !== 'gestor') throw conflict('not_gestor', 'Só Gestores recebem domínios e contas por aqui.');
  if (b.domainIds?.some((d) => !cx.domainIds.has(d))) throw forbid('Algum domínio está fora do seu alcance.');
  if (b.accountIds?.some((a) => !cx.accountIds.has(a))) throw forbid('Alguma conta está fora do seu alcance.');
  await tx(async (c) => {
    // só mexe no que está no alcance de quem edita; o resto do gestor fica como está
    if (b.domainIds) {
      const want = new Set(b.domainIds);
      await c.query('DELETE FROM domain_managers WHERE user_id = $1 AND domain_id = ANY($2::bigint[]) AND NOT (domain_id = ANY($3::bigint[]))', [uid, [...cx.domainIds], [...want]]);
      await c.query('DELETE FROM domain_manager_accounts WHERE user_id = $1 AND domain_id = ANY($2::bigint[]) AND NOT (domain_id = ANY($3::bigint[]))', [uid, [...cx.domainIds], [...want]]);
      for (const d of want) await c.query('INSERT INTO domain_managers (domain_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d, uid]);
    }
    if (b.accountIds) {
      const want = new Set(b.accountIds);
      const gone = (await q<{ id: string }>('SELECT account_id::text AS id FROM manager_accounts WHERE user_id = $1 AND account_id = ANY($2::bigint[])', [uid, [...cx.accountIds]], c))
        .map((r) => r.id).filter((a) => !want.has(a));
      await c.query('DELETE FROM manager_accounts WHERE user_id = $1 AND account_id = ANY($2::bigint[])', [uid, gone]);
      await c.query('DELETE FROM domain_manager_accounts WHERE user_id = $1 AND account_id = ANY($2::bigint[])', [uid, gone]);
      for (const a of want) await c.query('INSERT INTO manager_accounts (user_id, account_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid, a, req.user!.id]);
    }
    // contas do gestor que já estão ligadas aos domínios dele: ele passa a ver as campanhas delas
    await c.query(`INSERT INTO domain_manager_accounts (domain_id, user_id, account_id)
      SELECT da.domain_id, $1, da.account_id FROM domain_accounts da
        JOIN domain_managers dm ON dm.domain_id = da.domain_id AND dm.user_id = $1
        JOIN manager_accounts ma ON ma.account_id = da.account_id AND ma.user_id = $1
      ON CONFLICT DO NOTHING`, [uid]);
  });
  res.json({ ok: true });
});
