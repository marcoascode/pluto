/**
 * Modo demo das Comissões (0.18.8): as mesmas contas do servidor (services/financeResults.ts). Os gestores de cada site
 * simulam os vínculos de Usuários & Squads (gestor → domínio → contas) e a modalidade de comissão do cadastro.
 * GETs chegam como POST `…/__q` (o roteador de mocks só repassa o corpo).
 * u2 e u3 são os gestores do login de demonstração (mocks/db.ts): entrando como eles, só aparecem os sites deles.
 */
import type * as T from '@/types/api';
import { ApiError } from '@/lib/api/client';
import type { Assignment, CommissionLine, CommissionMode, CommissionSite, SiteCard, Tier } from '@/lib/financeOps';
import { FIN_CASH, FIN_COSTS, FIN_SITES, financeCompanies, finMock } from './finance';
import { TODAY } from './db';

const OPS = /^\/finance\/(sites|commissions|assignments)(\/|$)/;
export const isOpsPath = (p: string) => OPS.test(p);

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const M = () => finMock.NOW();
const sh = (m: string, n: number) => finMock.shift(m, n);
const mEnd = (m: string) => finMock.monthEnd(m);
const id = (p: string) => p + finMock.seq();
const day = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`;

const MANAGERS: { id: string; name: string; mode: CommissionMode; fixedPct: number | null }[] = [
  { id: 'u2', name: 'Gestor Exemplo', mode: 'progressive', fixedPct: null }, { id: 'u3', name: 'Ana Exemplo', mode: 'fixed', fixedPct: 11 },
  { id: 'g3', name: 'Gestor Gama', mode: 'progressive', fixedPct: null }, { id: 'g4', name: 'Gestor Delta', mode: 'progressive', fixedPct: null },
];
/** 0.18.10: faixas da progressiva ficam no cadastro de cada gestor; no demo, todos com o padrão */
const RULE = { tiers: [{ from: 0, pct: 10 }, { from: 20000, pct: 12 }, { from: 40000, pct: 15 }] as Tier[], tierCurrency: 'USD' as T.Currency };
/** gestor × site (no dash real: Usuários & Squads → gestor → Domínios) */
interface Asg { userId: string; companyId: string; site: string }
const ASG: Asg[] = [];
interface Period { id: string; userId: string; companyId: string; month: string; base: CommissionLine; calculated: number; adjustments: number; adjustmentNote: string | null; approved: number; approvedBy: string; approvedAt: string; paidAt: string | null; paidNote: string | null }
const PER: Period[] = [];
/** períodos "Gestores e sites" do demo (só listagem e edição; o cálculo do demo usa o rateio) */
const PERIODS: Assignment[] = [];

let ready = false;
function init() {
  if (ready) return; ready = true;
  const N = M();
  const A = (userId: string, companyId: string, site: string) => ASG.push({ userId, companyId, site });
  A('u2', 'c1', 'dominiox.com'); A('u2', 'c1', 'dominiot.com'); A('u3', 'c1', 'dominioy.com'); A('g4', 'c1', 'dominiov.com');
  A('u3', 'c2', 'dominioz.com'); A('g3', 'c2', 'dominiow.com');
  // meses anteriores já aprovados e pagos por fora (dia 10 do mês seguinte); o retrasado da Ana ainda a pagar
  for (const m of [sh(N, -4), sh(N, -3), sh(N, -2)]) for (const l of commissionsFor(['c1', 'c2'], m)) {
    PER.push({ id: id('p'), userId: l.userId, companyId: l.companyId, month: m, base: l, calculated: l.calculated, adjustments: 0, adjustmentNote: null, approved: l.calculated,
      approvedBy: 'Lucas Hirsch', approvedAt: `${day(sh(m, 1), 6)}T15:00:00Z`, paidAt: m === sh(N, -2) && l.userId === 'u3' ? null : day(sh(m, 1), 10), paidNote: 'PIX' });
  }
}

/* ---------- mesmas contas do servidor ---------- */
const USD_RATE = 5.3;   // cotação do ROI no demo
function siteResults(ids: string[], month: string): SiteCard[] {
  // receita líquida e despesas "do dash" (no demo, os números de cada site por mês, mês corrente proporcional até hoje)
  const k = Math.round((Date.parse(`${month}-15`) - Date.parse(`${M()}-15`)) / (30.44 * 864e5));
  const grow = [0.82, 0.88, 0.94, 1, 1.03][Math.max(0, Math.min(4, k + 4))];
  const part = month === M() ? Number(TODAY.slice(8, 10)) / Number(mEnd(month).slice(8, 10)) : month > M() ? 0 : 1;
  const out: SiteCard[] = [];
  for (const x of FIN_SITES) {
    if (!ids.includes(x.companyId) || k < x.from) continue;
    const g = grow * (1 + ((x.site.length + (k + 4) * 3) % 5 - 2) / 100) * part;
    const revenue = x.income * g, allAds = (x.google + x.meta) * g;
    const own = ASG.filter((a) => a.companyId === x.companyId && a.site === x.site);
    const share = own.length ? 1 / own.length : 0;
    // contas vinculadas ao gestor: ~95% da despesa do site (o resto é de conta sem vínculo, fica fora do ROI dele)
    const managers = own.map((a) => { const ads = allAds * 0.95 / own.length; return { userId: a.userId, userName: MANAGERS.find((m) => m.id === a.userId)?.name ?? '', sharePct: r2(share * 100), revenue: r2(revenue * share), ads: r2(ads), result: r2(revenue * share - ads), source: 'rateio' as const, days: 30 }; });
    const ads = own.length ? managers.reduce((a, m) => a + m.ads, 0) : allAds;
    if (!revenue && !allAds) continue;
    out.push({ companyId: x.companyId, site: x.site, month, revenue: r2(revenue), revenueUsd: r2(revenue / USD_RATE), ads: r2(ads), result: r2(revenue - ads), roi: ads > 0 ? r2(((revenue - ads) / ads) * 100) : null, allAds: r2(allAds), managers });
  }
  return out.sort((a, b) => b.result - a.result);
}
function commissionsFor(ids: string[], month: string, userId?: string): CommissionLine[] {
  const res = siteResults(ids, month);
  const groups = new Map<string, CommissionSite[]>();
  for (const s of res) for (const m of s.managers) if (!userId || m.userId === userId) {
    const k = `${m.userId}|${s.companyId}`;
    groups.set(k, [...(groups.get(k) ?? []), { site: s.site, sharePct: m.sharePct, revenue: m.revenue, ads: m.ads, result: m.result }]);
  }
  for (const p of PER) if (ids.includes(p.companyId) && p.month === month && (!userId || p.userId === userId) && !groups.has(`${p.userId}|${p.companyId}`)) groups.set(`${p.userId}|${p.companyId}`, []);
  const out: CommissionLine[] = [];
  for (const [k, sites] of groups) {
    const [uid, companyId] = k.split('|');
    const mgr = MANAGERS.find((m) => m.id === uid);
    const mode = mgr?.mode ?? 'progressive';
    const profit = r2(sites.reduce((a, s) => a + s.result, 0));
    const profitUsd = r2(profit / USD_RATE);
    const profitTier = RULE.tierCurrency === 'USD' ? profitUsd : RULE.tierCurrency === 'BRL' ? profit : r2(finMock.conv(profit, 'BRL', RULE.tierCurrency, [mEnd(month), TODAY].sort()[0]));
    const tier = profitTier > 0 ? [...RULE.tiers].sort((a, b) => a.from - b.from).filter((x) => profitTier >= x.from).pop() : null;
    const pct = mode === 'fixed' ? (profit > 0 ? mgr?.fixedPct ?? 0 : 0) : tier?.pct ?? 0;
    const calculated = r2(Math.max(0, profit) * pct / 100);
    const live: CommissionLine = {
      periodId: null, userId: uid, userName: mgr?.name ?? '', companyId, month, mode, fixedPct: mgr?.fixedPct ?? null, tiers: mode === 'fixed' ? [] : RULE.tiers, sites,
      revenue: r2(sites.reduce((a, s) => a + s.revenue, 0)), ads: r2(sites.reduce((a, s) => a + s.ads, 0)), profit, profitUsd,
      negatives: r2(sites.filter((s) => s.result < 0).reduce((a, s) => a + s.result, 0)), profitTier, tierCurrency: RULE.tierCurrency as CommissionLine['tierCurrency'], pct, calculated, calculatedUsd: r2(calculated / USD_RATE),
      adjustments: 0, adjustmentNote: null, approved: null, status: month >= M() ? 'open' : 'to_approve', frozen: false, liveDiff: null,
      incomplete: sites.filter((s) => !(s.revenue > 0)).map((s) => `${s.site}: sem receita no dash para o mês`),
      approvedBy: null, approvedAt: null, paidAt: null, paidNote: null,
    };
    const per = PER.find((p) => p.userId === uid && p.companyId === companyId && p.month === month);
    out.push(per ? { ...per.base, periodId: per.id, frozen: true, calculated: per.calculated, adjustments: per.adjustments, adjustmentNote: per.adjustmentNote, approved: per.approved,
      status: per.paidAt ? 'paid' : 'approved', approvedBy: per.approvedBy, approvedAt: per.approvedAt, paidAt: per.paidAt, paidNote: per.paidNote,
      liveDiff: sites.length && Math.abs(live.calculated - per.calculated) >= 0.01 ? r2(live.calculated - per.calculated) : null } : live);
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
    for (const x of [...FIN_SITES, ...FIN_CASH.filter((e) => e.site), ...FIN_COSTS.filter((c) => c.site)] as { site?: string | null; companyId: string }[]) if (x.site && ids.includes(x.companyId)) m.set(`${x.companyId}|${x.site}`, { site: x.site, companyId: x.companyId, revshare: FIN_SITES.some((s) => s.site === x.site) ? (x.site === 'dominioz.com' ? 9 : 7.5) : null });
    return [...m.values()].sort((a, z) => a.site.localeCompare(z.site));
  };
  let m: RegExpMatchArray | null;

  if (path === '/finance/sites') return { sites: sitesList(), sourceError: null };

  if (path === '/finance/commissions' && method === 'GET') {
    const month = b.month || sh(M(), -1);
    const mine = role === 'manager' ? u.id : undefined;
    const allLines = commissionsFor(ids, month, mine);
    const lines = b.user ? allLines.filter((l) => l.userId === b.user) : allLines;
    let cards = siteResults(ids, month);
    if (mine) cards = cards.filter((c) => c.managers.some((x) => x.userId === mine));
    if (b.user) cards = cards.filter((c) => c.managers.some((x) => x.userId === b.user));
    const sum = (f: (x: CommissionLine) => number) => r2(lines.reduce((a, x) => a + f(x), 0));
    const months: string[] = []; for (let i = 0, mm = M(); i < 12; i++, mm = sh(mm, -1)) months.push(mm);
    return {
      viewer: { role, userId: u.id }, month, months, companies: all, managers: [...new Map(allLines.map((l) => [l.userId, l.userName])).entries()].map(([i, name]) => ({ id: i, name })),
      lines, sites: cards,
      totals: { revenue: sum((l) => l.revenue), ads: sum((l) => l.ads), result: sum((l) => l.profit), resultUsd: sum((l) => l.profitUsd),
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
    return { viewer: { role }, companies: all, sites: sitesList(), managers: role === 'admin' ? MANAGERS.map((x) => ({ id: x.id, name: x.name, role: 'gestor' })) : [], assignments: PERIODS.filter((a) => ids.includes(a.companyId) && (!b.user || a.userId === b.user)) };
  if ((m = path.match(/^\/finance\/assignments(?:\/([^/]+))?$/))) {
    const i = m[1] ? PERIODS.findIndex((a) => a.id === m![1]) : -1;
    if (m[1] && i < 0) throw new ApiError(404, 'not_found', 'Vínculo não encontrado.');
    if (method === 'DELETE') { PERIODS.splice(i, 1); return undefined; }
    if (b.endDate && b.endDate < b.startDate) throw new ApiError(422, 'invalid_input', 'O fim não pode ser antes do início.');
    const row: Assignment = { id: m[1] ?? id('a'), userId: b.userId, userName: MANAGERS.find((x) => x.id === b.userId)?.name ?? 'Gestor', companyId: b.companyId, site: String(b.site).toLowerCase(), startDate: b.startDate, endDate: b.endDate || null, sharePct: Number(b.sharePct), note: b.note || null };
    if (i >= 0) PERIODS[i] = row; else PERIODS.push(row);
    return { id: row.id };
  }
  throw new ApiError(404, 'not_found', 'rota ' + path);
}
