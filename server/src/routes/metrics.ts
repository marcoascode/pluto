/**
 * Rotas de leitura (dashboard, domínios, campanhas, URLs, Ad Manager, relatórios, atribuição, busca, UTM, câmbio).
 * TODAS passam por scope() (auth/scope.ts): Gestor só os domínios/contas dele, Gerente os Squads dele, ?company= filtra a Empresa.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { addDays, isIsoDate, lastMonths, monthBounds, today } from '../lib/dates.js';
import { requireCap } from '../auth/session.js';
import { allowedDomains, canSeeCampaign, scope, type RowFilter, type Scope } from '../auth/scope.js';
import { aggregate, roiDays, total, toMetrics, type Currency, type Metrics } from '../services/metrics.js';
import * as fx from '../services/fx.js';

export const metricsRouter = Router();

/* ---------- filtros comuns ---------- */
const MAX_DAYS = 400;
export function period(req: Request) {
  const t = today();
  const from = isIsoDate(req.query.from) ? req.query.from : t;
  const to = isIsoDate(req.query.to) ? req.query.to : t;
  if (from > to) throw new HttpError(422, 'invalid_period', '"from" depois de "to".');
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 864e5) throw new HttpError(422, 'period_too_long', `Período máximo de ${MAX_DAYS} dias.`);
  const cur = (['USD', 'BRL', 'EUR'].includes(String(req.query.currency)) ? req.query.currency : 'USD') as Currency;
  return { from, to, currency: cur, today: t };
}
/** Período anterior de mesmo tamanho. Se inclui hoje (e tem mais de 1 dia), compara sem hoje. Só hoje → null. */
export function previous(from: string, to: string, t: string) {
  if (from === t && to === t) return null;
  const end = to === t ? addDays(to, -1) : to;
  const len = Math.round((Date.parse(end) - Date.parse(from)) / 864e5) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
export const d3 = (t: string) => addDays(t, -3);

/* ---------- dashboard ---------- */
metricsRouter.get('/dashboard', async (req, res) => {
  const p = period(req);
  const sc = await scope(req, req.query.domain);
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency };
  const prev = previous(p.from, p.to, p.today);
  const dailyFrom = p.from < addDays(p.to, -13) ? p.from : addDays(p.to, -13);
  const [metrics, cmp, daily, byDom, sync] = await Promise.all([
    total({ ...base, from: p.from, to: p.to }),
    prev ? total({ ...base, ...prev }) : null,
    aggregate({ ...base, from: dailyFrom, to: p.today, groupBy: 'm.date' }),
    aggregate({ ...base, from: p.from, to: p.to, groupBy: 'm.domain_id' }),
    one<{ at: string | null }>('SELECT max(last_sync_at) AS at FROM integration_connections'),
  ]);
  const days: { date: string; partial: boolean; metrics: Metrics }[] = [];
  for (let d = p.today; d >= dailyFrom; d = addDays(d, -1)) days.push({ date: d, partial: d === p.today, metrics: daily.get(d) ?? toMetrics() });
  res.json({
    period: { from: p.from, to: p.to },
    comparison: prev && cmp ? { ...prev, metrics: cmp } : null,
    metrics,
    daily: days,
    domains: sc.ids.map((id, i) => ({ domain: sc.hosts[i], metrics: byDom.get(id) ?? toMetrics() })),
    lastSyncAt: sync?.at ? new Date(sync.at).toISOString() : null,
  });
});

/* ---------- domínios ---------- */
metricsRouter.get('/domains/summary', async (req, res) => {
  const p = period(req);
  const sc = await scope(req);
  const by = await aggregate({ domainIds: sc.ids, filter: sc.filter, currency: p.currency, from: p.from, to: p.to, groupBy: 'm.domain_id' });
  res.json({ domains: sc.ids.map((id, i) => ({ domain: sc.hosts[i], metrics: by.get(id) ?? toMetrics() })) });
});

interface CampRow { id: string; db_id: string; domain_id: string; platform: 'google' | 'meta'; name: string; domain: string; account_id: string; account_name: string; status: 'ENABLED' | 'PAUSED' }
const CAMP_SQL = `
  SELECT c.external_id AS id, c.id::text AS db_id, c.domain_id::text, c.platform, c.name, d.hostname AS domain, a.id::text AS account_id, a.name AS account_name, c.status
    FROM campaigns c JOIN domains d ON d.id = c.domain_id JOIN integration_accounts a ON a.id = c.account_id
   WHERE c.domain_id = ANY($1::bigint[]) AND c.status <> 'REMOVED'`;

/** Só as campanhas liberadas no escopo (Gestor: contas dele em cada domínio). */
const visible = (sc: Scope, camps: CampRow[]) => camps.filter((c) => canSeeCampaign(sc, c.db_id, c.domain_id));

async function campaignRows(camps: CampRow[], base: { domainIds: string[]; filter: RowFilter | null; currency: Currency }, from: string, to: string, t: string) {
  const ids = camps.map((c) => c.db_id);
  if (!ids.length) return [];
  const [by, rd] = await Promise.all([
    aggregate({ ...base, from, to, groupBy: 'm.campaign_id', where: 'm.campaign_id = ANY($5::bigint[])', params: [ids] }),
    roiDays({ ...base, key: 'm.campaign_id', today: t, d3: d3(t), where: 'm.campaign_id = ANY($5::bigint[])', params: [ids] }),
  ]);
  return camps.map((c) => ({ id: c.id, platform: c.platform, name: c.name, domain: c.domain, accountId: c.account_id, accountName: c.account_name, status: c.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', metrics: by.get(c.db_id) ?? toMetrics(), roiDays: rd(c.db_id) }));
}

metricsRouter.get('/domains/:hostname', async (req, res) => {
  const p = period(req);
  const sc = await scope(req, req.params.hostname);
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency };
  const prev = previous(p.from, p.to, p.today);
  const attributed = `m.platform <> 'none'`;
  const camps = visible(sc, await q<CampRow>(CAMP_SQL + ' ORDER BY c.name', [sc.ids]));
  const [metrics, cmp, ct, ctr, rows] = await Promise.all([
    total({ ...base, from: p.from, to: p.to }),
    prev ? total({ ...base, ...prev }) : null,
    total({ ...base, from: p.from, to: p.to, where: attributed }),
    roiDays({ ...base, key: `''`, today: p.today, d3: d3(p.today), where: attributed }),
    campaignRows(camps, base, p.from, p.to, p.today),
  ]);
  res.json({ domain: sc.hosts[0], comparison: prev && cmp ? { ...prev, metrics: cmp } : null, metrics, campaignTotals: ct, campaignTotalsRoiDays: ctr(''), campaigns: rows });
});

/* ---------- campanhas ---------- */
metricsRouter.get('/campaigns', async (req, res) => {
  const platform = parse(z.enum(['google', 'meta']), req.query.platform);
  if (!req.user!.permissions.includes(platform === 'google' ? 'campaigns.google.view' : 'campaigns.meta.view')) throw new HttpError(403, 'forbidden_module', 'Este módulo não está liberado para o seu usuário.');
  const p = period(req);
  const sc = await scope(req, req.query.domain);
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency };
  const includePaused = req.query.includePaused === 'true';
  const accountId = typeof req.query.accountId === 'string' && /^\d+$/.test(req.query.accountId) ? req.query.accountId : null;
  const all = visible(sc, await q<CampRow>(`${CAMP_SQL} AND c.platform = $2 ORDER BY c.name`, [sc.ids, platform]));
  const camps = all.filter((c) => (includePaused || c.status === 'ENABLED') && (!accountId || c.account_id === accountId));
  const ids = camps.map((c) => c.db_id);
  const where = 'm.campaign_id = ANY($5::bigint[])';
  const prev = previous(p.from, p.to, p.today);
  const [totals, cmp, trd, rows] = await Promise.all([
    total({ ...base, from: p.from, to: p.to, where, params: [ids] }),
    prev ? total({ ...base, ...prev, where, params: [ids] }) : null,
    roiDays({ ...base, key: `''`, today: p.today, d3: d3(p.today), where, params: [ids] }),
    campaignRows(camps, base, p.from, p.to, p.today),
  ]);
  const accounts = [...new Map(all.map((c) => [c.account_id, { id: c.account_id, name: c.account_name }])).values()];
  res.json({ comparison: prev && cmp ? { ...prev, metrics: cmp } : null, totals, totalsRoiDays: trd(''), campaigns: rows, accounts });
});

async function findCampaign(req: Request) {
  const platform = parse(z.enum(['google', 'meta']), req.params.platform);
  const sc = await allowedDomains(req);
  const c = await one<CampRow>(`${CAMP_SQL} AND c.platform = $2 AND c.external_id = $3`, [sc.ids, platform, req.params.id]);
  if (!c || !canSeeCampaign(sc, c.db_id, c.domain_id)) throw notFound('Campanha não encontrada.');
  return { c, ids: sc.ids, filter: sc.filter };
}

metricsRouter.get('/campaigns/:platform/:id/children', async (req, res) => {
  const p = period(req);
  const { c, ids, filter } = await findCampaign(req);
  const base = { domainIds: ids, filter, currency: p.currency, where: 'm.campaign_id = $5', params: [c.db_id] };
  const groups = await q<{ id: string; ext: string; name: string }>('SELECT id::text, external_id AS ext, name FROM ad_groups WHERE campaign_id = $1 ORDER BY name', [c.db_id]);
  const ads = await q<{ id: string; ext: string; name: string; gid: string }>('SELECT a.id::text, a.external_id AS ext, a.name, a.ad_group_id::text AS gid FROM ads a JOIN ad_groups g ON g.id = a.ad_group_id WHERE g.campaign_id = $1 ORDER BY a.name', [c.db_id]);
  const [gm, am, grd, ard] = await Promise.all([
    aggregate({ ...base, from: p.from, to: p.to, groupBy: 'm.ad_group_id' }),
    aggregate({ ...base, from: p.from, to: p.to, groupBy: 'm.ad_id' }),
    roiDays({ ...base, key: 'm.ad_group_id', today: p.today, d3: d3(p.today) }),
    roiDays({ ...base, key: 'm.ad_id', today: p.today, d3: d3(p.today) }),
  ]);
  res.json({ groups: groups.map((g) => ({ id: g.ext, name: g.name, metrics: gm.get(g.id) ?? toMetrics(), roiDays: grd(g.id),
    ads: ads.filter((a) => a.gid === g.id).map((a) => ({ id: a.ext, name: a.name, metrics: am.get(a.id) ?? toMetrics(), roiDays: ard(a.id) })) })) });
});

const regionName = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const countryName = (cc: string) => { if (cc === 'ZZ') return 'Desconhecido'; try { return regionName.of(cc) ?? cc; } catch { return cc; } };

metricsRouter.get('/campaigns/:platform/:id/countries', async (req, res) => {
  const p = period(req);
  const { c, ids, filter } = await findCampaign(req);
  const base = { domainIds: ids, filter, currency: p.currency, from: p.from, to: p.to, where: 'm.campaign_id = $5', params: [c.db_id] };
  const [tot, by] = await Promise.all([total(base), aggregate({ ...base, groupBy: 'm.country' })]);
  res.json({ campaign: { id: c.id, name: c.name, platform: c.platform, domain: c.domain }, totals: tot,
    countries: [...by].map(([k, m]) => ({ country: k, name: countryName(k), metrics: m })).sort((a, b) => b.metrics.spend - a.metrics.spend) });
});

/* ---------- URLs ---------- */
metricsRouter.get('/urls', requireCap('urls.view'), async (req, res) => {
  const p = period(req);
  const sc = await scope(req, req.query.domain);
  const by = await aggregate({ domainIds: sc.ids, filter: sc.filter, currency: p.currency, from: p.from, to: p.to, groupBy: `d.hostname || '|' || COALESCE(u.path, '(sem URL)')`,
    joins: 'JOIN domains d ON d.id = m.domain_id LEFT JOIN urls u ON u.id = m.url_id' });
  res.json({ urls: [...by].map(([k, m]) => { const i = k.indexOf('|'); return { domain: k.slice(0, i), path: k.slice(i + 1), metrics: m }; }) });
});

/* ---------- Ad Manager ---------- */
metricsRouter.get('/gam/summary', requireCap('gam.view'), async (req, res) => {
  const p = period(req);
  const sc = await scope(req, req.query.domain);
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency, from: p.from, to: p.to };
  const [metrics, by, net] = await Promise.all([
    total(base), aggregate({ ...base, groupBy: 'm.domain_id' }),
    one<{ name: string; code: string; currency: Currency }>(`SELECT name, external_id AS code, currency FROM integration_accounts WHERE provider = 'gam' ORDER BY imported DESC, id LIMIT 1`),
  ]);
  res.json({ network: net ?? { name: 'Ad Manager não conectado', code: '—', currency: 'USD' }, metrics, domains: sc.ids.filter((id) => by.has(id)).map((id) => ({ domain: sc.hosts[sc.ids.indexOf(id)], metrics: by.get(id)! })) });
});

/* ---------- relatórios ---------- */
const reportQuery = (req: Request) => ({ currency: (['USD', 'BRL', 'EUR'].includes(String(req.query.currency)) ? req.query.currency : 'USD') as Currency, t: today() });

metricsRouter.get('/reports/daily', requireCap('reports.view'), async (req, res) => {
  const { currency, t } = reportQuery(req);
  const month = parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM').default(t.slice(0, 7)), req.query.month);
  const sc = await scope(req, req.query.domain);
  const [first, last0] = monthBounds(month);
  const last = last0 > t ? t : last0;
  if (first > t) return res.json({ month, total: toMetrics(), days: [] });
  const base = { domainIds: sc.ids, filter: sc.filter, currency, from: first, to: last };
  const [tot, by] = await Promise.all([total(base), aggregate({ ...base, groupBy: 'm.date' })]);
  const days = [];
  for (let d = last; d >= first; d = addDays(d, -1)) days.push({ key: d, partial: d >= d3(t), metrics: by.get(d) ?? toMetrics() });
  res.json({ month, total: tot, days });
});

metricsRouter.get('/reports/monthly', requireCap('reports.view'), async (req, res) => {
  const { currency, t } = reportQuery(req);
  const n = Math.min(Math.max(1, Number(req.query.months) || 14), 36);
  const sc = await scope(req, req.query.domain);
  const months = lastMonths(n, t);
  const base = { domainIds: sc.ids, filter: sc.filter, currency, from: monthBounds(months[n - 1])[0], to: t };
  const [tot, by] = await Promise.all([total(base), aggregate({ ...base, groupBy: `to_char(m.date, 'YYYY-MM')` })]);
  res.json({ total: tot, months: months.map((m) => ({ key: m, partial: m >= d3(t).slice(0, 7), metrics: by.get(m) ?? toMetrics() })) });
});

/* ---------- Attribution Health ---------- */
const ISSUES: Record<string, [string, string, string]> = {
  missing_campaign_id: ['Missing Campaign ID', 'utm_campaign não contém o Campaign ID.', 'Verificar o tracking template / sufixo do URL final da campanha.'],
  missing_adgroup_id: ['Missing Ad Group ID', 'utm_content chegou sem o {adgroupid}.', 'Conferir se utm_content={adgroupid}_{creative} está no template da conta.'],
  missing_creative_id: ['Missing Creative ID', 'utm_content chegou sem a parte {creative}.', 'Conferir o template da conta.'],
  invalid_utm: ['UTM inválida', 'Macro não substituída, por exemplo {campaignid} escrito na URL.', 'Usar o sufixo do URL final em vez de colar a URL pronta.'],
  unknown_domain: ['Domínio não identificado', 'Receita de um site que não está cadastrado.', 'Cadastrar o domínio em Configurações → Domínios.'],
  campaign_not_found: ['Campanha não localizada', 'O Campaign ID não existe nas contas importadas.', 'Importar a conta dona da campanha na MCC.'],
  meta_ad_not_found: ['Meta Ad não localizado', 'O Ad ID não está nas contas Meta conectadas.', 'Reconectar a conta Meta e conferir {{ad.id}}.'],
  gads_creative_not_found: ['Google Ads Creative não localizado', 'O Creative ID não tem correspondência na estrutura.', 'Rodar o sync de estrutura.'],
  gam_kv_not_configured: ['Key-values sem dimensão no Ad Manager', 'O Ad Manager não está devolvendo utm_campaign/utm_content no relatório.', 'No Ad Manager: Inventário → Key-values → utm_campaign e utm_content → "Report on values" = Custom dimension.'],
};
metricsRouter.get('/attribution/health', requireCap('attribution.view'), async (req, res) => {
  const p = period(req);
  const sc = await scope(req, req.query.domain);
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency, from: p.from, to: p.to };
  const winFrom = p.from < addDays(p.to, -13) ? p.from : addDays(p.to, -13);
  const [metrics, issues, issueDoms, daily, by] = await Promise.all([
    total(base),
    aggregate({ ...base, groupBy: `COALESCE(m.unattributed_reason, 'unknown')`, where: `m.platform = 'none'` }),
    q<{ reason: string; hosts: string[] }>(`SELECT COALESCE(m.unattributed_reason, 'unknown') AS reason, array_agg(DISTINCT d.hostname) AS hosts FROM daily_metrics m JOIN domains d ON d.id = m.domain_id
       WHERE m.platform = 'none' AND m.date BETWEEN $1 AND $2 AND m.domain_id = ANY($3::bigint[]) GROUP BY 1`, [p.from, p.to, sc.ids]),
    aggregate({ ...base, from: winFrom, groupBy: 'm.date' }),
    aggregate({ ...base, groupBy: 'm.domain_id' }),
  ]);
  const hosts = new Map(issueDoms.map((r) => [r.reason, r.hosts]));
  res.json({
    metrics,
    issues: [...issues].map(([k, m]) => ({ type: k, title: ISSUES[k]?.[0] ?? k, cause: ISSUES[k]?.[1] ?? '—', action: ISSUES[k]?.[2] ?? '—', sessions: m.sessions, revenue: m.revenue, domains: hosts.get(k) ?? [] })).sort((a, b) => b.revenue - a.revenue),
    daily: [...daily].map(([d, m]) => ({ date: d, attributionRate: m.attributionRate })).sort((a, b) => b.date.localeCompare(a.date)),
    domains: sc.ids.filter((id) => by.has(id)).map((id) => { const m = by.get(id)!; return { domain: sc.hosts[sc.ids.indexOf(id)], registered: true, revenue: m.revenue, unattributed: m.unattributedRevenue, attributionRate: m.attributionRate }; }),
  });
});

/* ---------- busca (Ctrl+K) ---------- */
metricsRouter.get('/search', async (req, res) => {
  const t = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
  if (t.length < 2) return res.json({ results: [] });
  const sc = await allowedDomains(req);
  const like = `%${t.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const camps = visible(sc, await q<CampRow>(`${CAMP_SQL} AND (lower(c.name) LIKE $2 OR c.external_id LIKE $2) ORDER BY c.name LIMIT 30`, [sc.ids, like])).slice(0, 6);
  res.json({ results: [
    ...camps.filter((c) => req.user!.permissions.includes(c.platform === 'google' ? 'campaigns.google.view' : 'campaigns.meta.view'))
      .map((c) => ({ kind: 'campaign', label: c.name, sub: c.id, platform: c.platform, id: c.id, domain: c.domain })),
    ...sc.hosts.filter((h) => h.includes(t)).map((h) => ({ kind: 'domain', label: h, domain: h })),
  ] });
});

/* ---------- UTMs ---------- */
async function templates() {
  return (await one<{ value: { google: string; meta: string } }>(`SELECT value FROM app_settings WHERE key = 'utm_templates'`))?.value ?? { google: '', meta: '' };
}
metricsRouter.get('/utm/templates', async (_req, res) => { res.json(await templates()); });

metricsRouter.post('/utm/debug', requireCap('utm.debug'), async (req, res) => {
  const { url: raw } = parse(z.object({ url: z.string().max(4000) }), req.body);
  const tpl = await templates();
  let url: URL;
  try { url = new URL(raw.trim()); } catch {
    return res.json({ status: 'invalid', source: null, domain: '', campaign: null, fields: {}, checks: [{ level: 'error', message: 'URL inválida', detail: 'Cole a URL completa, começando com https://' }], preview: { google: '', meta: '' } });
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const qs = Object.fromEntries(url.searchParams);
  const checks: { level: 'ok' | 'warn' | 'error'; message: string; detail?: string }[] = [];
  const isMeta = /^(fb|facebook|ig|instagram|an|msg)$/i.test(qs.utm_source ?? '') || qs.utm_medium === 'paid_social' || !!qs.fbclid;
  const isGoogle = !isMeta && (/^google$/i.test(qs.utm_source ?? '') || !!qs.gclid || qs.utm_medium === 'cpc');
  const okv = (v?: string | null) => !!v && !/[{}]/.test(v);
  const source = isMeta ? 'Meta Ads' : isGoogle ? 'Google Ads' : null;
  checks.push(source ? { level: 'ok', message: `Source identificada: ${source}` } : { level: 'error', message: 'Source não identificada', detail: 'utm_source deve ser "google" ou o {{site_source_name}} da Meta.' });
  const dom = await one<{ hostname: string; active: boolean }>('SELECT hostname, active FROM domains WHERE hostname = $1', [host]);
  checks.push(dom ? { level: dom.active ? 'ok' : 'warn', message: dom.active ? `Domínio cadastrado: ${dom.hostname}` : `Domínio ${dom.hostname} está inativo` } : { level: 'error', message: `Domínio não identificado: ${host}` });
  Object.entries(qs).filter(([, v]) => /[{}]/.test(v)).forEach(([k, v]) => checks.push({ level: 'error', message: `Macro não substituída em ${k}`, detail: `Valor "${v}".` }));
  const [p1, p2] = (qs.utm_content ?? '').split('_');
  const fields: Record<string, string | null> = isMeta
    ? { campaignId: qs.utm_campaign ?? null, adSetId: p1 || null, adId: p2 || null, placement: qs.utm_term ?? null }
    : { campaignId: qs.utm_campaign ?? null, adGroupId: p1 || null, creative: p2 || null, keyword: qs.utm_term ?? null, placement: qs.placement ?? null, network: qs.network ?? null, device: qs.device ?? null };
  const need = isMeta ? [['campaignId', 'campaign.id'], ['adSetId', 'adset.id'], ['adId', 'ad.id']] : [['campaignId', 'campaignid'], ['adGroupId', 'adgroupid']];
  need.forEach(([k, l]) => checks.push(okv(fields[k]) ? { level: 'ok', message: `${l} detectado` } : { level: 'error', message: `${l} ausente` }));
  if (!isMeta) checks.push(okv(fields.creative) ? { level: 'ok', message: 'creative detectado' } : { level: 'warn', message: 'creative vazio' });
  checks.push(okv(fields.placement) ? { level: 'ok', message: 'placement detectado' } : { level: 'warn', message: 'placement vazio', detail: 'A análise por placement fica sem essa sessão.' });
  let campaign: { id: string; name: string } | null = null;
  if (okv(fields.campaignId)) {
    const sc = await allowedDomains(req);
    const hit = await one<{ id: string; name: string; db_id: string; domain_id: string | null }>(`SELECT c.external_id AS id, c.name, c.id::text AS db_id, c.domain_id::text FROM campaigns c WHERE c.external_id = $1 AND (c.domain_id IS NULL OR c.domain_id = ANY($2::bigint[])) LIMIT 1`, [fields.campaignId, sc.ids]);
    campaign = hit && canSeeCampaign(sc, hit.db_id, hit.domain_id) ? { id: hit.id, name: hit.name } : null;
    checks.push(campaign ? { level: 'ok', message: `Campanha localizada: ${campaign.name}` } : { level: 'error', message: 'Campanha não localizada', detail: 'O ID não existe nas contas importadas.' });
  }
  const base = url.origin + url.pathname;
  res.json({ status: checks.some((c) => c.level === 'error') ? 'invalid' : 'valid', source, domain: host, campaign, fields, checks, preview: { google: `${base}?${tpl.google}`, meta: `${base}?${tpl.meta}` } });
});

/* ---------- câmbio ---------- */
metricsRouter.get('/fx/latest', async (_req, res) => {
  const l = await fx.latest();
  if (l.rates.BRL == null || l.rates.EUR == null) throw new HttpError(503, 'fx_unavailable', 'Ainda não há cotação. Ela é buscada automaticamente em instantes.');
  res.json(l);
});
metricsRouter.get('/fx/history', async (req, res) => {
  res.json(await fx.history(Math.min(Math.max(1, Number(req.query.days) || 10), 400)));
});
