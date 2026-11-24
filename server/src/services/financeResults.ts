/**
 * Finance 0.18.8 · resultado por site e comissão dos gestores.
 *
 * Gestor do site = vínculo de Usuários & Squads (gestor → domínio → contas Google/Meta). É o ÚNICO vínculo usado.
 * ROI do gestor no site (R$) = receita líquida do site no mês (Ad Manager sem revShare × cotação do ROI do mês, a mesma
 *   da Home; dividida igualmente quando o site tem mais de um gestor) − despesas (Google + Meta + IVA) SÓ das campanhas
 *   das contas que o gestor usa naquele site.
 * ROI total do gestor (por Empresa e mês) = soma do ROI dos sites dele (site negativo desconta).
 * Comissão = % × ROI total (sem ROI positivo, sem comissão), com a % pela modalidade do cadastro do gestor:
 *   progressiva → faixa atingida pelo ROI total (faixas do painel de Comissões, padrão em US$: até 19.999,99 = 10% ·
 *                 20.000 a 39.999,99 = 12% · a partir de 40.000 = 15%; a faixa vale para o ROI todo)
 *   fixa        → a % do cadastro do gestor.
 *   O ROI em US$ usa a mesma cotação do ROI do mês (receita R$ ÷ receita US$).
 * A comissão é paga por fora: aqui só se aprova (congela a base) e marca como paga. Não gera lançamento no Caixa.
 */
import { q } from '../db.js';
import { today } from '../lib/dates.js';
import { fxTable, monthEnd } from './finance.js';
import { normSite } from './financeSources.js';
import { aggregate } from './metrics.js';

type Cur = 'BRL' | 'USD' | 'EUR';
export type CommissionMode = 'progressive' | 'fixed';
/** arredondamento financeiro de 2 casas em cada valor */
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Domínios (sites) de cada Empresa pelo Squad. */
export async function companyDomains(companyIds: string[]) {
  const rows = await q<{ id: string; hostname: string; company_id: string }>(`
    SELECT DISTINCT d.id::text, d.hostname, sq.company_id::text FROM domains d
      JOIN squad_domains sd ON sd.domain_id = d.id JOIN squads sq ON sq.id = sd.squad_id
     WHERE sq.company_id = ANY($1::bigint[]) AND NOT d.is_technical`, [companyIds]);
  return rows.map((r) => ({ ...r, site: normSite(r.hostname) })).filter((r): r is typeof r & { site: string } => !!r.site);
}

/* ---------------- regra progressiva ---------------- */
export interface Tier { from: number; pct: number }
export interface Rule { id: string; name: string; tiers: Tier[]; tier_currency: Cur }
export async function loadRule(): Promise<Rule> {
  const r = await q<Rule>(`SELECT id::text, name, tiers, tier_currency FROM finance_commission_rules ORDER BY id LIMIT 1`);
  return r[0] ?? { id: '0', name: 'Progressiva', tiers: [{ from: 0, pct: 10 }, { from: 20000, pct: 12 }, { from: 40000, pct: 15 }], tier_currency: 'USD' };
}
/** % da faixa atingida pelo ROI (na moeda das faixas). Sem ROI positivo, sem comissão. */
export function tierFor(rule: Pick<Rule, 'tiers'>, profitInTierCur: number) {
  if (profitInTierCur <= 0) return null;
  const tiers = [...rule.tiers].sort((a, b) => a.from - b.from);
  return tiers.filter((x) => profitInTierCur >= x.from).pop() ?? tiers[0];
}

/* ---------------- ROI por gestor × site ---------------- */
interface Manager { userId: string; userName: string; mode: CommissionMode; fixedPct: number | null }
/** Gestor no site: receita (parte dele) − despesas das contas dele naquele site. */
export interface SiteManager { userId: string; userName: string; sharePct: number; revenue: number; ads: number; result: number }
/** Card do site: receita líquida (R$), despesas das contas vinculadas aos gestores, ROI e gestores. */
export interface SiteMonth {
  companyId: string; site: string; month: string; revenue: number; revenueUsd: number; ads: number; result: number; roi: number | null;
  /** despesa total do site no mês (todas as contas), para comparar com a das contas vinculadas */
  allAds: number; managers: SiteManager[];
}

async function siteManagers(companyIds: string[], month: string) {
  const t = today();
  const to = [monthEnd(month), t].sort()[0];
  const doms = await companyDomains(companyIds);
  const ids = doms.map((d) => d.id);
  if (!ids.length || month > t.slice(0, 7)) return { doms, mgrs: [] as (Manager & { domainId: string })[], dash: new Map(), linked: new Map(), to };
  const [mgrs, dash, linked] = await Promise.all([
    q<Manager & { domainId: string }>(`
      SELECT dm.domain_id::text AS "domainId", u.id::text AS "userId", u.name AS "userName", u.commission_mode AS mode, u.commission_pct::float AS "fixedPct"
        FROM domain_managers dm JOIN users u ON u.id = dm.user_id AND u.role = 'gestor' AND u.status <> 'disabled'
       WHERE dm.domain_id = ANY($1::bigint[]) ORDER BY u.name`, [ids]),
    // mês fechado inteiro (ou até hoje, no mês corrente): mesmos números da Home
    aggregate({ from: `${month}-01`, to, domainIds: ids, filter: null, groupBy: 'm.domain_id' }),
    // despesas só das campanhas das contas que cada gestor usa no site (vínculo de Usuários & Squads)
    aggregate({
      from: `${month}-01`, to, domainIds: ids, filter: null, groupBy: `dmx.user_id::text || '|' || m.domain_id::text`,
      joins: `JOIN campaigns lc ON lc.id = m.campaign_id
              JOIN domain_manager_accounts dmx ON dmx.domain_id = m.domain_id AND dmx.account_id = lc.account_id`,
    }),
  ]);
  return { doms, mgrs, dash, linked, to };
}

export async function siteResults(companyIds: string[], month: string): Promise<{ sites: SiteMonth[]; managers: Map<string, Manager>; to: string; usdRate: number | null }> {
  if (!companyIds.length) return { sites: [], managers: new Map(), to: monthEnd(month), usdRate: null };
  const { doms, mgrs, dash, linked, to } = await siteManagers(companyIds, month);
  const managers = new Map<string, Manager>();
  for (const m of mgrs) managers.set(m.userId, { userId: m.userId, userName: m.userName, mode: m.mode, fixedPct: m.fixedPct });
  let revBrl = 0, revUsd = 0;
  const sites: SiteMonth[] = [];
  for (const d of doms) {
    const m = dash.get(d.id);
    const revenue = m?.revenueBrl ?? 0, revenueUsd = m?.revenue ?? 0, allAds = m?.spend ?? 0;
    revBrl += revenue; revUsd += revenueUsd;
    const own = mgrs.filter((x) => x.domainId === d.id);
    const share = own.length ? 1 / own.length : 0;
    const sm: SiteManager[] = own.map((x) => {
      const ads = linked.get(`${x.userId}|${d.id}`)?.spend ?? 0;
      return { userId: x.userId, userName: x.userName, sharePct: r2(share * 100), revenue: r2(revenue * share), ads: r2(ads), result: r2(revenue * share - ads) };
    });
    const ads = own.length ? sm.reduce((a, x) => a + x.ads, 0) : allAds;
    const result = revenue - ads;
    if (!revenue && !ads && !allAds) continue;   // site sem nenhum movimento no mês não vira card
    sites.push({ companyId: d.company_id, site: d.site, month, revenue: r2(revenue), revenueUsd: r2(revenueUsd), ads: r2(ads), result: r2(result), roi: ads > 0 ? r2((result / ads) * 100) : null, allAds: r2(allAds), managers: sm });
  }
  return { sites: sites.sort((a, b) => b.result - a.result), managers, to, usdRate: revUsd > 0 ? revBrl / revUsd : null };
}

/* ---------------- comissões ---------------- */
export type CommissionStatus = 'open' | 'to_approve' | 'approved' | 'paid';
export interface CommissionSite { site: string; sharePct: number; revenue: number; ads: number; result: number }
export interface CommissionLine {
  periodId: string | null; userId: string; userName: string; companyId: string; month: string;
  mode: CommissionMode; fixedPct: number | null;
  sites: CommissionSite[]; revenue: number; ads: number; profit: number; profitUsd: number; negatives: number; profitTier: number; tierCurrency: Cur;
  pct: number; calculated: number; calculatedUsd: number; adjustments: number; adjustmentNote: string | null; approved: number | null;
  status: CommissionStatus; frozen: boolean; liveDiff: number | null; incomplete: string[];
  approvedBy: string | null; approvedAt: string | null; paidAt: string | null; paidNote: string | null;
}
interface PeriodRow { id: string; user_id: string; company_id: string; base: Partial<CommissionLine>; calculated: number; adjustments: number; adjustment_note: string | null; approved_amount: number; approved_by: string | null; approved_at: string; paid_at: string | null; paid_note: string | null }

export async function commissionsFor(companyIds: string[], month: string, opts: { userId?: string } = {}) {
  const t = today();
  const [res, rule, periods, conv] = await Promise.all([
    siteResults(companyIds, month), loadRule(),
    q<PeriodRow>(`SELECT p.id::text, p.user_id::text, p.company_id::text, p.base, p.calculated::float AS calculated, p.adjustments::float AS adjustments, p.adjustment_note,
        p.approved_amount::float AS approved_amount, u.name AS approved_by, p.approved_at::text, p.paid_at::text, p.paid_note
        FROM finance_commission_periods p LEFT JOIN users u ON u.id = p.approved_by
       WHERE p.company_id = ANY($1::bigint[]) AND p.month = $2::date ${opts.userId ? 'AND p.user_id = $3' : ''}`, opts.userId ? [companyIds, `${month}-01`, opts.userId] : [companyIds, `${month}-01`]),
    fxTable(`${month}-01`, t),
  ]);
  const rateDay = res.to;
  // R$ → US$ pela cotação do ROI do mês (a mesma que converteu a receita); sem receita no mês, câmbio do fim do mês
  const toUsd = (brl: number) => (res.usdRate ? brl / res.usdRate : conv(brl, 'BRL', 'USD', rateDay));
  const inTier = (brl: number) => (rule.tier_currency === 'BRL' ? brl : rule.tier_currency === 'USD' ? toUsd(brl) : conv(brl, 'BRL', rule.tier_currency, rateDay));
  const groups = new Map<string, CommissionSite[]>();
  for (const s of res.sites) for (const m of s.managers) {
    if (opts.userId && m.userId !== opts.userId) continue;
    const k = `${m.userId}|${s.companyId}`;
    groups.set(k, [...(groups.get(k) ?? []), { site: s.site, sharePct: m.sharePct, revenue: m.revenue, ads: m.ads, result: m.result }]);
  }
  for (const p of periods) if (!groups.has(`${p.user_id}|${p.company_id}`)) groups.set(`${p.user_id}|${p.company_id}`, []);
  const lines: CommissionLine[] = [];
  for (const [k, sites] of groups) {
    const [userId, companyId] = k.split('|');
    const mgr = res.managers.get(userId);
    const mode: CommissionMode = mgr?.mode ?? 'progressive';
    const profit = r2(sites.reduce((a, s) => a + s.result, 0));
    const profitUsd = r2(toUsd(profit));
    const profitTier = r2(inTier(profit));
    const pct = mode === 'fixed' ? (profit > 0 ? mgr?.fixedPct ?? 0 : 0) : tierFor(rule, profitTier)?.pct ?? 0;
    const calculated = r2(Math.max(0, profit) * pct / 100);
    const incomplete = sites.filter((s) => !(s.revenue > 0)).map((s) => `${s.site}: sem receita no dash para o mês`);
    const live: CommissionLine = {
      periodId: null, userId, userName: mgr?.userName ?? '', companyId, month, mode, fixedPct: mgr?.fixedPct ?? null, sites,
      revenue: r2(sites.reduce((a, s) => a + s.revenue, 0)), ads: r2(sites.reduce((a, s) => a + s.ads, 0)), profit, profitUsd,
      negatives: r2(sites.filter((s) => s.result < 0).reduce((a, s) => a + s.result, 0)), profitTier, tierCurrency: rule.tier_currency, pct, calculated, calculatedUsd: r2(toUsd(calculated)),
      adjustments: 0, adjustmentNote: null, approved: null, status: month >= t.slice(0, 7) ? 'open' : 'to_approve', frozen: false, liveDiff: null, incomplete,
      approvedBy: null, approvedAt: null, paidAt: null, paidNote: null,
    };
    const per = periods.find((p) => p.user_id === userId && p.company_id === companyId);
    if (per) {
      // base congelada na aprovação (aprovações antigas, de antes da 0.18.8, não têm alguns campos)
      const b = per.base;
      lines.push({
        ...live, ...b, sites: (b.sites ?? []).map((s) => ({ site: s.site, sharePct: s.sharePct ?? 100, revenue: s.revenue ?? 0, ads: s.ads ?? 0, result: s.result ?? 0 })),
        mode: b.mode ?? 'progressive', fixedPct: b.fixedPct ?? null, ads: b.ads ?? 0, profitUsd: b.profitUsd ?? 0, calculatedUsd: b.calculatedUsd ?? 0,
        periodId: per.id, userName: b.userName || live.userName, frozen: true, calculated: per.calculated, adjustments: per.adjustments, adjustmentNote: per.adjustment_note,
        approved: per.approved_amount, status: per.paid_at ? 'paid' : 'approved', approvedBy: per.approved_by, approvedAt: per.approved_at, paidAt: per.paid_at, paidNote: per.paid_note,
        liveDiff: sites.length && Math.abs(live.calculated - per.calculated) >= 0.01 ? r2(live.calculated - per.calculated) : null,
      });
    } else lines.push(live);
  }
  return { lines: lines.sort((a, b) => b.profit - a.profit), sites: res.sites, rule };
}

export async function audit(userId: string | null, companyId: string | null, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, note?: string) {
  await q(`INSERT INTO finance_audit_logs (user_id, company_id, action, entity, entity_id, before, after, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, companyId, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), note ?? null]);
}
