/**
 * Finance 0.18.8 · resultado por site e comissão dos gestores.
 *
 * Gestor do site = vínculos de Usuários & Squads: gestor → domínio → contas Google/Meta, com o Rateio do domínio
 *   (Admin → Domínios) e, por cima, os períodos de "Gestores e sites" (datas e rateio, na edição do gestor).
 * ROI do gestor no site (R$) = receita líquida do site (Ad Manager sem revShare × cotação do ROI do mês, a mesma da Home)
 *   × % dele em cada dia − despesas (Google + Meta + IVA) SÓ das campanhas das contas que ele usa naquele site.
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

/* ---------------- períodos "Gestores e sites" (edição do gestor em Usuários & Squads) ---------------- */
export interface Assignment { id: string; user_id: string; user_name: string; company_id: string; site: string; start_date: string; end_date: string | null; share_pct: number; note: string | null }
export async function loadAssignments(companyIds: string[], userId?: string) {
  return q<Assignment>(`SELECT a.id::text, a.user_id::text, u.name AS user_name, a.company_id::text, a.site, a.start_date::text, a.end_date::text, a.share_pct::float AS share_pct, a.note
      FROM finance_manager_assignments a JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ANY($1::bigint[]) ${userId ? 'AND a.user_id = $2' : ''} ORDER BY u.name, a.site, a.start_date`, userId ? [companyIds, userId] : [companyIds]);
}
/** Dias do mês até `to` (YYYY-MM-DD). */
function daysOf(month: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${month}-01T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to || iso.slice(0, 7) !== month) break;
    out.push(iso);
  }
  return out;
}

/* ---------------- ROI por gestor × site ---------------- */
interface Manager { userId: string; userName: string; mode: CommissionMode; fixedPct: number | null }
/** Gestor no site: receita (parte dele) − despesas das contas dele no site.
 *  source: 'rateio' = rateio do domínio (ou divisão igual) · 'periodo' = período de "Gestores e sites" · 'misto' = os dois no mês */
export interface SiteManager { userId: string; userName: string; sharePct: number; revenue: number; ads: number; result: number; source: 'rateio' | 'periodo' | 'misto'; days: number }
/** Card do site: receita líquida (R$), despesas das contas vinculadas aos gestores, ROI e gestores. */
export interface SiteMonth {
  companyId: string; site: string; month: string; revenue: number; revenueUsd: number; ads: number; result: number; roi: number | null;
  /** despesa total do site no mês (todas as contas), para comparar com a das contas vinculadas */
  allAds: number; managers: SiteManager[];
  /** rateio do domínio inválido (gestores sem % ou soma ≠ 100): receita dividida igualmente */
  equalSplit: boolean;
}

/**
 * Receita do site em cada dia vai para:
 *   - os gestores dos períodos de "Gestores e sites" que cobrem o dia (× % do período), se houver algum;
 *   - senão, os gestores do domínio em Usuários & Squads (× % do Rateio do domínio; sem rateio válido, partes iguais).
 * Despesas de cada gestor = só as campanhas das contas que ele usa no site, nos dias em que ele responde pelo site.
 */
export async function siteResults(companyIds: string[], month: string): Promise<{ sites: SiteMonth[]; managers: Map<string, Manager>; to: string; usdRate: number | null }> {
  const t = today();
  const to = [monthEnd(month), t].sort()[0];
  const empty = { sites: [] as SiteMonth[], managers: new Map<string, Manager>(), to, usdRate: null };
  if (!companyIds.length || month > t.slice(0, 7)) return empty;
  const doms = await companyDomains(companyIds);
  const ids = doms.map((d) => d.id);
  if (!ids.length) return empty;
  const [mgrs, manualAll, dash, linked] = await Promise.all([
    q<{ domainId: string; userId: string; share: number | null }>(`
      SELECT dm.domain_id::text AS "domainId", dm.user_id::text AS "userId", dm.share_pct::float AS share
        FROM domain_managers dm JOIN users u ON u.id = dm.user_id AND u.role = 'gestor' AND u.status <> 'disabled'
       WHERE dm.domain_id = ANY($1::bigint[])`, [ids]),
    loadAssignments(companyIds),
    // por dia: mesmos números da Home
    aggregate({ from: `${month}-01`, to, domainIds: ids, filter: null, groupBy: `m.domain_id::text || '|' || m.date::text` }),
    // despesas só das campanhas das contas que cada gestor usa no site (vínculo de Usuários & Squads)
    aggregate({
      from: `${month}-01`, to, domainIds: ids, filter: null, groupBy: `dmx.user_id::text || '|' || m.domain_id::text || '|' || m.date::text`,
      joins: `JOIN campaigns lc ON lc.id = m.campaign_id
              JOIN domain_manager_accounts dmx ON dmx.domain_id = m.domain_id AND dmx.account_id = lc.account_id`,
    }),
  ]);
  const manual = manualAll.filter((a) => a.start_date <= to && (a.end_date ?? '9999-12-31') >= `${month}-01`);
  const userIds = [...new Set([...mgrs.map((m) => m.userId), ...manual.map((a) => a.user_id)])];
  const managers = new Map<string, Manager>();
  if (userIds.length) for (const u of await q<Manager>(`SELECT id::text AS "userId", name AS "userName", commission_mode AS mode, commission_pct::float AS "fixedPct" FROM users WHERE id = ANY($1::bigint[])`, [userIds])) managers.set(u.userId, u);
  const days = daysOf(month, to);
  let revBrl = 0, revUsd = 0;
  const sites: SiteMonth[] = [];
  for (const d of doms) {
    const own = mgrs.filter((x) => x.domainId === d.id);
    const valid = own.length > 0 && own.every((x) => x.share != null) && Math.abs(own.reduce((a, x) => a + (x.share ?? 0), 0) - 100) < 0.001;
    const rateio = own.map((x) => ({ userId: x.userId, pct: valid ? x.share! : 100 / own.length }));
    const here = manual.filter((a) => a.company_id === d.company_id && a.site === d.site);
    const acc = new Map<string, { revenue: number; ads: number; pcts: Set<number>; src: Set<'rateio' | 'periodo'>; days: number }>();
    let revenue = 0, revenueUsd = 0, allAds = 0;
    for (const day of days) {
      const m = dash.get(`${d.id}|${day}`);
      const r = m?.revenueBrl ?? 0;
      revenue += r; revenueUsd += m?.revenue ?? 0; allAds += m?.spend ?? 0;
      const per = here.filter((a) => a.start_date <= day && (a.end_date ?? '9999-12-31') >= day);
      const who = per.length ? per.map((a) => ({ userId: a.user_id, pct: a.share_pct, src: 'periodo' as const })) : rateio.map((x) => ({ ...x, src: 'rateio' as const }));
      for (const w of who) {
        const x = acc.get(w.userId) ?? { revenue: 0, ads: 0, pcts: new Set<number>(), src: new Set<'rateio' | 'periodo'>(), days: 0 };
        x.revenue += r * w.pct / 100;
        x.ads += linked.get(`${w.userId}|${d.id}|${day}`)?.spend ?? 0;
        x.pcts.add(Math.round(w.pct * 1000) / 1000); x.src.add(w.src); x.days++;
        acc.set(w.userId, x);
      }
    }
    revBrl += revenue; revUsd += revenueUsd;
    const sm: SiteManager[] = [...acc.entries()].map(([userId, x]): SiteManager => ({
      userId, userName: managers.get(userId)?.userName ?? '', sharePct: r2(x.pcts.size === 1 ? [...x.pcts][0] : [...x.pcts].reduce((a, b) => a + b, 0) / x.pcts.size),
      revenue: r2(x.revenue), ads: r2(x.ads), result: r2(x.revenue - x.ads), source: x.src.size > 1 ? 'misto' : [...x.src][0], days: x.days,
    })).sort((a, b) => b.result - a.result);
    const ads = sm.length ? sm.reduce((a, x) => a + x.ads, 0) : allAds;
    if (!revenue && !ads && !allAds) continue;   // site sem nenhum movimento no mês não vira card
    sites.push({ companyId: d.company_id, site: d.site, month, revenue: r2(revenue), revenueUsd: r2(revenueUsd), ads: r2(ads), result: r2(revenue - ads),
      roi: ads > 0 ? r2(((revenue - ads) / ads) * 100) : null, allAds: r2(allAds), managers: sm, equalSplit: own.length > 1 && !valid });
  }
  return { sites: sites.sort((a, b) => b.result - a.result), managers, to, usdRate: revUsd > 0 ? revBrl / revUsd : null };
}

/* ---------------- comissões ---------------- */
export type CommissionStatus = 'open' | 'to_approve' | 'approved' | 'paid';
export interface CommissionSite { site: string; sharePct: number; revenue: number; ads: number; result: number; source?: SiteManager['source']; days?: number }
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
    groups.set(k, [...(groups.get(k) ?? []), { site: s.site, sharePct: m.sharePct, revenue: m.revenue, ads: m.ads, result: m.result, source: m.source, days: m.days }]);
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
