/**
 * Modo demo das Comissões (0.14): as mesmas contas do servidor (services/financeResults.ts), lendo o Caixa do mock.
 * GETs chegam como POST `…/__q` (o roteador de mocks só repassa o corpo).
 * u2 e u3 são os gestores do login de demonstração (mocks/db.ts): entrando como eles, só aparecem os sites deles.
 */
import type * as T from '@/types/api';
import { ApiError } from '@/lib/api/client';
import type { Assignment, CommissionLine, CommissionSite, SiteCard, Tier } from '@/lib/financeOps';
import { FIN_CASH, FIN_COSTS, FIN_SITES, financeCompanies, finMock } from './finance';
import { TODAY } from './db';

const OPS = /^\/finance\/(sites|commissions|assignments|commission-rule)(\/|$)/;
export const isOpsPath = (p: string) => OPS.test(p);

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const M = () => finMock.NOW();
const sh = (m: string, n: number) => finMock.shift(m, n);
const mEnd = (m: string) => finMock.monthEnd(m);
const id = (p: string) => p + finMock.seq();
const day = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`;
const norm = (s: unknown) => { const h = String(s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]; return h && h.includes('.') ? h : null; };

const MANAGERS = [
  { id: 'u2', name: 'Gestor Exemplo', role: 'gestor' }, { id: 'u3', name: 'Ana Exemplo', role: 'gestor' },
  { id: 'g3', name: 'Gestor Gama', role: 'gestor' }, { id: 'g4', name: 'Gestor Delta', role: 'gestor' },
];
const RULE = { name: 'Meritocracia', tiers: [{ from: 0, pct: 10 }, { from: 20000, pct: 12 }, { from: 40000, pct: 15 }] as Tier[], tierCurrency: 'USD' as T.Currency };
const ASG: Assignment[] = [];
interface Period { id: string; userId: string; companyId: string; month: string; base: CommissionLine; calculated: number; adjustments: number; adjustmentNote: string | null; approved: number; approvedBy: string; approvedAt: string; paidAt: string | null; paidNote: string | null }
const PER: Period[] = [];

let ready = false;
function init() {
  if (ready) return; ready = true;
  const N = M(), P = sh(N, -1);
  const A = (userId: string, companyId: string, site: string, startDate: string, sharePct = 100) =>
    ASG.push({ id: id('a'), userId, userName: MANAGERS.find((m) => m.id === userId)!.name, companyId, site, startDate, endDate: null, sharePct, note: null });
  A('u2', 'c1', 'dominiox.com', day(sh(N, -8), 1)); A('u2', 'c1', 'dominiot.com', day(sh(N, -8), 1));
  A('u3', 'c1', 'dominioy.com', day(sh(N, -8), 1)); A('g4', 'c1', 'dominiov.com', day(sh(N, -6), 1));
  A('u3', 'c2', 'dominioz.com', day(sh(N, -8), 1)); A('g3', 'c2', 'dominiow.com', day(P, 16));
  // meses anteriores já aprovados e pagos por fora (dia 10 do mês seguinte); o retrasado da Ana ainda a pagar
  for (const m of [sh(N, -4), sh(N, -3), sh(N, -2)]) for (const l of commissionsFor(['c1', 'c2'], m)) {
    PER.push({ id: id('p'), userId: l.userId, companyId: l.companyId, month: m, base: l, calculated: l.calculated, adjustments: 0, adjustmentNote: null, approved: l.calculated,
      approvedBy: 'Lucas Hirsch', approvedAt: `${day(sh(m, 1), 6)}T15:00:00Z`, paidAt: m === sh(N, -2) && l.userId === 'u3' ? null : day(sh(m, 1), 10), paidNote: 'PIX' });
  }
}

/* ---------- mesmas contas do servidor ---------- */
function siteResults(ids: string[], month: string) {
  const map = new Map<string, Omit<SiteCard, 'managers'>>();
  const get = (c: string, s: string) => { let x = map.get(`${c}|${s}`); if (!x) { x = { companyId: c, site: s, month, revenue: 0, expenses: 0, siteCosts: 0, costs: 0, result: 0, roi: null }; map.set(`${c}|${s}`, x); } return x; };
  for (const e of FIN_CASH) {
    if (!e.site || !ids.includes(e.companyId) || (e.kind !== 'income' && e.kind !== 'expense')) continue;
    if ((e.competence ?? e.date.slice(0, 7)) !== month) continue;
    const v = finMock.conv(e.amount, e.currency, 'BRL', e.date);
    if (e.kind === 'income') get(e.companyId, e.site).revenue += v; else get(e.companyId, e.site).expenses += v;
  }
  const rd = [mEnd(month), TODAY].sort()[0];
  for (const c of FIN_COSTS) if (c.site && ids.includes(c.companyId) && finMock.applies(c, month)) get(c.companyId, c.site).siteCosts += finMock.conv(finMock.amountIn(c, month), c.currency, 'BRL', rd);
  for (const x of map.values()) { x.revenue = r2(x.revenue); x.expenses = r2(x.expenses); x.siteCosts = r2(x.siteCosts); x.costs = r2(x.expenses + x.siteCosts); x.result = r2(x.revenue - x.costs); x.roi = x.costs > 0 ? r2((x.result / x.costs) * 100) : null; }
  return [...map.values()].sort((a, b) => b.result - a.result);
}
const coverage = (a: Assignment, m: string) => {
  const s = [a.startDate, `${m}-01`].sort()[1], e = [a.endDate ?? '9999-12-31', mEnd(m)].sort()[0];
  if (s > e) return 0;
  const d = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return ((d(e) - d(s)) / 864e5 + 1) / +mEnd(m).slice(8, 10);
};
function commissionsFor(ids: string[], month: string, userId?: string): CommissionLine[] {
  const res = siteResults(ids, month);
  const rateDay = [mEnd(month), TODAY].sort()[0];
  const groups = new Map<string, Assignment[]>();
  for (const a of ASG) if (ids.includes(a.companyId) && (!userId || a.userId === userId) && coverage(a, month) > 0) groups.set(`${a.userId}|${a.companyId}`, [...(groups.get(`${a.userId}|${a.companyId}`) ?? []), a]);
  for (const p of PER) if (ids.includes(p.companyId) && p.month === month && (!userId || p.userId === userId) && !groups.has(`${p.userId}|${p.companyId}`)) groups.set(`${p.userId}|${p.companyId}`, []);
  const out: CommissionLine[] = [];
  for (const [k, list] of groups) {
    const [uid, companyId] = k.split('|');
    const sites: CommissionSite[] = list.map((a) => {
      const r = res.find((x) => x.companyId === companyId && x.site === a.site), cov = coverage(a, month);
      return { site: a.site, sharePct: a.sharePct, coverage: r2(cov), revenue: r?.revenue ?? 0, costs: r?.costs ?? 0, result: r?.result ?? 0, base: r2((r?.result ?? 0) * (a.sharePct / 100) * cov) };
    });
    const w = (f: (s: CommissionSite) => number) => r2(sites.reduce((a, s) => a + f(s) * (s.sharePct / 100) * s.coverage, 0));
    const profit = r2(sites.reduce((a, s) => a + s.base, 0));
    const profitTier = r2(finMock.conv(profit, 'BRL', RULE.tierCurrency, rateDay));
    const tier = profitTier > 0 ? [...RULE.tiers].sort((a, b) => a.from - b.from).filter((x) => profitTier >= x.from).pop() : null;
    const pct = tier?.pct ?? 0, calculated = r2(Math.max(0, profit) * pct / 100);
    const live: CommissionLine = {
      periodId: null, userId: uid, userName: list[0]?.userName ?? '', companyId, month, sites, revenue: w((s) => s.revenue), costs: w((s) => s.costs), profit,
      negatives: r2(sites.filter((s) => s.base < 0).reduce((a, s) => a + s.base, 0)), profitTier, tierCurrency: RULE.tierCurrency as CommissionLine['tierCurrency'], pct, calculated,
      adjustments: 0, adjustmentNote: null, approved: null, status: month >= M() ? 'open' : 'to_approve', frozen: false, liveDiff: null,
      incomplete: sites.filter((s) => !res.some((x) => x.companyId === companyId && x.site === s.site && x.revenue > 0)).map((s) => `${s.site}: sem receita lançada no Caixa para o mês`),
      approvedBy: null, approvedAt: null, paidAt: null, paidNote: null,
    };
    const per = PER.find((p) => p.userId === uid && p.companyId === companyId && p.month === month);
    out.push(per ? { ...per.base, periodId: per.id, frozen: true, calculated: per.calculated, adjustments: per.adjustments, adjustmentNote: per.adjustmentNote, approved: per.approved,
      status: per.paidAt ? 'paid' : 'approved', approvedBy: per.approvedBy, approvedAt: per.approvedAt, paidAt: per.paidAt, paidNote: per.paidNote,
      liveDiff: list.length && Math.abs(live.calculated - per.calculated) >= 0.01 ? r2(live.calculated - per.calculated) : null } : live);
  }
  return out.sort((a, b) => b.profit - a.profit);
}

/* ---------- roteador ---------- */
export function financeOpsMock(u: T.User, method0: string, path0: string, b: Record<string, any>): unknown {
  init();
  const isQ = path0.endsWith('/__q');
  const method = isQ ? 'GET' : method0, path = isQ ? path0.slice(0, -4) : path0;
  const isAdm = u.role === 'admin' || u.role === 'superadmin';
  let role: 'admin' | 'partner' | 'manager' = isAdm ? 'admin' : 'partner';
  let all: { id: string; name: string }[];
  try { all = financeCompanies(u); }
  catch (e) {
    const mine = [...new Set(ASG.filter((a) => a.userId === u.id).map((a) => a.companyId))];
    if (!mine.length || !(path === '/finance/commissions' && method === 'GET')) throw e;
    role = 'manager'; all = mine.map((cid) => ({ id: cid, name: cid === 'c1' ? 'Empresa A' : 'Empresa B' }));
  }
  if (method !== 'GET' && role !== 'admin') throw new ApiError(403, 'admin_only', 'Só Admin ou SuperAdmin podem fazer isso.');
  const sel = b.company ? all.filter((c) => c.id === b.company) : all;
  if (b.company && !sel.length) throw new ApiError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
  const ids = sel.map((c) => c.id);
  const sitesList = () => {
    const m = new Map<string, { site: string; companyId: string; revshare: number | null }>();
    // % de revshare do domínio (no dash real vem de Admin → Domínios); um site com 9% para mostrar a diferença
    for (const x of [...FIN_SITES, ...ASG, ...FIN_CASH.filter((e) => e.site), ...FIN_COSTS.filter((c) => c.site)] as { site?: string | null; companyId: string }[]) if (x.site && ids.includes(x.companyId)) m.set(`${x.companyId}|${x.site}`, { site: x.site, companyId: x.companyId, revshare: FIN_SITES.some((s) => s.site === x.site) ? (x.site === 'dominioz.com' ? 9 : 7.5) : null });
    return [...m.values()].sort((a, z) => a.site.localeCompare(z.site));
  };
  let m: RegExpMatchArray | null;

  if (path === '/finance/sites') return { sites: sitesList(), sourceError: null };

  if (path === '/finance/commissions' && method === 'GET') {
    const month = b.month || sh(M(), -1);
    const mine = role === 'manager' ? u.id : undefined;
    const allLines = commissionsFor(ids, month, mine);
    const lines = b.user ? allLines.filter((l) => l.userId === b.user) : allLines;
    const owners = (c: string, s: string) => ASG.filter((a) => a.companyId === c && a.site === s && allLines.some((l) => l.userId === a.userId && l.companyId === c && l.sites.some((x) => x.site === s))).map((a) => ({ userId: a.userId, userName: a.userName, sharePct: a.sharePct }));
    let cards: SiteCard[] = siteResults(ids, month).map((s) => ({ ...s, managers: owners(s.companyId, s.site) }));
    for (const l of allLines) for (const s of l.sites) if (!cards.some((c) => c.companyId === l.companyId && c.site === s.site)) cards.push({ companyId: l.companyId, site: s.site, month, revenue: 0, expenses: 0, siteCosts: 0, costs: 0, result: 0, roi: null, managers: owners(l.companyId, s.site) });
    if (mine) cards = cards.filter((c) => c.managers.some((x) => x.userId === mine));
    if (b.user) cards = cards.filter((c) => c.managers.some((x) => x.userId === b.user));
    const sum = (f: (x: CommissionLine) => number) => r2(lines.reduce((a, x) => a + f(x), 0));
    const months: string[] = []; for (let i = 0, mm = M(); i < 12; i++, mm = sh(mm, -1)) months.push(mm);
    return {
      viewer: { role, userId: u.id }, month, months, companies: all, managers: [...new Map(allLines.map((l) => [l.userId, l.userName])).entries()].map(([i, name]) => ({ id: i, name })),
      rule: RULE, lines, sites: cards,
      totals: { revenue: r2(cards.reduce((a, c) => a + c.revenue, 0)), costs: r2(cards.reduce((a, c) => a + c.costs, 0)), result: r2(cards.reduce((a, c) => a + c.result, 0)),
        commissions: sum((l) => l.approved ?? l.calculated), toPay: sum((l) => (l.status === 'paid' ? 0 : l.approved ?? l.calculated)), paid: sum((l) => (l.status === 'paid' ? l.approved ?? 0 : 0)) },
    };
  }
  if (path === '/finance/commissions/approve') {
    if (b.month >= M()) throw new ApiError(422, 'month_not_ended', 'Só dá para aprovar depois que o mês fechar.');
    if (PER.some((p) => p.userId === b.userId && p.companyId === b.companyId && p.month === b.month)) throw new ApiError(409, 'already_approved', 'Esta comissão já foi aprovada. Reabra para recalcular.');
    if (b.adjustments && String(b.adjustmentNote ?? '').length < 3) throw new ApiError(422, 'invalid_input', 'Explique o ajuste (ex.: bônus, desconto de erro).');
    const l = commissionsFor([b.companyId], b.month, b.userId)[0];
    if (!l) throw new ApiError(404, 'not_found', 'Este gestor não tem site vinculado nesta Empresa no mês.');
    const approved = r2(Math.max(0, l.calculated + (Number(b.adjustments) || 0)));
    PER.push({ id: id('p'), userId: b.userId, companyId: b.companyId, month: b.month, base: l, calculated: l.calculated, adjustments: Number(b.adjustments) || 0, adjustmentNote: b.adjustmentNote || null, approved, approvedBy: u.name, approvedAt: new Date().toISOString(), paidAt: null, paidNote: null });
    return { approved };
  }
  if ((m = path.match(/^\/finance\/commissions\/([^/]+)\/(paid|reopen)$/))) {
    const p = PER.find((x) => x.id === m![1]); if (!p) throw new ApiError(404, 'not_found', 'Comissão não encontrada.');
    if (m[2] === 'paid') {
      if (method === 'DELETE') { p.paidAt = null; p.paidNote = null; return undefined; }
      if (b.date > TODAY) throw new ApiError(422, 'future_date', 'A data do pagamento não pode ser depois de hoje.');
      p.paidAt = b.date; p.paidNote = b.note || null; return { id: p.id };
    }
    if (p.paidAt) throw new ApiError(409, 'already_paid', 'Comissão já marcada como paga. Desmarque o pagamento antes de reabrir.');
    PER.splice(PER.indexOf(p), 1); return undefined;
  }
  if (path === '/finance/assignments' && method === 'GET')
    return { viewer: { role }, companies: all, sites: sitesList(), managers: role === 'admin' ? MANAGERS : [], assignments: ASG.filter((a) => ids.includes(a.companyId)) };
  if ((m = path.match(/^\/finance\/assignments(?:\/([^/]+))?$/))) {
    const i = m[1] ? ASG.findIndex((a) => a.id === m![1]) : -1;
    if (m[1] && i < 0) throw new ApiError(404, 'not_found', 'Vínculo não encontrado.');
    const locked = i >= 0 && PER.some((p) => p.userId === ASG[i].userId && p.companyId === ASG[i].companyId && p.month >= ASG[i].startDate.slice(0, 7) && (!ASG[i].endDate || p.month <= ASG[i].endDate!.slice(0, 7)));
    if (method === 'DELETE') { if (locked) throw new ApiError(409, 'history_locked', 'Este vínculo já tem comissão aprovada. Coloque uma data de fim em vez de excluir.'); ASG.splice(i, 1); return undefined; }
    const site = norm(b.site); if (!site) throw new ApiError(422, 'invalid_input', 'Site inválido. Use o domínio, ex.: dominiox.com');
    if (b.endDate && b.endDate < b.startDate) throw new ApiError(422, 'invalid_input', 'O fim não pode ser antes do início.');
    const old = i >= 0 ? ASG[i] : null;
    if (old && locked && (old.userId !== b.userId || old.site !== site || old.startDate !== b.startDate || old.sharePct !== Number(b.sharePct)))
      throw new ApiError(409, 'history_locked', 'Este vínculo já tem comissão aprovada. Para trocar gestor, site ou rateio, coloque a data de fim e crie um vínculo novo (os meses anteriores não mudam).');
    const overlap = ASG.filter((a) => a.id !== old?.id && a.companyId === b.companyId && a.site === site && a.startDate <= (b.endDate || '9999') && (a.endDate ?? '9999') >= b.startDate).reduce((x, a) => x + a.sharePct, 0);
    if (overlap + Number(b.sharePct) > 100.0001) throw new ApiError(422, 'share_over_100', `Neste período o site já tem ${overlap}% com outro(s) gestor(es). A soma do rateio não pode passar de 100%.`);
    const row: Assignment = { id: old?.id ?? id('a'), userId: b.userId, userName: MANAGERS.find((x) => x.id === b.userId)?.name ?? 'Gestor', companyId: b.companyId, site, startDate: b.startDate, endDate: b.endDate || null, sharePct: Number(b.sharePct), note: b.note || null };
    if (old) ASG[i] = row; else ASG.push(row);
    return { id: row.id };
  }
  if (path === '/finance/commission-rule') {
    if (!(b.tiers ?? []).some((t: Tier) => t.from === 0)) throw new ApiError(422, 'invalid_input', 'A primeira faixa precisa começar em 0.');
    RULE.name = b.name; RULE.tiers = [...b.tiers].sort((x: Tier, y: Tier) => x.from - y.from); RULE.tierCurrency = b.tierCurrency;
    return { ok: true };
  }
  throw new ApiError(404, 'not_found', 'rota ' + path);
}
