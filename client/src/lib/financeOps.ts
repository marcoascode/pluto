/**
 * Finance 0.14 — Comissões dos gestores (a partir do Caixa Empresa), sites, vínculos gestor × site e regra.
 * Fica separado de lib/finance.ts para a atualização não mexer em arquivos compartilhados do dash.
 */
import { api } from '@/lib/api/client';

const MOCK = import.meta.env.VITE_API_MOCK === 'true';
type Q = Record<string, string | undefined>;
/** GET com filtros. No modo demo o roteador de mocks só repassa o corpo, então a consulta vai como POST …/__q. */
const get = <T,>(path: string, q: Q = {}) => {
  const clean = Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>;
  return MOCK ? api.post<T>(`${path}/__q`, clean) : api.get<T>(path, clean);
};

export type ViewerRole = 'admin' | 'partner' | 'manager';
export interface Company { id: string; name: string }
/** revshare: % do domínio cadastrado no dash (Admin → Domínios); sem cadastro = 7,5% */
export interface Site { site: string; companyId: string; revshare?: number | null }
export const DEFAULT_REVSHARE = 7.5;
export const sitesApi = { list: (q: { company?: string }) => get<{ sites: Site[]; sourceError: string | null }>('/finance/sites', q) };

export interface Tier { from: number; pct: number }
export type CommissionStatus = 'open' | 'to_approve' | 'approved' | 'paid';
export const STATUS: Record<CommissionStatus, { label: string; color: string }> = {
  open: { label: 'Em apuração', color: '#8094b9' },
  to_approve: { label: 'A aprovar', color: '#f5b84a' },
  approved: { label: 'Aprovada · a pagar', color: '#5b9bff' },
  paid: { label: 'Paga', color: '#34d399' },
};
export interface CommissionSite { site: string; sharePct: number; coverage: number; revenue: number; costs: number; result: number; base: number }
export interface CommissionLine {
  periodId: string | null; userId: string; userName: string; companyId: string; month: string;
  sites: CommissionSite[]; revenue: number; costs: number; profit: number; negatives: number; profitTier: number; tierCurrency: 'BRL' | 'USD' | 'EUR';
  pct: number; calculated: number; adjustments: number; adjustmentNote: string | null; approved: number | null;
  status: CommissionStatus; frozen: boolean; liveDiff: number | null; incomplete: string[];
  approvedBy: string | null; approvedAt: string | null; paidAt: string | null; paidNote: string | null;
}
export interface SiteCard { companyId: string; site: string; month: string; revenue: number; expenses: number; siteCosts: number; costs: number; result: number; roi: number | null; managers: { userId: string; userName: string; sharePct: number }[] }
export interface CommissionsResponse {
  viewer: { role: ViewerRole; userId: string }; month: string; months: string[]; companies: Company[]; managers: { id: string; name: string }[];
  rule: { name: string; tiers: Tier[]; tierCurrency: 'BRL' | 'USD' | 'EUR' };
  lines: CommissionLine[]; sites: SiteCard[];
  totals: { revenue: number; costs: number; result: number; commissions: number; toPay: number; paid: number };
}
export interface Assignment { id: string; userId: string; userName: string; companyId: string; site: string; startDate: string; endDate: string | null; sharePct: number; note: string | null }
export interface AssignmentsResponse { viewer: { role: ViewerRole }; companies: Company[]; sites: Site[]; managers: { id: string; name: string; role: string }[]; assignments: Assignment[] }

export const commissionsApi = {
  list: (q: { company?: string; month: string; user?: string }) => get<CommissionsResponse>('/finance/commissions', q),
  approve: (b: { userId: string; companyId: string; month: string; adjustments: number; adjustmentNote: string | null }) => api.post<{ id: string; approved: number }>('/finance/commissions/approve', b),
  paid: (a: { id: string; date: string; note: string | null }) => api.post<unknown>(`/finance/commissions/${a.id}/paid`, { date: a.date, note: a.note }),
  unpaid: (id: string) => api.del<void>(`/finance/commissions/${id}/paid`),
  reopen: (a: { id: string; reason: string }) => api.post<void>(`/finance/commissions/${a.id}/reopen`, { reason: a.reason }),
  assignments: (q: { company?: string }) => get<AssignmentsResponse>('/finance/assignments', q),
  saveAssignment: ({ id, ...b }: Omit<Assignment, 'id' | 'userName'> & { id?: string }) => (id ? api.put<{ id: string }>(`/finance/assignments/${id}`, b) : api.post<{ id: string }>('/finance/assignments', b)),
  removeAssignment: (id: string) => api.del<void>(`/finance/assignments/${id}`),
  saveRule: (b: { name: string; tiers: Tier[]; tierCurrency: 'BRL' | 'USD' | 'EUR' }) => api.put<unknown>('/finance/commission-rule', b),
};

export const brl = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const brl0 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`);
export const pctFmt = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`);
export const parseNum = (s: string) => Number(String(s).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
/** "Até US$ 20 mil 10% · acima de US$ 20 mil 12% · a partir de US$ 40 mil 15%" */
export function tiersText(tiers: Tier[], cur: string) {
  const t = [...tiers].sort((a, b) => a.from - b.from);
  const k = (v: number) => `${cur === 'USD' ? 'US$' : cur === 'EUR' ? '€' : 'R$'} ${v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR')} mil` : v}`;
  return t.map((x, i) => (i === 0 ? `até ${k(t[1]?.from ?? 0)} ${pctFmt(x.pct)}` : i === t.length - 1 && i > 1 ? `a partir de ${k(x.from)} ${pctFmt(x.pct)}` : `acima de ${k(x.from)} ${pctFmt(x.pct)}`)).join(' · ');
}
