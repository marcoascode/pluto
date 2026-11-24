/**
 * 0.18.6 · Administração → Relatórios (só Admin e SuperAdmin: o adminRouter já aplica requireAdmin).
 * Métricas das contas conectadas ao painel. SuperAdmin: todas as contas e domínios. Admin (0.18.11): só as linhas dos
 * domínios das Empresas em que é sócio, e só as contas que aparecem nesses domínios.
 *
 *   GET /admin/reports/:platform/accounts                         contas da plataforma (para o seletor)
 *   GET /admin/reports/:platform?mode=account&from&to&accounts=   por conta: dia × conta (só as contas escolhidas)
 *   GET /admin/reports/:platform?mode=period&from&to              por período: todas as contas com o total do período
 *
 * platform: meta | google-ads | gam. Moedas: Meta e Google Ads em BRL (como gravadas pelo sync), Ad Manager em USD.
 * Conta da linha: Meta/Google Ads = conta da campanha (campaigns.account_id) · Ad Manager = rede ligada ao domínio
 * (domains.gam_account_id).
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../../db.js';
import { HttpError, parse } from '../../lib/http.js';
import { isIsoDate, today } from '../../lib/dates.js';
import { adminScope } from '../../auth/scope.js';

export const reportsAdminRouter = Router();

const PLATFORM = z.enum(['meta', 'google-ads', 'gam']);
type Platform = z.infer<typeof PLATFORM>;

interface Sums {
  spend: number; iva: number; impressions: number; clicks: number; linkClicks: number; results: number; leads: number;
  revenue: number; netRevenue: number; adImpressions: number; adRequests: number; responsesServed: number; adClicks: number; viewable: number;
}
const SUMS_SQL = `
  SUM(m.spend_brl)::float AS spend, SUM(m.iva_brl)::float AS iva,
  SUM(m.traffic_impressions)::float AS impressions, SUM(m.traffic_clicks)::float AS clicks,
  SUM(m.meta_link_clicks)::float AS "linkClicks", SUM(m.meta_results)::float AS results, SUM(m.meta_leads)::float AS leads,
  SUM(m.revenue_usd)::float AS revenue,
  SUM(m.revenue_usd * (1 - COALESCE((SELECT x.rev_share FROM domain_rev_shares x WHERE x.domain_id = m.domain_id AND x.valid_from <= m.date
                                     ORDER BY x.valid_from DESC LIMIT 1), 0)))::float AS "netRevenue",
  SUM(m.impressions)::float AS "adImpressions", SUM(m.ad_requests)::float AS "adRequests", SUM(m.responses_served)::float AS "responsesServed",
  SUM(m.ad_clicks)::float AS "adClicks", SUM(m.viewable)::float AS viewable`;

const div = (a: number, b: number, k = 1) => (b ? (a / b) * k : null);
const n = (v: unknown) => (v == null ? 0 : Number(v));

/** Métricas de cada plataforma (valores em BRL para Meta/Google Ads e USD para o Ad Manager). */
function metricsOf(p: Platform, r?: Partial<Sums>) {
  const s = Object.fromEntries((['spend', 'iva', 'impressions', 'clicks', 'linkClicks', 'results', 'leads', 'revenue', 'netRevenue', 'adImpressions', 'adRequests', 'responsesServed', 'adClicks', 'viewable'] as const)
    .map((k) => [k, n(r?.[k])])) as unknown as Sums;
  if (p === 'meta') return {
    spend: s.spend, iva: s.iva, total: s.spend + s.iva, impressions: s.impressions, clicks: s.clicks, linkClicks: s.linkClicks,
    ctr: div(s.linkClicks, s.impressions, 100), cpm: div(s.spend, s.impressions, 1000), cpcLink: div(s.spend, s.linkClicks),
    results: s.results, cpr: div(s.spend, s.results), leads: s.leads, cpl: div(s.spend, s.leads),
  };
  if (p === 'google-ads') return {
    spend: s.spend, impressions: s.impressions, clicks: s.clicks, ctr: div(s.clicks, s.impressions, 100), cpc: div(s.spend, s.clicks), cpm: div(s.spend, s.impressions, 1000),
  };
  return {
    revenue: s.revenue, netRevenue: s.netRevenue, impressions: s.adImpressions, adRequests: s.adRequests, responsesServed: s.responsesServed,
    fillRate: div(s.adImpressions, s.adRequests, 100), clicks: s.adClicks, ctr: div(s.adClicks, s.adImpressions, 100),
    ecpm: div(s.revenue, s.adImpressions, 1000), cpc: div(s.revenue, s.adClicks), viewability: div(s.viewable, s.adImpressions, 100),
  };
}

/** Conta de cada linha de daily_metrics, por plataforma. */
const ACCOUNT_JOIN: Record<Platform, string> = {
  meta: `JOIN campaigns c ON c.id = m.campaign_id`,
  'google-ads': `JOIN campaigns c ON c.id = m.campaign_id`,
  gam: `JOIN domains d ON d.id = m.domain_id`,
};
const ACCOUNT_COL: Record<Platform, string> = { meta: 'c.account_id', 'google-ads': 'c.account_id', gam: 'd.gam_account_id' };

/** Contas da plataforma. Com `domainIds` (Admin): só as ligadas a esses domínios (vínculo, campanha ou rede do Ad Manager). */
async function accounts(p: Platform, domainIds: string[] | null = null) {
  const only = domainIds ? (p === 'gam'
    ? 'AND id IN (SELECT gam_account_id FROM domains WHERE id = ANY($2::bigint[]))'
    : 'AND (id IN (SELECT account_id FROM domain_accounts WHERE domain_id = ANY($2::bigint[])) OR id IN (SELECT account_id FROM campaigns WHERE domain_id = ANY($2::bigint[])))') : '';
  return q<{ id: string; name: string; externalId: string; currency: string; imported: boolean; status: string }>(`
    SELECT id::text, name, external_id AS "externalId", currency, imported, status FROM integration_accounts WHERE provider = $1 ${only} ORDER BY name, id`, domainIds ? [p, domainIds] : [p]);
}

reportsAdminRouter.get('/reports/:platform/accounts', async (req, res) => {
  const p = parse(PLATFORM, req.params.platform);
  res.json({ platform: p, currency: p === 'gam' ? 'USD' : 'BRL', accounts: await accounts(p, (await adminScope(req))?.domainIds ?? null) });
});

reportsAdminRouter.get('/reports/:platform', async (req, res) => {
  const p = parse(PLATFORM, req.params.platform);
  const mode = parse(z.enum(['account', 'period']).default('period'), req.query.mode ?? undefined);
  const t = today();
  const from = isIsoDate(req.query.from) ? req.query.from : t;
  const to = isIsoDate(req.query.to) ? req.query.to : t;
  if (from > to) throw new HttpError(422, 'invalid_period', '"from" depois de "to".');
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) throw new HttpError(422, 'period_too_long', 'Período máximo de 400 dias.');
  const doms = (await adminScope(req))?.domainIds ?? null;
  const all = await accounts(p, doms);
  const picked = String(req.query.accounts ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x));
  const ids = mode === 'account' ? all.filter((a) => picked.includes(a.id)).map((a) => a.id) : all.map((a) => a.id);
  const currency = p === 'gam' ? 'USD' : 'BRL';
  if (!ids.length) return res.json({ platform: p, mode, from, to, currency, accounts: [], rows: [], total: metricsOf(p) });

  const acc = ACCOUNT_COL[p];
  const base = `FROM daily_metrics m ${ACCOUNT_JOIN[p]}
     WHERE m.source = $1 AND m.date BETWEEN $2::date AND $3::date AND ${acc} = ANY($4::bigint[])${doms ? ' AND m.domain_id = ANY($5::bigint[])' : ''}`;
  const params: unknown[] = doms ? [p, from, to, ids, doms] : [p, from, to, ids];
  const [grouped, tot] = await Promise.all([
    q<Partial<Sums> & { accountId: string; date: string | null }>(mode === 'account'
      ? `SELECT ${acc}::text AS "accountId", m.date::text AS date, ${SUMS_SQL} ${base} GROUP BY 1, 2 ORDER BY 2 DESC, 1`
      : `SELECT ${acc}::text AS "accountId", NULL AS date, ${SUMS_SQL} ${base} GROUP BY 1`, params),
    q<Partial<Sums>>(`SELECT ${SUMS_SQL} ${base}`, params),
  ]);
  const name = new Map(all.map((a) => [a.id, a]));
  const row = (r: Partial<Sums> & { accountId: string; date: string | null }) => ({
    date: r.date, accountId: r.accountId, accountName: name.get(r.accountId)?.name ?? `Conta ${r.accountId}`, externalId: name.get(r.accountId)?.externalId ?? '', metrics: metricsOf(p, r),
  });
  let rows = grouped.map(row);
  // por período: lista TODAS as contas, inclusive as sem dados no período (zeradas)
  if (mode === 'period') {
    const have = new Set(rows.map((r) => r.accountId));
    rows = [...rows, ...all.filter((a) => !have.has(a.id)).map((a) => row({ accountId: a.id, date: null }))];
  }
  res.json({ platform: p, mode, from, to, currency, accounts: all.filter((a) => ids.includes(a.id)), rows, total: metricsOf(p, tot[0]) });
});
