/**
 * Finance — Comissões dos gestores (0.18.8: ROI dos sites do gestor pelos vínculos de Usuários & Squads × % da modalidade
 * do gestor: progressiva pelas faixas do painel ou fixa pelo cadastro), sites e faixas da comissão progressiva.
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
export type CommissionMode = 'progressive' | 'fixed';
/** ROI do gestor no site: receita (parte dele, R$) − despesas das contas dele no site (R$) */
export interface CommissionSite { site: string; sharePct: number; revenue: number; ads: number; result: number }
export interface CommissionLine {
  periodId: string | null; userId: string; userName: string; companyId: string; month: string;
  mode: CommissionMode; fixedPct: number | null;
  sites: CommissionSite[]; revenue: number; ads: number; profit: number; profitUsd: number; negatives: number; profitTier: number; tierCurrency: 'BRL' | 'USD' | 'EUR';
  pct: number; calculated: number; calculatedUsd: number; adjustments: number; adjustmentNote: string | null; approved: number | null;
  status: CommissionStatus; frozen: boolean; liveDiff: number | null; incomplete: string[];
  approvedBy: string | null; approvedAt: string | null; paidAt: string | null; paidNote: string | null;
}
export interface SiteManager { userId: string; userName: string; sharePct: number; revenue: number; ads: number; result: number }
/** revenue = receita líquida (R$, cotação do ROI) · ads = despesas das contas vinculadas aos gestores · allAds = despesa total do site */
export interface SiteCard { companyId: string; site: string; month: string; revenue: number; revenueUsd: number; ads: number; result: number; roi: number | null; allAds: number; managers: SiteManager[] }
export interface CommissionsResponse {
  viewer: { role: ViewerRole; userId: string }; month: string; months: string[]; companies: Company[]; managers: { id: string; name: string }[];
  rule: { name: string; tiers: Tier[]; tierCurrency: 'BRL' | 'USD' | 'EUR' };
  lines: CommissionLine[]; sites: SiteCard[];
  totals: { revenue: number; ads: number; result: number; resultUsd: number; commissions: number; toPay: number; paid: number };
}

export const commissionsApi = {
  list: (q: { company?: string; month: string; user?: string }) => get<CommissionsResponse>('/finance/commissions', q),
  approve: (b: { userId: string; companyId: string; month: string; adjustments: number; adjustmentNote: string | null }) => api.post<{ id: string; approved: number }>('/finance/commissions/approve', b),
  paid: (a: { id: string; date: string; note: string | null }) => api.post<unknown>(`/finance/commissions/${a.id}/paid`, { date: a.date, note: a.note }),
  unpaid: (id: string) => api.del<void>(`/finance/commissions/${id}/paid`),
  reopen: (a: { id: string; reason: string }) => api.post<void>(`/finance/commissions/${a.id}/reopen`, { reason: a.reason }),
  saveRule: (b: { name: string; tiers: Tier[]; tierCurrency: 'BRL' | 'USD' | 'EUR' }) => api.put<unknown>('/finance/commission-rule', b),
};

export const usd = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const brl = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const brl0 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`);
export const pctFmt = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`);
export const parseNum = (s: string) => Number(String(s).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
/** "até US$ 19.999,99: 10% · US$ 20.000,00 a US$ 39.999,99: 12% · a partir de US$ 40.000,00: 15%" */
export function tiersText(tiers: Tier[], cur: string) {
  const t = [...tiers].sort((a, b) => a.from - b.from);
  const sym = cur === 'USD' ? 'US$' : cur === 'EUR' ? '€' : 'R$';
  const k = (v: number) => `${sym} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return t.map((x, i) => {
    const next = t[i + 1];
    const range = !next ? (i === 0 ? 'qualquer ROI' : `a partir de ${k(x.from)}`) : i === 0 ? `até ${k(next.from - 0.01)}` : `${k(x.from)} a ${k(next.from - 0.01)}`;
    return `${range}: ${pctFmt(x.pct)}`;
  }).join(' · ');
}
