/**
 * Finance 0.15 · resultado por site e comissão dos gestores.
 *
 * Resultado do site no mês (em R$) = receita líquida do dash − despesas de anúncio do dash − outros gastos do Caixa
 *   com o site − custos do site (aba Custos).
 *   Receita e despesa de anúncio são os MESMOS números da Home (daily_metrics: receita do Ad Manager já sem o revshare,
 *   convertida pela cotação do ROI do mês (travada ou atual c/ deságio); Google + Meta + IVA em R$). Assim a comissão não depende de lançar a receita por site no Caixa
 *   e não conta a fatura do Google/Meta duas vezes (gastos Google Ads/Meta Ads lançados no Caixa ficam fora daqui).
 *   "Mês" dos lançamentos do Caixa = mês de referência (competence) ou, sem ele, o mês da data.
 * Gestor do site = vínculo manual em "Gestores e sites" (com rateio e datas) ou, sem vínculo manual no mês,
 *   o(s) gestor(es) do Squad do domínio (domain_managers / squad_users), dividindo 100% entre eles.
 * Comissão do gestor (por Empresa e mês fechado) = regra sobre a SOMA do resultado dos sites dele
 *   (× rateio × dias do mês em que foi responsável). Site negativo reduz o lucro e, com isso, a comissão.
 *   Regra padrão Meritocracia: sem lucro sem comissão · até US$ 20K 10% · acima de US$ 20K 12% · a partir de US$ 40K 15%
 *   (a faixa atingida vale para o lucro todo; o lucro em R$ é convertido para US$ pela cotação do fim do mês).
 * A comissão é paga por fora: aqui só se aprova (congela a base) e marca como paga. Não gera lançamento no Caixa.
 */
import { q } from '../db.js';
import { today } from '../lib/dates.js';
import { amountIn, appliesIn, fxTable, loadCosts, monthEnd } from './finance.js';
import { normSite } from './financeSources.js';
import { aggregate } from './metrics.js';

type Cur = 'BRL' | 'USD' | 'EUR';
/** arredondamento financeiro de 2 casas em cada valor */
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysIn = (m: string) => Number(monthEnd(m).slice(8, 10));

/* ---------------- resultado por site ---------------- */
/** revenue = receita líquida do dash · ads = Google + Meta + IVA do dash · otherExpenses = outros gastos do Caixa com o site
 *  · siteCosts = custos do site (aba Custos) · expenses = ads + otherExpenses · costs = expenses + siteCosts */
export interface SiteMonth { companyId: string; site: string; month: string; revenue: number; ads: number; otherExpenses: number; expenses: number; siteCosts: number; costs: number; result: number; roi: number | null }

/** Domínios (sites) de cada Empresa pelo Squad. */
export async function companyDomains(companyIds: string[]) {
  const rows = await q<{ id: string; hostname: string; company_id: string }>(`
    SELECT DISTINCT d.id::text, d.hostname, sq.company_id::text FROM domains d
      JOIN squad_domains sd ON sd.domain_id = d.id JOIN squads sq ON sq.id = sd.squad_id
     WHERE sq.company_id = ANY($1::bigint[]) AND NOT d.is_technical`, [companyIds]);
  return rows.map((r) => ({ ...r, site: normSite(r.hostname) })).filter((r): r is typeof r & { site: string } => !!r.site);
}

export async function siteResults(companyIds: string[], month: string): Promise<SiteMonth[]> {
  if (!companyIds.length) return [];
  const t = today();
  const rateDay = [monthEnd(month), t].sort()[0];
  const doms = await companyDomains(companyIds);
  const [entries, costs, conv, dash] = await Promise.all([
    q<{ company_id: string; site: string; amount: number; currency: Cur; date: string }>(`
      SELECT company_id::text, site, amount::float AS amount, currency, date::text FROM finance_cash_entries
       WHERE company_id = ANY($1::bigint[]) AND site IS NOT NULL AND kind = 'expense' AND category NOT IN ('google_ads', 'meta_ads')
         AND coalesce(competence, date_trunc('month', date)::date) = $2::date`, [companyIds, `${month}-01`]),
    loadCosts(companyIds),
    fxTable(`${month}-01`, t),
    // mês fechado inteiro (ou até hoje, no mês corrente), em R$: mesmos números da Home
    month > t.slice(0, 7) ? Promise.resolve(new Map()) :
      aggregate({ from: `${month}-01`, to: rateDay, domainIds: doms.map((d) => d.id), filter: null, groupBy: 'm.domain_id' }),
  ]);
  const map = new Map<string, SiteMonth>();
  const get = (c: string, s: string) => {
    let x = map.get(`${c}|${s}`);
    if (!x) { x = { companyId: c, site: s, month, revenue: 0, ads: 0, otherExpenses: 0, expenses: 0, siteCosts: 0, costs: 0, result: 0, roi: null }; map.set(`${c}|${s}`, x); }
    return x;
  };
  for (const d of doms) {
    const m = dash.get(d.id);
    const x = get(d.company_id, d.site);
    if (m) { x.revenue += m.revenueBrl; x.ads += m.spend; }   // receita em R$ pela cotação do ROI (travada no mês ou atual c/ deságio)
  }
  for (const e of entries) get(e.company_id, e.site).otherExpenses += conv(e.amount, e.currency, 'BRL', e.date);
  for (const c of costs) if (c.site && appliesIn(c, month)) get(c.company_id, c.site).siteCosts += conv(amountIn(c, month), c.currency, 'BRL', rateDay);
  for (const x of map.values()) {
    x.revenue = r2(x.revenue); x.ads = r2(x.ads); x.otherExpenses = r2(x.otherExpenses); x.siteCosts = r2(x.siteCosts);
    x.expenses = r2(x.ads + x.otherExpenses); x.costs = r2(x.expenses + x.siteCosts); x.result = r2(x.revenue - x.costs);
    x.roi = x.costs > 0 ? r2((x.result / x.costs) * 100) : null;
  }
  // site sem nenhum movimento no mês não vira card
  return [...map.values()].filter((x) => x.revenue || x.costs).sort((a, b) => b.result - a.result);
}

/* ---------------- regra e vínculos ---------------- */
export interface Tier { from: number; pct: number }
export interface Rule { id: string; name: string; tiers: Tier[]; tier_currency: Cur }
export async function loadRule(): Promise<Rule> {
  const r = await q<Rule>(`SELECT id::text, name, tiers, tier_currency FROM finance_commission_rules ORDER BY id LIMIT 1`);
  return r[0] ?? { id: '0', name: 'Meritocracia', tiers: [{ from: 0, pct: 10 }, { from: 20000, pct: 12 }, { from: 40000, pct: 15 }], tier_currency: 'USD' };
}
/** % da faixa atingida pelo lucro (na moeda das faixas). Sem lucro, sem comissão. */
export function tierFor(rule: Pick<Rule, 'tiers'>, profitInTierCur: number) {
  if (profitInTierCur <= 0) return null;
  const tiers = [...rule.tiers].sort((a, b) => a.from - b.from);
  return tiers.filter((x) => profitInTierCur >= x.from).pop() ?? tiers[0];
}
export interface Assignment { id: string; user_id: string; user_name: string; company_id: string; site: string; start_date: string; end_date: string | null; share_pct: number; note: string | null }
export async function loadAssignments(companyIds: string[], userId?: string) {
  return q<Assignment>(`SELECT a.id::text, a.user_id::text, u.name AS user_name, a.company_id::text, a.site, a.start_date::text, a.end_date::text, a.share_pct::float AS share_pct, a.note
      FROM finance_manager_assignments a JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ANY($1::bigint[]) ${userId ? 'AND a.user_id = $2' : ''} ORDER BY u.name, a.site, a.start_date`, userId ? [companyIds, userId] : [companyIds]);
}
/**
 * Vínculos que valem no mês: os manuais (Gestores e sites) e, para cada site da Empresa sem vínculo manual no mês,
 * o(s) gestor(es) do Squad do domínio (domain_managers + gestores do Squad), dividindo 100% entre eles.
 */
export async function effectiveAssignments(companyIds: string[], month: string, userId?: string): Promise<(Assignment & { auto: boolean })[]> {
  const [manual, squad] = await Promise.all([
    loadAssignments(companyIds),
    q<{ user_id: string; user_name: string; company_id: string; hostname: string }>(`
      SELECT DISTINCT x.user_id::text, u.name AS user_name, sq.company_id::text, d.hostname
        FROM (SELECT domain_id, user_id FROM domain_managers
              UNION SELECT sd.domain_id, su.user_id FROM squad_users su JOIN squad_domains sd ON sd.squad_id = su.squad_id) x
        JOIN users u ON u.id = x.user_id AND u.role = 'gestor' AND u.status <> 'disabled'
        JOIN domains d ON d.id = x.domain_id AND NOT d.is_technical
        JOIN squad_domains sd2 ON sd2.domain_id = d.id JOIN squads sq ON sq.id = sd2.squad_id
       WHERE sq.company_id = ANY($1::bigint[])`, [companyIds]),
  ]);
  const live = manual.filter((a) => coverage(a, month) > 0);
  const hasManual = new Set(live.map((a) => `${a.company_id}|${a.site}`));
  const bySite = new Map<string, typeof squad>();
  for (const r of squad) {
    const site = normSite(r.hostname);
    if (!site || hasManual.has(`${r.company_id}|${site}`)) continue;
    bySite.set(`${r.company_id}|${site}`, [...(bySite.get(`${r.company_id}|${site}`) ?? []), r]);
  }
  const auto = [...bySite.entries()].flatMap(([k, rs]) => rs.map((r) => ({
    id: `squad:${r.user_id}:${k}`, user_id: r.user_id, user_name: r.user_name, company_id: r.company_id, site: k.split('|')[1],
    start_date: `${month}-01`, end_date: null, share_pct: r2(100 / rs.length), note: 'Squad do domínio', auto: true,
  })));
  return [...live.map((a) => ({ ...a, auto: false })), ...auto].filter((a) => !userId || a.user_id === userId);
}

/** fração do mês em que o vínculo valia (não ganha sobre dias antes do início nem depois do fim) */
export function coverage(a: Pick<Assignment, 'start_date' | 'end_date'>, m: string) {
  const s = [a.start_date, `${m}-01`].sort()[1], e = [a.end_date ?? '9999-12-31', monthEnd(m)].sort()[0];
  if (s > e) return 0;
  const d = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return ((d(e) - d(s)) / 86400000 + 1) / daysIn(m);
}

/* ---------------- comissões ---------------- */
export type CommissionStatus = 'open' | 'to_approve' | 'approved' | 'paid';
export interface CommissionSite { site: string; sharePct: number; coverage: number; revenue: number; costs: number; result: number; base: number }
export interface CommissionLine {
  periodId: string | null; userId: string; userName: string; companyId: string; month: string;
  sites: CommissionSite[]; revenue: number; costs: number; profit: number; negatives: number; profitTier: number; tierCurrency: Cur;
  pct: number; calculated: number; adjustments: number; adjustmentNote: string | null; approved: number | null;
  status: CommissionStatus; frozen: boolean; liveDiff: number | null; incomplete: string[];
  approvedBy: string | null; approvedAt: string | null; paidAt: string | null; paidNote: string | null;
}
interface PeriodRow { id: string; user_id: string; company_id: string; base: CommissionLine; calculated: number; adjustments: number; adjustment_note: string | null; approved_amount: number; approved_by: string | null; approved_at: string; paid_at: string | null; paid_note: string | null }

export async function commissionsFor(companyIds: string[], month: string, opts: { userId?: string } = {}) {
  const t = today();
  const [res, rule, asg, periods, conv] = await Promise.all([
    siteResults(companyIds, month), loadRule(), effectiveAssignments(companyIds, month, opts.userId),
    q<PeriodRow>(`SELECT p.id::text, p.user_id::text, p.company_id::text, p.base, p.calculated::float AS calculated, p.adjustments::float AS adjustments, p.adjustment_note,
        p.approved_amount::float AS approved_amount, u.name AS approved_by, p.approved_at::text, p.paid_at::text, p.paid_note
        FROM finance_commission_periods p LEFT JOIN users u ON u.id = p.approved_by
       WHERE p.company_id = ANY($1::bigint[]) AND p.month = $2::date ${opts.userId ? 'AND p.user_id = $3' : ''}`, opts.userId ? [companyIds, `${month}-01`, opts.userId] : [companyIds, `${month}-01`]),
    fxTable(`${month}-01`, t),
  ]);
  const rateDay = [monthEnd(month), t].sort()[0];
  const groups = new Map<string, Assignment[]>();
  for (const a of asg) if (coverage(a, month) > 0) groups.set(`${a.user_id}|${a.company_id}`, [...(groups.get(`${a.user_id}|${a.company_id}`) ?? []), a]);
  for (const p of periods) if (!groups.has(`${p.user_id}|${p.company_id}`)) groups.set(`${p.user_id}|${p.company_id}`, []);
  const lines: CommissionLine[] = [];
  for (const [k, list] of groups) {
    const [userId, companyId] = k.split('|');
    const sites: CommissionSite[] = list.map((a) => {
      const r = res.find((x) => x.companyId === companyId && x.site === a.site);
      const cov = coverage(a, month), share = a.share_pct / 100;
      const result = r?.result ?? 0;
      return { site: a.site, sharePct: a.share_pct, coverage: r2(cov), revenue: r?.revenue ?? 0, costs: r?.costs ?? 0, result, base: r2(result * share * cov) };
    });
    const w = (f: (s: CommissionSite) => number) => r2(sites.reduce((a, s) => a + f(s) * (s.sharePct / 100) * s.coverage, 0));
    const profit = r2(sites.reduce((a, s) => a + s.base, 0));
    const profitTier = r2(conv(profit, 'BRL', rule.tier_currency, rateDay));
    const tier = tierFor(rule, profitTier);
    const pct = tier?.pct ?? 0;
    const calculated = r2(Math.max(0, profit) * pct / 100);
    const incomplete = sites.filter((s) => !res.some((x) => x.companyId === companyId && x.site === s.site && x.revenue > 0)).map((s) => `${s.site}: sem receita no dash para o mês`);
    const live: CommissionLine = {
      periodId: null, userId, userName: list[0]?.user_name ?? '', companyId, month, sites, revenue: w((s) => s.revenue), costs: w((s) => s.costs), profit,
      negatives: r2(sites.filter((s) => s.base < 0).reduce((a, s) => a + s.base, 0)), profitTier, tierCurrency: rule.tier_currency, pct, calculated,
      adjustments: 0, adjustmentNote: null, approved: null, status: month >= t.slice(0, 7) ? 'open' : 'to_approve', frozen: false, liveDiff: null, incomplete,
      approvedBy: null, approvedAt: null, paidAt: null, paidNote: null,
    };
    const per = periods.find((p) => p.user_id === userId && p.company_id === companyId);
    if (per) lines.push({
      ...per.base, periodId: per.id, userName: per.base.userName || live.userName, frozen: true, calculated: per.calculated, adjustments: per.adjustments, adjustmentNote: per.adjustment_note,
      approved: per.approved_amount, status: per.paid_at ? 'paid' : 'approved', approvedBy: per.approved_by, approvedAt: per.approved_at, paidAt: per.paid_at, paidNote: per.paid_note,
      liveDiff: list.length && Math.abs(live.calculated - per.calculated) >= 0.01 ? r2(live.calculated - per.calculated) : null,
    });
    else lines.push(live);
  }
  return { lines: lines.sort((a, b) => b.profit - a.profit), sites: res, rule };
}

export async function audit(userId: string | null, companyId: string | null, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, note?: string) {
  await q(`INSERT INTO finance_audit_logs (user_id, company_id, action, entity, entity_id, before, after, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, companyId, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), note ?? null]);
}
