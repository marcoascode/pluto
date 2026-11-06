/**
 * Finance (Caixa Empresa e Custos). Tudo é por Empresa (companies).
 *
 * O CAIXA É MANUAL (0.11): nada vem do sync das campanhas nem do Ad Manager. Quem cuida do financeiro lança:
 *   - receita recebida   (kind 'income')  — o dinheiro que caiu na conta: pagamento do Ad Manager/AdX, AdSense, outra
 *   - gasto              (kind 'expense') — o que foi pago: fatura do Google Ads, da Meta, outro gasto
 *   - aporte / retirada  (kind 'deposit' / 'withdrawal')
 *   - saldo conferido    (kind 'balance') — o saldo do banco no fim de um dia; o caixa conta a partir dele
 * Os CUSTOS da aba Custos (finance_costs) continuam entrando sozinhos: no fechamento, no mês em que valem;
 * no caixa, no dia do pagamento (pay_day).
 * Valor do custo num mês (0.12): o valor real lançado pela fatura/NF daquele mês (finance_cost_months) ou,
 * sem ele, o valor do plano vigente (finance_costs.amount ou a última mudança de plano em finance_cost_prices).
 *
 * Fechamento do mês = receitas recebidas − gastos − custos (pela data de cada lançamento).
 * Caixa hoje       = ponto de partida + receitas − gastos − custos fixos pagos + aportes − retiradas lançados depois dele.
 *   0.15: o ponto de partida é o último saldo conferido OU, sem saldo conferido, R$ 0 no 1º dia do mês do primeiro
 *   lançamento. O caixa anda sozinho a cada receita/gasto lançado, editado ou excluído; conferir o saldo só acerta a base.
 *   Custos fixos (aba Custos) entram no caixa no dia do pagamento de cada mês e aparecem como linhas no mês (costItems).
 * Conversão de moeda: lançamento pela cotação do dia dele; custo pela cotação do último dia do mês (ou de hoje).
 */
import { q } from '../db.js';
import { today } from '../lib/dates.js';

export const CATEGORIES = ['tools', 'domains', 'hosting', 'team', 'taxes', 'services', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
/** Origem da receita recebida e destino do gasto (lançamentos manuais do caixa). */
export const INCOME_CATEGORIES = ['adx', 'adsense', 'other_income'] as const;
export const EXPENSE_CATEGORIES = ['google_ads', 'meta_ads', 'other_expense'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type EntryKind = 'balance' | 'deposit' | 'withdrawal' | 'income' | 'expense';
export type EntryCategory = (typeof INCOME_CATEGORIES)[number] | ExpenseCategory;
type Cur = 'BRL' | 'USD' | 'EUR';

export interface CostRow {
  id: string; company_id: string; company_name: string; name: string; category: Category; amount: number; currency: Cur;
  recurrence: 'monthly' | 'once'; start_month: string; end_month: string | null; pay_day: number; notes: string | null; attachments: number;
  site: string | null;   // custo atribuído a um site (entra no resultado do site e na comissão)
  prices: { id: string; from: string; amount: number; note: string | null }[];          // mudanças de plano, em ordem
  actuals: Record<string, { amount: number; note: string | null }>;                      // valor real por mês (YYYY-MM)
}
export interface EntryRow {
  id: string; company_id: string; date: string; kind: EntryKind; category: EntryCategory | null; amount: number; currency: Cur; note: string | null; created_by_name: string | null; attachments: number;
  site: string | null;         // 0.14: de qual site é a receita/gasto
  competence: string | null;   // 0.14: mês de referência (YYYY-MM); vazio = mês da data
  gross_amount: number | null; revshare_pct: number | null;   // receita informada sem o revshare: bruto e % descontado (amount = líquido)
}

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

/** Valor do plano no mês (moeda do custo): o último plano que começou até o mês. */
export function plannedIn(c: Pick<CostRow, 'amount' | 'prices'>, m: string) {
  let v = c.amount;
  for (const p of c.prices) if (p.from <= m) v = p.amount;
  return v;
}
/** Valor que conta no mês (moeda do custo): o real lançado pela NF ou, sem ele, o do plano. */
export const amountIn = (c: Pick<CostRow, 'amount' | 'prices' | 'actuals'>, m: string) => c.actuals[m]?.amount ?? plannedIn(c, m);

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

export async function loadCosts(companyIds: string[]) {
  return q<CostRow>(`
    SELECT c.id::text, c.company_id::text, co.name AS company_name, c.name, c.category, c.amount::float AS amount, c.currency, c.recurrence,
           c.start_month::text, c.end_month::text, c.pay_day, c.notes, c.site,
           (SELECT count(*)::int FROM finance_attachments a WHERE a.cost_id = c.id) AS attachments,
           COALESCE((SELECT json_agg(json_build_object('id', p.id::text, 'from', to_char(p.from_month, 'YYYY-MM'), 'amount', p.amount::float, 'note', p.note) ORDER BY p.from_month)
                       FROM finance_cost_prices p WHERE p.cost_id = c.id), '[]'::json) AS prices,
           COALESCE((SELECT json_object_agg(to_char(m.month, 'YYYY-MM'), json_build_object('amount', m.amount::float, 'note', m.note))
                       FROM finance_cost_months m WHERE m.cost_id = c.id), '{}'::json) AS actuals
      FROM finance_costs c JOIN companies co ON co.id = c.company_id
     WHERE c.company_id = ANY($1::bigint[]) ORDER BY co.name, c.category, c.name`, [companyIds]);
}
export async function loadEntries(companyIds: string[]) {
  return q<EntryRow>(`
    SELECT e.id::text, e.company_id::text, e.date::text, e.kind, e.category, e.amount::float AS amount, e.currency, e.note, u.name AS created_by_name, e.site, to_char(e.competence, 'YYYY-MM') AS competence, e.gross_amount::float AS gross_amount, e.revshare_pct::float AS revshare_pct,
           (SELECT count(*)::int FROM finance_attachments a WHERE a.entry_id = e.id) AS attachments
      FROM finance_cash_entries e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.company_id = ANY($1::bigint[]) ORDER BY e.date, e.id`, [companyIds]);
}

export interface EntryOut { id: string; companyId: string; date: string; kind: EntryKind; category: EntryCategory | null; amount: number; currency: Cur; converted: number; note: string | null; createdBy: string | null; attachments: number; site: string | null; competence: string | null; grossAmount: number | null; revsharePct: number | null }
const entryOut = (e: EntryRow, converted: number): EntryOut => ({ id: e.id, companyId: e.company_id, date: e.date, kind: e.kind, category: e.category, amount: e.amount, currency: e.currency, converted, note: e.note, createdBy: e.created_by_name, attachments: e.attachments, site: e.site, competence: e.competence, grossAmount: e.gross_amount, revsharePct: e.revshare_pct });

export interface MonthClose {
  month: string; partial: boolean;
  income: number; incomeByCategory: Partial<Record<(typeof INCOME_CATEGORIES)[number], number>>;
  googleAds: number; metaAds: number; otherExpense: number; expenses: number;
  costs: number; costsByCategory: Partial<Record<Category, number>>;
  deposits: number; withdrawals: number;
  result: number;          // receitas − gastos − custos (aportes e retiradas não entram no resultado)
  margin: number | null;   // resultado ÷ receitas
  entries: EntryOut[];     // lançamentos do mês (mais recentes primeiro)
  costItems: CostItem[];   // 0.15: cada custo fixo do mês, como uma linha automática do caixa
  companies: { companyId: string; income: number; expenses: number; costs: number; result: number }[];
}

/** Custo fixo da aba Custos lançado sozinho no mês: valor real da NF (actual) ou do plano; payDate = dia do pagamento. */
export interface CostItem { costId: string; companyId: string; name: string; category: Category; site: string | null; payDate: string; amount: number; currency: Cur; converted: number; actual: boolean; paid: boolean }
function costItemsOf(costs: CostRow[], m: string, currency: Cur, conv: (a: number, s: Cur, d: Cur, date: string) => number, rateDay: string, t: string): CostItem[] {
  const last = monthEnd(m);
  return costs.filter((k) => appliesIn(k, m)).map((k) => {
    const d = `${m}-${String(Math.min(k.pay_day, Number(last.slice(8)))).padStart(2, '0')}`;
    const amount = amountIn(k, m);
    return { costId: k.id, companyId: k.company_id, name: k.name, category: k.category, site: k.site, payDate: d, amount, currency: k.currency,
      converted: conv(amount, k.currency, currency, rateDay), actual: k.actuals[m] != null, paid: d <= t };
  }).sort((a, b) => b.payDate.localeCompare(a.payDate) || a.name.localeCompare(b.name));
}

/** Fechamento mês a mês das Empresas pedidas (somadas), só com lançamentos manuais + custos. */
export async function monthlyClose(companyIds: string[], months: string[], currency: Cur): Promise<MonthClose[]> {
  if (!months.length) return [];
  const t = today();
  const last = [monthEnd(months[months.length - 1]), t].sort()[0];
  const [entries, costs, conv] = await Promise.all([loadEntries(companyIds), loadCosts(companyIds), fxTable(monthStart(months[0]), last)]);
  return months.map((m) => {
    const rateDay = [monthEnd(m), t].sort()[0];
    const inMonth = entries.filter((e) => ym(e.date) === m);
    const v = (e: EntryRow) => conv(e.amount, e.currency, currency, e.date);
    const per = companyIds.map((cid) => {
      const es = inMonth.filter((e) => e.company_id === cid);
      const income = es.filter((e) => e.kind === 'income').reduce((a, e) => a + v(e), 0);
      const expenses = es.filter((e) => e.kind === 'expense').reduce((a, e) => a + v(e), 0);
      let c = 0;
      for (const k of costs) if (k.company_id === cid && appliesIn(k, m)) c += conv(amountIn(k, m), k.currency, currency, rateDay);
      return { companyId: cid, income, expenses, costs: c, result: income - expenses - c };
    });
    const sumKind = (kind: EntryKind, cat?: EntryCategory) => inMonth.filter((e) => e.kind === kind && (!cat || e.category === cat)).reduce((a, e) => a + v(e), 0);
    const incomeByCategory: MonthClose['incomeByCategory'] = {};
    for (const c of INCOME_CATEGORIES) { const x = sumKind('income', c); if (x) incomeByCategory[c] = x; }
    const costsByCategory: MonthClose['costsByCategory'] = {};
    for (const k of costs) if (appliesIn(k, m)) costsByCategory[k.category] = (costsByCategory[k.category] ?? 0) + conv(amountIn(k, m), k.currency, currency, rateDay);
    const income = per.reduce((a, x) => a + x.income, 0), expenses = per.reduce((a, x) => a + x.expenses, 0), cst = per.reduce((a, x) => a + x.costs, 0);
    const result = income - expenses - cst;
    return {
      month: m, partial: m === ym(t), income, incomeByCategory,
      googleAds: sumKind('expense', 'google_ads'), metaAds: sumKind('expense', 'meta_ads'), otherExpense: sumKind('expense', 'other_expense'), expenses,
      costs: cst, costsByCategory, deposits: sumKind('deposit'), withdrawals: sumKind('withdrawal'),
      result, margin: income > 0 ? (result / income) * 100 : null,
      entries: inMonth.slice().reverse().map((e) => entryOut(e, v(e))),
      costItems: costItemsOf(costs, m, currency, conv, rateDay, t),
      companies: per,
    };
  });
}

export interface CashCompany {
  companyId: string; companyName: string;
  anchor: { date: string; amount: number } | null;   // saldo conferido (na moeda pedida); null = começa do zero
  since: string;                                      // 0.15: de quando o caixa conta (dia do saldo conferido ou 1º dia do mês do 1º lançamento)
  income: number; expenses: number; costsSince: number; deposits: number; withdrawals: number;   // depois do ponto de partida
  balance: number;                                    // caixa hoje (sempre: sem saldo conferido, parte de 0)
  entries: EntryOut[];                                // últimos 50 lançamentos
}

/** Caixa de hoje de cada Empresa (só lançamentos manuais + custos da aba Custos). */
export async function cashPosition(companies: { id: string; name: string }[], currency: Cur): Promise<CashCompany[]> {
  const t = today();
  const ids = companies.map((c) => c.id);
  const [entries, costs] = await Promise.all([loadEntries(ids), loadCosts(ids)]);
  const conv = await fxTable(entries.length ? entries[0].date : t, t);
  const v = (e: EntryRow) => conv(e.amount, e.currency, currency, e.date);
  return companies.map((co) => {
    const mine = entries.filter((e) => e.company_id === co.id);
    const list = mine.slice().reverse().slice(0, 50).map((e) => entryOut(e, v(e)));
    const ai = mine.map((e) => e.kind).lastIndexOf('balance');
    const anchor = ai >= 0 ? mine[ai] : null;
    // sem saldo conferido: começa do zero no 1º dia do mês do primeiro lançamento (ou do mês atual)
    const since = anchor ? anchor.date : `${ym(mine[0]?.date ?? t)}-01`;
    // lançados depois do saldo conferido (mesmo dia e lançado antes dele = já estava no saldo)
    const after = anchor ? mine.slice(ai + 1) : mine;
    const sum = (k: EntryKind) => after.filter((e) => e.kind === k).reduce((a, e) => a + v(e), 0);
    // custos da aba Custos com dia de pagamento depois do ponto de partida e até hoje
    let costsSince = 0;
    for (const k of costs.filter((x) => x.company_id === co.id)) {
      for (const m of monthsBetween(ym(since), ym(t))) {
        if (!appliesIn(k, m)) continue;
        const day = `${m}-${String(Math.min(k.pay_day, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`;
        if ((anchor ? day <= since : day < since) || day > t) continue;
        costsSince += conv(amountIn(k, m), k.currency, currency, day);
      }
    }
    const base = anchor ? v(anchor) : 0;
    const income = sum('income'), expenses = sum('expense'), deposits = sum('deposit'), withdrawals = sum('withdrawal');
    return {
      companyId: co.id, companyName: co.name, anchor: anchor ? { date: anchor.date, amount: base } : null, since, income, expenses, costsSince, deposits, withdrawals,
      balance: base + income - expenses - costsSince + deposits - withdrawals, entries: list,
    };
  });
}
