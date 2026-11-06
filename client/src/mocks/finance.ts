/**
 * Finance no modo demo: custos e lançamentos de exemplo + as mesmas contas do servidor (services/finance.ts).
 * Caixa 100% manual (0.11): receitas recebidas e gastos pagos lançados à mão; custos da aba Custos entram sozinhos.
 * Custos (0.12): mudança de plano a partir de um mês e valor real de cada mês pela fatura/NF.
 */
import type * as T from '@/types/api';
import { ApiError } from '@/lib/api/client';
import type { Attachment, CashEntry, CashMonth, CashOverview, CostItem, CostPrice, EntryCategory, EntryKind } from '@/lib/finance';
import { COMPANIES, DAYS, FX, TODAY } from './db';
import { financeOpsMock, isOpsPath } from './financeOps';

const NOW = TODAY.slice(0, 7);
const shift = (ym: string, n: number) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const between = (a: string, b: string) => { const o: string[] = []; for (let m = a; m <= b; m = shift(m, 1)) o.push(m); return o; };
const coName = (id: string) => COMPANIES.find((c) => c.id === id)?.name ?? id;

let seq = 100;
/** custo pode ser atribuído a um site (0.13): entra no resultado do site e na comissão */
export type MockCost = T.FinanceCost & { site?: string | null };
export const FIN_COSTS: MockCost[] = [
  { id: 'k1', companyId: 'c1', companyName: '', name: 'Hospedagem VPS + CDN', category: 'hosting', amount: 180, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -10), endMonth: null, payDay: 5, notes: null },
  { id: 'k2', companyId: 'c1', companyName: '', name: 'Ferramenta de IA (textos)', category: 'tools', amount: 20, currency: 'USD', recurrence: 'monthly', startMonth: shift(NOW, -6), endMonth: null, payDay: 10, notes: 'cartão final 4821', site: 'dominiox.com' },
  { id: 'k3', companyId: 'c1', companyName: '', name: 'Editor de conteúdo', category: 'team', amount: 2500, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -3), endMonth: null, payDay: 5, notes: 'PJ' },
  { id: 'k4', companyId: 'c1', companyName: '', name: 'Contabilidade', category: 'taxes', amount: 450, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -10), endMonth: null, payDay: 15, notes: null },
  { id: 'k5', companyId: 'c1', companyName: '', name: 'Renovação de domínios', category: 'domains', amount: 89.9, currency: 'BRL', recurrence: 'once', startMonth: NOW, endMonth: null, payDay: 2, notes: 'dominioX.com e dominioY.com' },
  { id: 'k6', companyId: 'c2', companyName: '', name: 'Hospedagem compartilhada', category: 'hosting', amount: 120, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -8), endMonth: null, payDay: 8, notes: null },
  { id: 'k7', companyId: 'c2', companyName: '', name: 'Ferramenta de SEO', category: 'tools', amount: 69, currency: 'USD', recurrence: 'monthly', startMonth: shift(NOW, -5), endMonth: null, payDay: 12, notes: null },
  { id: 'k9', companyId: 'c1', companyName: '', name: 'Google Workspace', category: 'tools', amount: 112, currency: 'BRL', recurrence: 'monthly', startMonth: shift(NOW, -6), endMonth: null, payDay: 1, notes: '4 logins × R$ 28' },
  { id: 'k8', companyId: 'c2', companyName: '', name: 'Freela design (banners)', category: 'services', amount: 800, currency: 'BRL', recurrence: 'once', startMonth: shift(NOW, -1), endMonth: null, payDay: 20, notes: null },
];
/** mudanças de plano e valor real por mês (fatura/NF) */
export const FIN_PRICES: Record<string, CostPrice[]> = {
  k7: [{ id: 'p1', from: shift(NOW, -1), amount: 99, note: 'upgrade para o plano Pro' }],
};
export const FIN_ACTUALS: Record<string, Record<string, { amount: number; note: string | null }>> = {
  k1: { [shift(NOW, -2)]: { amount: 180, note: null }, [shift(NOW, -1)]: { amount: 180, note: null } },
  k4: { [shift(NOW, -1)]: { amount: 450, note: null } },
  k7: { [shift(NOW, -2)]: { amount: 69, note: null }, [shift(NOW, -1)]: { amount: 84.5, note: 'proporcional: 69 até o upgrade + parte do Pro' } },
  k9: { [shift(NOW, -2)]: { amount: 112, note: null }, [shift(NOW, -1)]: { amount: 107, note: '1 login removido no meio do mês' } },
};
const plannedIn = (c: T.FinanceCost, m: string) => { let v = c.amount; for (const p of FIN_PRICES[c.id] ?? []) if (p.from <= m) v = p.amount; return v; };
const amountIn = (c: T.FinanceCost, m: string) => FIN_ACTUALS[c.id]?.[m]?.amount ?? plannedIn(c, m);
export type Entry = Omit<CashEntry, 'converted' | 'attachments'>;
const E = (id: string, companyId: string, date: string, kind: EntryKind, amount: number, category: EntryCategory | null = null, note: string | null = null, currency: T.Currency = 'BRL', createdBy = 'Lucas Hirsch'): Entry =>
  ({ id, companyId, date, kind, category, amount, currency, note, createdBy });
const P = shift(NOW, -1), PP = shift(NOW, -2);
const day = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`;
const upToToday = (x: Entry) => x.date <= TODAY;
export const FIN_CASH: Entry[] = [
  // Empresa A
  E('e1', 'c1', day(PP, 28), 'balance', 152300, null, 'extrato do banco'),
  E('e5', 'c1', day(P, 23), 'income', 3180, 'adsense', 'AdSense (sem site)'),
  E('e6', 'c1', day(P, 28), 'withdrawal', 20000, null, 'distribuição de lucro'),
  // Empresa B
  // Empresa B sem saldo conferido: o caixa parte de R$ 0 no mês do primeiro lançamento (0.15)
].filter(upToToday);

/* Receitas e gastos POR SITE (0.14): o AdX de um mês cai no começo do mês seguinte (referente ao mês anterior);
   Google/Meta são pagos no próprio mês. É daqui que a aba Comissões tira o resultado de cada site. */
export const FIN_SITES: { companyId: string; site: string; income: number; google: number; meta: number; from: number }[] = [
  { companyId: 'c1', site: 'dominiox.com', income: 158000, google: 39000, meta: 6000, from: -4 },
  { companyId: 'c1', site: 'dominiot.com', income: 9500, google: 17800, meta: 0, from: -4 },
  { companyId: 'c1', site: 'dominioy.com', income: 306000, google: 104000, meta: 0, from: -4 },
  { companyId: 'c1', site: 'dominiov.com', income: 17200, google: 24500, meta: 0, from: -4 },
  { companyId: 'c2', site: 'dominioz.com', income: 52500, google: 30500, meta: 0, from: -4 },
  { companyId: 'c2', site: 'dominiow.com', income: 61000, google: 0, meta: 38000, from: -1 },
];
{
  const grow = [0.82, 0.88, 0.94, 1];
  [-4, -3, -2, -1].forEach((k, i) => {
    const m = shift(NOW, k);
    for (const x of FIN_SITES) {
      if (k < x.from) continue;
      const g = grow[i] * (1 + ((x.site.length + i * 3) % 5 - 2) / 100);
      const r = (v: number) => Math.round(v * g);
      const by = x.companyId === 'c1' ? 'Lucas Hirsch' : 'Sócio B';
      if (x.google) FIN_CASH.push({ ...E('s' + ++seq, x.companyId, day(m, 5 + (seq % 3)), 'expense', r(x.google), 'google_ads', 'fatura Google Ads', 'BRL', by), site: x.site, competence: null });
      if (x.meta) FIN_CASH.push({ ...E('s' + ++seq, x.companyId, day(m, 9), 'expense', r(x.meta), 'meta_ads', 'fatura Meta', 'BRL', by), site: x.site, competence: null });
      const pay = day(shift(m, 1), 2 + (seq % 2));
      if (pay <= TODAY) FIN_CASH.push({ ...E('s' + ++seq, x.companyId, pay, 'income', r(x.income), 'adx', `pagamento AdX ${m.slice(5)}/${m.slice(0, 4)}`, 'BRL', by), site: x.site, competence: m });
    }
  });
  for (const x of FIN_SITES) if (x.google) FIN_CASH.push({ ...E('s' + ++seq, x.companyId, day(NOW, 1), 'expense', Math.round(x.google * 0.08), 'google_ads', 'Google Ads (parcial)', 'BRL'), site: x.site, competence: null });
  FIN_CASH.push({ ...E('s' + ++seq, 'c1', day(P, 14), 'expense', 350, 'other_expense', 'banner pago'), site: 'dominiox.com', competence: null });
}

const di = (iso: string) => Math.max(0, Math.min(DAYS - 1, Math.round((Date.parse(TODAY) - Date.parse(iso)) / 864e5)));
const conv = (amount: number, src: T.Currency, dst: T.Currency, date: string) => (src === dst ? amount : (amount / (FX[src][di(date)] ?? 1)) * (FX[dst][di(date)] ?? 1));
/** usado pelo mock das Comissões (mocks/financeOps.ts) */
export const finMock = { conv: (a: number, s: T.Currency, d: T.Currency, date: string) => conv(a, s, d, date), shift: (m: string, n: number) => shift(m, n), monthEnd: (m: string) => monthEnd(m), amountIn: (c: T.FinanceCost, m: string) => amountIn(c, m), applies: (c: T.FinanceCost, m: string) => applies(c, m), NOW: () => NOW, seq: () => ++seq };
const applies = (c: T.FinanceCost, m: string) => (c.recurrence === 'once' ? c.startMonth === m : c.startMonth <= m && (!c.endMonth || m <= c.endMonth));

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

/** Mesmo cálculo de services/finance.ts: fechamento e caixa só com lançamentos manuais + custos. */
export function financeOverview(u: T.User, q: Record<string, unknown>): T.FinanceOverview {
  const cur = (q.currency as T.Currency) || 'BRL';
  const { all, sel: cos } = sel(u, q.company);
  const from = (q.from as string) || shift(NOW, -1), to = (q.to as string) || NOW;
  const ids = new Set(cos.map((c) => c.id));
  const entries = FIN_CASH.filter((e) => ids.has(e.companyId)).sort((a, b) => a.date.localeCompare(b.date) || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const v = (e: Entry) => conv(e.amount, e.currency, cur, e.date);
  const out = (e: Entry): CashEntry => ({ ...e, converted: v(e), attachments: FIN_ATT.filter((a) => a.entryId === e.id).length });
  const months: CashMonth[] = between(from, to).map((m) => {
    const rate = [monthEnd(m), TODAY].sort()[0];
    const es = entries.filter((e) => e.date.slice(0, 7) === m);
    const sum = (k: EntryKind, cat?: EntryCategory, cid?: string) => es.filter((e) => e.kind === k && (!cat || e.category === cat) && (!cid || e.companyId === cid)).reduce((a, e) => a + v(e), 0);
    const costsOf = (cid?: string) => FIN_COSTS.filter((k) => ids.has(k.companyId) && (!cid || k.companyId === cid) && applies(k, m)).reduce((a, k) => a + conv(amountIn(k, m), k.currency, cur, rate), 0);
    const byCat: CashMonth['costsByCategory'] = {};
    for (const k of FIN_COSTS) if (ids.has(k.companyId) && applies(k, m)) byCat[k.category] = (byCat[k.category] ?? 0) + conv(amountIn(k, m), k.currency, cur, rate);
    const incByCat: CashMonth['incomeByCategory'] = {};
    for (const c of ['adx', 'adsense', 'other_income'] as const) { const x = sum('income', c); if (x) incByCat[c] = x; }
    const income = sum('income'), expenses = sum('expense'), costs = costsOf(), result = income - expenses - costs;
    return { month: m, partial: m === NOW, income, incomeByCategory: incByCat, googleAds: sum('expense', 'google_ads'), metaAds: sum('expense', 'meta_ads'), otherExpense: sum('expense', 'other_expense'),
      expenses, costs, costsByCategory: byCat, deposits: sum('deposit'), withdrawals: sum('withdrawal'), result, margin: income > 0 ? (result / income) * 100 : null,
      entries: es.slice().reverse().map(out),
      costItems: FIN_COSTS.filter((k) => ids.has(k.companyId) && applies(k, m)).map((k): CostItem => {
        const d = `${m}-${String(Math.min(k.payDay, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`;
        return { costId: k.id, companyId: k.companyId, name: k.name, category: k.category, site: (k as MockCost).site ?? null, payDate: d, amount: amountIn(k, m), currency: k.currency,
          converted: conv(amountIn(k, m), k.currency, cur, rate), actual: FIN_ACTUALS[k.id]?.[m] != null, paid: d <= TODAY };
      }).sort((a, b) => b.payDate.localeCompare(a.payDate)),
      companies: cos.map((c) => { const i = sum('income', undefined, c.id), x = sum('expense', undefined, c.id), k = costsOf(c.id); return { companyId: c.id, income: i, expenses: x, costs: k, result: i - x - k }; }) };
  });
  const cash = cos.map((c) => {
    const mine = entries.filter((e) => e.companyId === c.id);
    const list = mine.slice().reverse().slice(0, 50).map(out);
    // 0.15: sem saldo conferido o caixa parte de 0 no 1º dia do mês do primeiro lançamento
    const ai = mine.map((e) => e.kind).lastIndexOf('balance');
    const a = ai >= 0 ? mine[ai] : null; const after = a ? mine.slice(ai + 1) : mine;
    const since = a ? a.date : `${(mine[0]?.date ?? TODAY).slice(0, 7)}-01`;
    const s2 = (k: EntryKind) => after.filter((e) => e.kind === k).reduce((acc, e) => acc + v(e), 0);
    let costsSince = 0;
    for (const k of FIN_COSTS) if (k.companyId === c.id) for (const mm of between(since.slice(0, 7), NOW)) {
      if (!applies(k, mm)) continue; const d = `${mm}-${String(Math.min(k.payDay, Number(monthEnd(mm).slice(8)))).padStart(2, '0')}`; if ((a ? d > since : d >= since) && d <= TODAY) costsSince += conv(amountIn(k, mm), k.currency, cur, d);
    }
    const base = a ? v(a) : 0, income = s2('income'), expenses = s2('expense'), deposits = s2('deposit'), withdrawals = s2('withdrawal');
    return { companyId: c.id, companyName: c.name, anchor: a ? { date: a.date, amount: base } : null, since, income, expenses, costsSince, deposits, withdrawals, balance: base + income - expenses - costsSince + deposits - withdrawals, entries: list };
  });
  type K = 'income' | 'googleAds' | 'metaAds' | 'otherExpense' | 'expenses' | 'costs' | 'deposits' | 'withdrawals' | 'result';
  const tot = (k: K) => months.reduce((a, m) => a + m[k], 0);
  const totals = { income: tot('income'), googleAds: tot('googleAds'), metaAds: tot('metaAds'), otherExpense: tot('otherExpense'), expenses: tot('expenses'), costs: tot('costs'), deposits: tot('deposits'), withdrawals: tot('withdrawals'), result: tot('result') };
  const res: CashOverview = { currency: cur, from, to, companies: all, selected: (q.company as string) || null,
    cash: { total: cash.reduce((a, c) => a + c.balance, 0), companies: cash },
    months, totals: { ...totals, margin: totals.income > 0 ? (totals.result / totals.income) * 100 : null } };
  // o handler genérico ainda tipa a resposta com o formato antigo; a tela usa CashOverview (lib/finance.ts)
  return res as unknown as T.FinanceOverview;
}

export function financeCosts(u: T.User, q: Record<string, unknown>): T.FinanceCostsResponse {
  const cur = (q.currency as T.Currency) || 'BRL';
  const { all, sel: cos } = sel(u, q.company);
  const month = (q.month as string) || NOW; const day = [monthEnd(month), TODAY].sort()[0];
  const ids = new Set(cos.map((c) => c.id));
  const costs = FIN_COSTS.filter((c) => ids.has(c.companyId)).map((c) => { const ap = applies(c, month); return { ...c, companyName: coName(c.companyId), attachments: FIN_ATT.filter((a) => a.costId === c.id && (!a.month || a.month === month)).length, appliesInMonth: ap,
    prices: FIN_PRICES[c.id] ?? [], plannedAmount: plannedIn(c, month), planChangedFrom: (FIN_PRICES[c.id] ?? []).some((p) => p.from === month) ? plannedIn(c, shift(month, -1)) : null,
    actualAmount: FIN_ACTUALS[c.id]?.[month]?.amount ?? null, actualNote: FIN_ACTUALS[c.id]?.[month]?.note ?? null,
    monthAmount: ap ? conv(amountIn(c, month), c.currency, cur, day) : 0 }; });
  const byCategory: Partial<Record<T.CostCategory, number>> = {};
  for (const c of costs) if (c.appliesInMonth) byCategory[c.category] = (byCategory[c.category] ?? 0) + c.monthAmount;
  return { currency: cur, month, companies: all, costs, totals: { month: costs.reduce((a, c) => a + c.monthAmount, 0), recurring: costs.filter((c) => c.appliesInMonth && c.recurrence === 'monthly').reduce((a, c) => a + c.monthAmount, 0), once: costs.filter((c) => c.appliesInMonth && c.recurrence === 'once').reduce((a, c) => a + c.monthAmount, 0), byCategory } };
}

const own = (u: T.User, cid: string) => { if (!financeCompanies(u).some((c) => c.id === cid)) throw new ApiError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.'); };
/* comprovantes de exemplo (links do Drive fictícios; arquivos enviados no demo ficam só no navegador) */
const att = (id: string, t: { entryId?: string; costId?: string }, amount: number, docNumber: string, month: string | null, currency: T.Currency = 'BRL'): Attachment =>
  ({ id, kind: 'link', url: `https://drive.google.com/file/d/exemplo-${id}/view`, filename: null, mime: null, size: null, amount, currency, docNumber, docDate: null, month, note: null,
    entryId: t.entryId ?? null, costId: t.costId ?? null, createdBy: 'Lucas Hirsch', createdAt: new Date().toISOString() });
export const FIN_ATT: Attachment[] = [
  att('a1', { entryId: 'e2' }, 4800, '2025/88123', null, 'USD'),
  att('a2', { entryId: 'e3' }, 9600, '00451', null),
  att('a3', { costId: 'k1' }, 180, '1203', NOW),
  att('a4', { costId: 'k4' }, 450, '311', shift(NOW, -1)),
  att('a5', { costId: 'k3' }, 2400, 'RPA 77', NOW),
  att('a6', { costId: 'k9' }, 107, 'NF 58812', shift(NOW, -1)),
  att('a7', { costId: 'k7' }, 84.5, 'INV-2291', shift(NOW, -1), 'USD'),
  att('a8', { costId: 'k1' }, 180, '1188', shift(NOW, -1)),
];

export function financeMutate(u: T.User, method: string, path: string, b: Record<string, any>): unknown {
  // 0.13: Receitas AdX, gasto Ads, Comissões, Conciliação, Fechamento
  if (isOpsPath(path)) return financeOpsMock(u, method, path, b);
  // comprovantes
  if (path.startsWith('/finance/attachments')) {
    const ownerCo = (t: { entryId?: string; costId?: string }) => (t.entryId ? FIN_CASH.find((e) => e.id === t.entryId)?.companyId : FIN_COSTS.find((c) => c.id === t.costId)?.companyId);
    const mm = path.match(/^\/finance\/attachments\/([^/]+)$/);
    if (mm && method === 'DELETE') { const i = FIN_ATT.findIndex((a) => a.id === mm[1]); if (i < 0) throw new ApiError(404, 'not_found', 'Comprovante não encontrado.'); const co = ownerCo(FIN_ATT[i] as never); if (co) own(u, co); FIN_ATT.splice(i, 1); return undefined; }
    return mockAttachments(u, path === '/finance/attachments/list' ? 'GET' : method, path, b, ownerCo);
  }

  // valor real do mês e mudança de plano
  let m = path.match(/^\/finance\/costs\/([^/]+)\/(months|prices)(?:\/([^/]+))?$/);
  if (m) {
    const c = FIN_COSTS.find((x) => x.id === m![1]); if (!c) throw new ApiError(404, 'not_found', 'Custo não encontrado.'); own(u, c.companyId);
    if (m[2] === 'months') {
      const mo = m[3]!;
      if (method === 'DELETE') { delete FIN_ACTUALS[c.id]?.[mo]; return undefined; }
      if (!applies(c, mo)) throw new ApiError(422, 'month_out_of_range', 'Este custo não vale neste mês.');
      if (mo > NOW) throw new ApiError(422, 'future_month', 'Só dá para lançar o valor real de meses que já começaram.');
      if (!(Number(b.amount) >= 0)) throw new ApiError(422, 'invalid_input', 'Informe o valor.');
      (FIN_ACTUALS[c.id] ??= {})[mo] = { amount: Number(b.amount), note: b.note || null };
      return { costId: c.id, month: mo, amount: Number(b.amount), note: b.note || null };
    }
    const list = (FIN_PRICES[c.id] ??= []);
    if (method === 'DELETE') { const i = list.findIndex((p) => p.id === m![3]); if (i < 0) throw new ApiError(404, 'not_found', 'Mudança de plano não encontrada.'); list.splice(i, 1); return undefined; }
    if (c.recurrence !== 'monthly') throw new ApiError(422, 'not_monthly', 'Só custos mensais mudam de plano. Num avulso, edite o valor.');
    if (b.fromMonth <= c.startMonth) throw new ApiError(422, 'before_start', 'A mudança precisa ser depois do mês de início. Para mudar o valor inicial, edite o custo.');
    if (c.endMonth && b.fromMonth > c.endMonth) throw new ApiError(422, 'after_end', 'O custo já terminou antes deste mês.');
    if (!(Number(b.amount) > 0)) throw new ApiError(422, 'invalid_input', 'Informe um valor maior que zero.');
    const i = list.findIndex((p) => p.from === b.fromMonth);
    const row: CostPrice = { id: i >= 0 ? list[i].id : 'p' + ++seq, from: b.fromMonth, amount: Number(b.amount), note: b.note || null };
    if (i >= 0) list[i] = row; else { list.push(row); list.sort((a, z) => a.from.localeCompare(z.from)); }
    return row;
  }
  m = path.match(/^\/finance\/costs(?:\/([^/]+))?$/);
  if (m) {
    const id = m[1];
    if (method === 'DELETE') { const i = FIN_COSTS.findIndex((c) => c.id === id); if (i < 0) throw new ApiError(404, 'not_found', 'Custo não encontrado.'); own(u, FIN_COSTS[i].companyId); FIN_COSTS.splice(i, 1); return undefined; }
    own(u, b.companyId);
    if (!(Number(b.amount) > 0) || String(b.name ?? '').trim().length < 2) throw new ApiError(422, 'invalid_input', 'Confira nome e valor.');
    const row: T.FinanceCost = { id: id ?? 'k' + ++seq, companyId: b.companyId, companyName: coName(b.companyId), name: String(b.name).trim(), category: b.category, amount: Number(b.amount), currency: b.currency, recurrence: b.recurrence, startMonth: b.startMonth, endMonth: b.recurrence === 'once' ? null : b.endMonth ?? null, payDay: Number(b.payDay) || 1, notes: b.notes ?? null };
    (row as MockCost).site = b.site ? String(b.site).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : null;
    if (id) { const i = FIN_COSTS.findIndex((c) => c.id === id); if (i < 0) throw new ApiError(404, 'not_found', 'Custo não encontrado.'); FIN_COSTS[i] = row; } else FIN_COSTS.push(row);
    return row;
  }
  // 0.15: um lançamento dividido por site
  if (path === '/finance/cash/split' && method === 'POST') {
    const lines = (b.lines ?? []) as { site: string | null; amount: number; revsharePct?: number | null }[];
    if (lines.length < 2) throw new ApiError(422, 'invalid_input', 'Informe pelo menos dois sites.');
    const sites = lines.map((l) => (l.site ?? '').trim().toLowerCase()).filter(Boolean);
    if (new Set(sites).size !== sites.length) throw new ApiError(422, 'duplicate_site', 'O mesmo site aparece duas vezes no lançamento.');
    const ids = lines.map((l) => (financeMutate(u, 'POST', '/finance/cash', { ...b, lines: undefined, site: l.site, amount: l.amount, revsharePct: l.revsharePct !== undefined ? l.revsharePct : b.revsharePct ?? null }) as { id: string }).id);
    return { ids, total: lines.reduce((a, l) => a + l.amount, 0) };
  }
  m = path.match(/^\/finance\/cash(?:\/([^/]+))?$/);
  if (m) {
    const i = m[1] ? FIN_CASH.findIndex((e) => e.id === m![1]) : -1;
    if (m[1] && i < 0) throw new ApiError(404, 'not_found', 'Lançamento não encontrado.');
    if (i >= 0) own(u, FIN_CASH[i].companyId);
    if (method === 'DELETE') { FIN_CASH.splice(i, 1); return undefined; }
    own(u, b.companyId);
    if (b.date > TODAY) throw new ApiError(422, 'future_date', 'A data não pode ser depois de hoje.');
    if (b.kind !== 'balance' && !(Number(b.amount) > 0)) throw new ApiError(422, 'invalid_input', 'O valor precisa ser maior que zero.');
    if ((b.kind === 'income' || b.kind === 'expense') && !b.category) throw new ApiError(422, 'invalid_input', 'Escolha a origem ou o tipo do gasto.');
    const row: Entry = { id: i >= 0 ? FIN_CASH[i].id : 'e' + ++seq, companyId: b.companyId, date: b.date, kind: b.kind, category: b.kind === 'income' || b.kind === 'expense' ? b.category : null,
      amount: b.kind === 'income' && b.revsharePct != null ? Math.round(Number(b.amount) * (1 - Number(b.revsharePct) / 100) * 100) / 100 : Number(b.amount),
      grossAmount: b.kind === 'income' && b.revsharePct != null ? Number(b.amount) : null, revsharePct: b.kind === 'income' && b.revsharePct != null ? Number(b.revsharePct) : null,
      currency: b.currency, note: b.note ?? null, createdBy: i >= 0 ? FIN_CASH[i].createdBy : u.name,
      site: (b.kind === 'income' || b.kind === 'expense') && b.site ? String(b.site).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : null,
      competence: (b.kind === 'income' || b.kind === 'expense') && b.competence ? b.competence : null };
    if (row.competence && row.competence > row.date.slice(0, 7)) throw new ApiError(422, 'future_competence', 'O mês de referência não pode ser depois da data do lançamento.');
    if (i >= 0) FIN_CASH[i] = row; else FIN_CASH.push(row);
    return { id: row.id };
  }
  throw new ApiError(404, 'not_found', 'Rota de Finance desconhecida.');
}

let attSeq = 100;
function mockAttachments(u: T.User, method: string, path: string, b: Record<string, any>, ownerCo: (t: { entryId?: string; costId?: string }) => string | undefined): unknown {
  const co = ownerCo(b);
  if (!co) throw new ApiError(404, 'not_found', 'Lançamento ou custo não encontrado.');
  own(u, co);
  const key = b.entryId ? 'entryId' : 'costId';
  if (method === 'GET') return { attachments: FIN_ATT.filter((a) => a[key] === b[key] && (!b.month || !a.month || a.month === b.month)) };
  const base = { amount: b.amount ? Number(b.amount) : null, currency: b.amount ? b.currency ?? 'BRL' : null, docNumber: b.docNumber ?? null, docDate: b.docDate ?? null, month: b.month ?? null, note: b.note ?? null,
    entryId: b.entryId ?? null, costId: b.costId ?? null, createdBy: u.name, createdAt: new Date().toISOString() };
  let a: Attachment;
  if (path === '/finance/attachments/file') {
    const f = b.mockFile as { name: string; type: string; size: number; url: string };
    if (f.size > 10 * 1024 * 1024) throw new ApiError(413, 'file_too_large', 'Arquivo acima de 10 MB. Para arquivos maiores, use o link do Drive.');
    a = { id: 'a' + ++attSeq, kind: 'file', url: f.url, filename: f.name, mime: f.type, size: f.size, ...base };
  } else {
    if (!/^https:\/\/\S+$/.test(String(b.url ?? ''))) throw new ApiError(422, 'invalid_input', 'Use um link https (ex.: do Google Drive).');
    a = { id: 'a' + ++attSeq, kind: 'link', url: b.url, filename: null, mime: null, size: null, ...base };
  }
  FIN_ATT.push(a);
  return a;
}
