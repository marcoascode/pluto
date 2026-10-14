/** Finance no modo demo: custos e lançamentos de exemplo + as mesmas contas do servidor (services/finance.ts). */
import type * as T from '@/types/api';
import { ApiError } from '@/lib/api/client';
import { addDays } from '@/lib/period';
import { agg, COMPANIES, DATES, DAYS, FX, ROWS, SQUADS, TODAY, type Row } from './db';

const NOW = TODAY.slice(0, 7);
const shift = (ym: string, n: number) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const between = (a: string, b: string) => { const o: string[] = []; for (let m = a; m <= b; m = shift(m, 1)) o.push(m); return o; };
const coName = (id: string) => COMPANIES.find((c) => c.id === id)?.name ?? id;

let seq = 100;
export const FIN_COSTS: T.FinanceCost[] = [
  { id: 'k1', companyId: 'c1', companyName: '', name: 'Hospedagem VPS + CDN', category: 'hosting', amount: 180, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -10), endMonth: null, payDay: 5, notes: null },
  { id: 'k2', companyId: 'c1', companyName: '', name: 'Ferramenta de IA (textos)', category: 'tools', amount: 20, currency: 'USD', recurrence: 'monthly', startMonth: shift(NOW, -6), endMonth: null, payDay: 10, notes: 'cartão final 4821' },
  { id: 'k3', companyId: 'c1', companyName: '', name: 'Editor de conteúdo', category: 'team', amount: 2500, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -3), endMonth: null, payDay: 5, notes: 'PJ' },
  { id: 'k4', companyId: 'c1', companyName: '', name: 'Contabilidade', category: 'taxes', amount: 450, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -10), endMonth: null, payDay: 15, notes: null },
  { id: 'k5', companyId: 'c1', companyName: '', name: 'Renovação de domínios', category: 'domains', amount: 89.9, currency: 'BRL', recurrence: 'once', startMonth: NOW, endMonth: null, payDay: 2, notes: 'dominioX.com e dominioY.com' },
  { id: 'k6', companyId: 'c2', companyName: '', name: 'Hospedagem compartilhada', category: 'hosting', amount: 120, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -8), endMonth: null, payDay: 8, notes: null },
  { id: 'k7', companyId: 'c2', companyName: '', name: 'Ferramenta de SEO', category: 'tools', amount: 99, currency: 'USD', recurrence: 'monthly', startMonth: shift(NOW, -5), endMonth: null, payDay: 12, notes: null },
  { id: 'k8', companyId: 'c2', companyName: '', name: 'Freela design (banners)', category: 'services', amount: 800, currency: 'BRL', recurrence: 'once', startMonth: shift(NOW, -1), endMonth: null, payDay: 20, notes: null },
];
export const FIN_CASH: (Omit<T.CashEntry, 'converted'> & { companyId: string })[] = [
  { id: 'e1', companyId: 'c1', date: addDays(TODAY, -6), kind: 'balance', amount: 286500, currency: 'BRL', note: 'extrato do banco', createdBy: 'Lucas Hirsch' },
  { id: 'e2', companyId: 'c1', date: addDays(TODAY, -2), kind: 'withdrawal', amount: 40000, currency: 'BRL', note: 'distribuição de lucro', createdBy: 'Lucas Hirsch' },
  { id: 'e3', companyId: 'c2', date: addDays(TODAY, -9), kind: 'balance', amount: 131200, currency: 'BRL', note: 'extrato do banco', createdBy: 'Sócio B' },
];

const di = (iso: string) => Math.max(0, Math.min(DAYS - 1, Math.round((Date.parse(TODAY) - Date.parse(iso)) / 864e5)));
const conv = (amount: number, src: T.Currency, dst: T.Currency, date: string) => (src === dst ? amount : (amount / (FX[src][di(date)] ?? 1)) * (FX[dst][di(date)] ?? 1));
const applies = (c: T.FinanceCost, m: string) => (c.recurrence === 'once' ? c.startMonth === m : c.startMonth <= m && (!c.endMonth || m <= c.endMonth));
const doms = (cid: string) => new Set(SQUADS.filter((s) => COMPANIES.find((c) => c.id === cid)?.squadIds.includes(s.id)).flatMap((s) => s.domains));
const rowsOf = (cid: string, pred: (r: Row) => boolean) => { const d = doms(cid); return ROWS.filter((r) => d.has(r.domain) && pred(r)); };

export function financeCompanies(u: T.User) {
  const adm = u.role === 'admin' || u.role === 'superadmin';
  const list = COMPANIES.filter((c) => adm || c.partnerIds.includes(u.id)).map((c) => ({ id: c.id, name: c.name }));
  if (!adm && !list.length) throw new ApiError(403, 'forbidden_finance', 'O Finance é só para Admin e sócios das Empresas.');
  return list;
}
function sel(u: T.User, company: unknown) {
  const all = financeCompanies(u);
  if (company) { const hit = all.find((c) => c.id === company); if (!hit) throw new ApiError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.'); return { all, sel: [hit] }; }
  return { all, sel: all };
}

export function financeOverview(u: T.User, q: Record<string, unknown>): T.FinanceOverview {
  const cur = (q.currency as T.Currency) || 'BRL';
  const { all, sel: cos } = sel(u, q.company);
  const from = (q.from as string) || shift(NOW, -1), to = (q.to as string) || NOW;
  const months = between(from, to).map((m) => {
    const rate = [monthEnd(m), TODAY].sort()[0];
    const per = cos.map((c) => {
      const met = agg(rowsOf(c.id, (r) => DATES[r.di]?.slice(0, 7) === m), cur);
      const byCat: Partial<Record<T.CostCategory, number>> = {}; let costs = 0;
      for (const k of FIN_COSTS) if (k.companyId === c.id && applies(k, m)) { const v = conv(k.amount, k.currency, cur, rate); costs += v; byCat[k.category] = (byCat[k.category] ?? 0) + v; }
      return { c, met, costs, byCat };
    });
    const s = (f: (x: (typeof per)[number]) => number) => per.reduce((a, x) => a + f(x), 0);
    const revenue = s((x) => x.met.revenue), adSpend = s((x) => x.met.spend), costs = s((x) => x.costs);
    const byCat: Partial<Record<T.CostCategory, number>> = {};
    for (const x of per) for (const [k, v] of Object.entries(x.byCat)) byCat[k as T.CostCategory] = (byCat[k as T.CostCategory] ?? 0) + (v as number);
    const result = revenue - adSpend - costs;
    return { month: m, partial: m === NOW, revenue, googleSpend: s((x) => x.met.googleSpend), metaSpend: s((x) => x.met.metaSpend), iva: s((x) => x.met.iva), adSpend, costs, costsByCategory: byCat, result,
      margin: revenue > 0 ? (result / revenue) * 100 : null, companies: per.map((x) => ({ companyId: x.c.id, revenue: x.met.revenue, adSpend: x.met.spend, costs: x.costs, result: x.met.revenue - x.met.spend - x.costs })) };
  });
  const cash: T.CashCompany[] = cos.map((c) => {
    const mine = FIN_CASH.filter((e) => e.companyId === c.id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const entries = mine.slice().reverse().map((e) => ({ ...e, converted: conv(e.amount, e.currency, cur, e.date) }));
    const ai = mine.map((e) => e.kind).lastIndexOf('balance');
    if (ai < 0) return { companyId: c.id, companyName: c.name, anchor: null, resultSince: 0, costsSince: 0, deposits: 0, withdrawals: 0, balance: null, entries };
    const a = mine[ai]; const since = addDays(a.date, 1);
    const m = agg(rowsOf(c.id, (r) => DATES[r.di] >= since), cur);
    let costsSince = 0;
    for (const k of FIN_COSTS) if (k.companyId === c.id) for (const mm of between(since.slice(0, 7), NOW)) {
      if (!applies(k, mm)) continue; const day = `${mm}-${String(k.payDay).padStart(2, '0')}`; if (day >= since && day <= TODAY) costsSince += conv(k.amount, k.currency, cur, day);
    }
    const after = mine.slice(ai + 1);
    const dep = after.filter((e) => e.kind === 'deposit').reduce((s, e) => s + conv(e.amount, e.currency, cur, e.date), 0);
    const wd = after.filter((e) => e.kind === 'withdrawal').reduce((s, e) => s + conv(e.amount, e.currency, cur, e.date), 0);
    const base = conv(a.amount, a.currency, cur, a.date);
    return { companyId: c.id, companyName: c.name, anchor: { date: a.date, amount: base }, resultSince: m.revenue - m.spend, costsSince, deposits: dep, withdrawals: wd, balance: base + m.revenue - m.spend - costsSince + dep - wd, entries };
  });
  const sum = (k: 'revenue' | 'googleSpend' | 'metaSpend' | 'iva' | 'adSpend' | 'costs' | 'result') => months.reduce((a, m) => a + m[k], 0);
  const totals = { revenue: sum('revenue'), googleSpend: sum('googleSpend'), metaSpend: sum('metaSpend'), iva: sum('iva'), adSpend: sum('adSpend'), costs: sum('costs'), result: sum('result') };
  const adm = u.role === 'admin' || u.role === 'superadmin';
  let outside: T.FinanceOverview['outside'] = null;
  if (adm && !q.company) {
    const inCo = new Set(COMPANIES.flatMap((c) => [...doms(c.id)]));
    const o = agg(ROWS.filter((r) => !inCo.has(r.domain) && (DATES[r.di] ?? '') >= `${from}-01` && (DATES[r.di] ?? '') <= monthEnd(to)), cur);
    if (o.revenue || o.spend) outside = { revenue: o.revenue, adSpend: o.spend };
  }
  return { currency: cur, from, to, companies: all, selected: (q.company as string) || null, cash: { total: cash.some((c) => c.balance != null) ? cash.reduce((a, c) => a + (c.balance ?? 0), 0) : null, companies: cash },
    months, totals: { ...totals, margin: totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : null }, outside };
}

export function financeCosts(u: T.User, q: Record<string, unknown>): T.FinanceCostsResponse {
  const cur = (q.currency as T.Currency) || 'BRL';
  const { all, sel: cos } = sel(u, q.company);
  const month = (q.month as string) || NOW; const day = [monthEnd(month), TODAY].sort()[0];
  const ids = new Set(cos.map((c) => c.id));
  const costs = FIN_COSTS.filter((c) => ids.has(c.companyId)).map((c) => { const ap = applies(c, month); return { ...c, companyName: coName(c.companyId), appliesInMonth: ap, monthAmount: ap ? conv(c.amount, c.currency, cur, day) : 0 }; });
  const byCategory: Partial<Record<T.CostCategory, number>> = {};
  for (const c of costs) if (c.appliesInMonth) byCategory[c.category] = (byCategory[c.category] ?? 0) + c.monthAmount;
  return { currency: cur, month, companies: all, costs, totals: { month: costs.reduce((a, c) => a + c.monthAmount, 0), recurring: costs.filter((c) => c.appliesInMonth && c.recurrence === 'monthly').reduce((a, c) => a + c.monthAmount, 0), once: costs.filter((c) => c.appliesInMonth && c.recurrence === 'once').reduce((a, c) => a + c.monthAmount, 0), byCategory } };
}

const own = (u: T.User, cid: string) => { if (!financeCompanies(u).some((c) => c.id === cid)) throw new ApiError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.'); };
export function financeMutate(u: T.User, method: string, path: string, b: Record<string, any>): unknown {
  let m = path.match(/^\/finance\/costs(?:\/([^/]+))?$/);
  if (m) {
    const id = m[1];
    if (method === 'DELETE') { const i = FIN_COSTS.findIndex((c) => c.id === id); if (i < 0) throw new ApiError(404, 'not_found', 'Custo não encontrado.'); own(u, FIN_COSTS[i].companyId); FIN_COSTS.splice(i, 1); return undefined; }
    own(u, b.companyId);
    if (!(Number(b.amount) > 0) || String(b.name ?? '').trim().length < 2) throw new ApiError(422, 'invalid_input', 'Confira nome e valor.');
    const row: T.FinanceCost = { id: id ?? 'k' + ++seq, companyId: b.companyId, companyName: coName(b.companyId), name: String(b.name).trim(), category: b.category, amount: Number(b.amount), currency: b.currency, recurrence: b.recurrence, startMonth: b.startMonth, endMonth: b.recurrence === 'once' ? null : b.endMonth ?? null, payDay: Number(b.payDay) || 1, notes: b.notes ?? null };
    if (id) { const i = FIN_COSTS.findIndex((c) => c.id === id); if (i < 0) throw new ApiError(404, 'not_found', 'Custo não encontrado.'); FIN_COSTS[i] = row; } else FIN_COSTS.push(row);
    return row;
  }
  m = path.match(/^\/finance\/cash(?:\/([^/]+))?$/);
  if (m) {
    if (method === 'DELETE') { const i = FIN_CASH.findIndex((e) => e.id === m![1]); if (i < 0) throw new ApiError(404, 'not_found', 'Lançamento não encontrado.'); own(u, FIN_CASH[i].companyId); FIN_CASH.splice(i, 1); return undefined; }
    own(u, b.companyId);
    if (b.date > TODAY) throw new ApiError(422, 'future_date', 'A data não pode ser depois de hoje.');
    const id = 'e' + ++seq; FIN_CASH.push({ id, companyId: b.companyId, date: b.date, kind: b.kind, amount: Number(b.amount), currency: b.currency, note: b.note ?? null, createdBy: u.name });
    return { id };
  }
  throw new ApiError(404, 'not_found', 'Rota de Finance desconhecida.');
}
