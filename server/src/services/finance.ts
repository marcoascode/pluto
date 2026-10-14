/**
 * Finance (Caixa Empresa e Custos). Tudo é por Empresa (companies): domínios = os dos Squads da Empresa.
 *
 * Fechamento do mês (por Empresa):
 *   Receita (Ad Manager, já sem revShare) − Anúncios (Google + Meta + IVA) − Custos lançados = Resultado
 *   Receita e anúncios vêm de daily_metrics pela mesma agregação do resto do painel (aggregate), na moeda escolhida
 *   (BRL com deságio na receita). Custos são convertidos pela cotação do último dia do mês (ou de hoje, no mês atual).
 *
 * Caixa estimado (por Empresa):
 *   último saldo conferido ('balance', vale no fim daquele dia)
 *   + resultado (receita − anúncios) dos dias seguintes até hoje
 *   − custos com dia de pagamento depois do saldo conferido e até hoje
 *   + aportes − retiradas lançados depois dele
 *   Receita entra por competência (o Ad Manager paga depois), por isso o valor é "estimado".
 */
import { q } from '../db.js';
import { addDays, today } from '../lib/dates.js';
import { aggregate, type Currency } from './metrics.js';

export const CATEGORIES = ['tools', 'domains', 'hosting', 'team', 'taxes', 'services', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
type Cur = 'BRL' | 'USD' | 'EUR';

export interface CostRow {
  id: string; company_id: string; company_name: string; name: string; category: Category; amount: number; currency: Cur;
  recurrence: 'monthly' | 'once'; start_month: string; end_month: string | null; pay_day: number; notes: string | null;
}
export interface CashRow { id: string; company_id: string; date: string; kind: 'balance' | 'deposit' | 'withdrawal'; amount: number; currency: Cur; note: string | null; created_by_name: string | null }

const ym = (d: string) => d.slice(0, 7);
export const monthStart = (m: string) => `${m}-01`;
export function monthEnd(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
/** O custo vale no mês? */
export const appliesIn = (c: Pick<CostRow, 'recurrence' | 'start_month' | 'end_month'>, m: string) =>
  c.recurrence === 'once' ? ym(c.start_month) === m : ym(c.start_month) <= m && (!c.end_month || m <= ym(c.end_month));

/** Cotações (1 USD = x) por dia, com a última conhecida para trás. USD = 1. */
export async function fxTable(from: string, to: string) {
  const rows = await q<{ date: string; currency: Cur; rate: number }>(
    `SELECT date::text, currency, rate_per_usd::float AS rate FROM currency_rates WHERE date BETWEEN ($1::date - 15) AND $2::date ORDER BY date`, [from, to]);
  const latest = await q<{ currency: Cur; rate: number }>(`SELECT DISTINCT ON (currency) currency, rate_per_usd::float AS rate FROM currency_rates ORDER BY currency, date DESC`);
  const by: Record<string, { date: string; rate: number }[]> = { BRL: [], EUR: [] };
  for (const r of rows) by[r.currency]?.push({ date: r.date, rate: r.rate });
  const rateAt = (cur: Cur, date: string) => {
    if (cur === 'USD') return 1;
    const list = by[cur];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].date <= date) return list[i].rate;
    return latest.find((x) => x.currency === cur)?.rate ?? 1;
  };
  /** valor na moeda `src` no dia `date` → moeda `dst`. */
  return (amount: number, src: Cur, dst: Cur, date: string) => (src === dst ? amount : (amount / rateAt(src, date)) * rateAt(dst, date));
}

/** Domínios ativos de cada Empresa (pelos Squads). */
export async function companyDomains(companyIds: string[]) {
  const rows = await q<{ company_id: string; domain_id: string }>(
    `SELECT s.company_id::text, sd.domain_id::text FROM squads s JOIN squad_domains sd ON sd.squad_id = s.id JOIN domains d ON d.id = sd.domain_id
      WHERE s.company_id = ANY($1::bigint[]) AND d.active`, [companyIds]);
  const map = new Map<string, string[]>(companyIds.map((c) => [c, []]));
  for (const r of rows) map.get(r.company_id)!.push(r.domain_id);
  return map;
}

export async function loadCosts(companyIds: string[]) {
  return q<CostRow>(`
    SELECT c.id::text, c.company_id::text, co.name AS company_name, c.name, c.category, c.amount::float AS amount, c.currency, c.recurrence,
           c.start_month::text, c.end_month::text, c.pay_day, c.notes
      FROM finance_costs c JOIN companies co ON co.id = c.company_id
     WHERE c.company_id = ANY($1::bigint[]) ORDER BY co.name, c.category, c.name`, [companyIds]);
}

export interface MonthClose {
  month: string; partial: boolean; revenue: number; googleSpend: number; metaSpend: number; iva: number; adSpend: number;
  costs: number; costsByCategory: Partial<Record<Category, number>>; result: number; margin: number | null;
  companies: { companyId: string; revenue: number; adSpend: number; costs: number; result: number }[];
}

/** Fechamento mês a mês das Empresas pedidas (somadas), com a quebra por Empresa. */
export async function monthlyClose(companyIds: string[], months: string[], currency: Currency): Promise<MonthClose[]> {
  if (!months.length) return [];
  const t = today();
  const from = monthStart(months[0]);
  const to = [monthEnd(months[months.length - 1]), t].sort()[0];
  const doms = await companyDomains(companyIds);
  const domOwner = new Map<string, string>();
  for (const [c, ds] of doms) for (const d of ds) domOwner.set(d, c);
  const ids = [...domOwner.keys()];
  const [agg, costs, conv] = await Promise.all([
    from <= to && ids.length ? aggregate({ from, to, domainIds: ids, filter: null, currency, groupBy: `m.domain_id || '|' || to_char(m.date, 'YYYY-MM')` }) : Promise.resolve(new Map()),
    loadCosts(companyIds),
    fxTable(from, [monthEnd(months[months.length - 1]), t].sort()[0]),
  ]);
  return months.map((m) => {
    const rateDay = [monthEnd(m), t].sort()[0];
    const per = companyIds.map((cid) => {
      let revenue = 0, gs = 0, ms = 0, iva = 0, spend = 0;
      for (const d of doms.get(cid) ?? []) {
        const x = agg.get(`${d}|${m}`);
        if (!x) continue;
        revenue += x.revenue; gs += x.googleSpend; ms += x.metaSpend; iva += x.iva; spend += x.spend;
      }
      const byCat: Partial<Record<Category, number>> = {};
      let c = 0;
      for (const k of costs) {
        if (k.company_id !== cid || !appliesIn(k, m)) continue;
        const v = conv(k.amount, k.currency, currency, rateDay);
        c += v; byCat[k.category] = (byCat[k.category] ?? 0) + v;
      }
      return { companyId: cid, revenue, gs, ms, iva, spend, costs: c, byCat };
    });
    const sum = (f: (x: (typeof per)[number]) => number) => per.reduce((a, x) => a + f(x), 0);
    const revenue = sum((x) => x.revenue), adSpend = sum((x) => x.spend), cst = sum((x) => x.costs);
    const byCat: Partial<Record<Category, number>> = {};
    for (const x of per) for (const [k, v] of Object.entries(x.byCat)) byCat[k as Category] = (byCat[k as Category] ?? 0) + (v as number);
    const result = revenue - adSpend - cst;
    return {
      month: m, partial: m === ym(t), revenue, googleSpend: sum((x) => x.gs), metaSpend: sum((x) => x.ms), iva: sum((x) => x.iva), adSpend,
      costs: cst, costsByCategory: byCat, result, margin: revenue > 0 ? (result / revenue) * 100 : null,
      companies: per.map((x) => ({ companyId: x.companyId, revenue: x.revenue, adSpend: x.spend, costs: x.costs, result: x.revenue - x.spend - x.costs })),
    };
  });
}

export interface CashCompany {
  companyId: string; companyName: string;
  anchor: { date: string; amount: number } | null;   // saldo conferido (na moeda pedida)
  resultSince: number; costsSince: number; deposits: number; withdrawals: number;
  balance: number | null;                             // caixa estimado hoje (null sem saldo conferido)
  entries: { id: string; date: string; kind: CashRow['kind']; amount: number; currency: Cur; converted: number; note: string | null; createdBy: string | null }[];
}

/** Caixa estimado de cada Empresa. */
export async function cashPosition(companies: { id: string; name: string }[], currency: Currency): Promise<CashCompany[]> {
  const t = today();
  const ids = companies.map((c) => c.id);
  const [entries, costs, doms] = await Promise.all([
    q<CashRow>(`SELECT e.id::text, e.company_id::text, e.date::text, e.kind, e.amount::float AS amount, e.currency, e.note, u.name AS created_by_name
                  FROM finance_cash_entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.company_id = ANY($1::bigint[]) ORDER BY e.date, e.id`, [ids]),
    loadCosts(ids),
    companyDomains(ids),
  ]);
  const first = entries.length ? entries[0].date : t;
  const conv = await fxTable(first, t);
  const out: CashCompany[] = [];
  for (const co of companies) {
    const mine = entries.filter((e) => e.company_id === co.id);
    const anchorIdx = mine.map((e) => e.kind).lastIndexOf('balance');
    const anchor = anchorIdx >= 0 ? mine[anchorIdx] : null;
    const list = mine.slice().reverse().slice(0, 30).map((e) => ({ id: e.id, date: e.date, kind: e.kind, amount: e.amount, currency: e.currency, converted: conv(e.amount, e.currency, currency, e.date), note: e.note, createdBy: e.created_by_name }));
    if (!anchor) { out.push({ companyId: co.id, companyName: co.name, anchor: null, resultSince: 0, costsSince: 0, deposits: 0, withdrawals: 0, balance: null, entries: list }); continue; }
    const since = addDays(anchor.date, 1);
    let resultSince = 0;
    const ds = doms.get(co.id) ?? [];
    if (since <= t && ds.length) {
      const m = (await aggregate({ from: since, to: t, domainIds: ds, filter: null, currency })).get('');
      if (m) resultSince = m.revenue - m.spend;
    }
    // custos com dia de pagamento entre o saldo conferido (exclusive) e hoje
    let costsSince = 0;
    for (const k of costs.filter((x) => x.company_id === co.id)) {
      for (const m of monthsBetween(ym(since), ym(t))) {
        if (!appliesIn(k, m)) continue;
        const day = `${m}-${String(k.pay_day).padStart(2, '0')}`;
        if (day < since || day > t) continue;
        costsSince += conv(k.amount, k.currency, currency, day);
      }
    }
    const after = mine.slice(anchorIdx + 1);
    const deposits = after.filter((e) => e.kind === 'deposit').reduce((a, e) => a + conv(e.amount, e.currency, currency, e.date), 0);
    const withdrawals = after.filter((e) => e.kind === 'withdrawal').reduce((a, e) => a + conv(e.amount, e.currency, currency, e.date), 0);
    const base = conv(anchor.amount, anchor.currency, currency, anchor.date);
    out.push({
      companyId: co.id, companyName: co.name, anchor: { date: anchor.date, amount: base }, resultSince, costsSince, deposits, withdrawals,
      balance: base + resultSince - costsSince + deposits - withdrawals, entries: list,
    });
  }
  return out;
}
