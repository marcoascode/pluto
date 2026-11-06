import { api, ApiError } from '@/lib/api/client';
import type { CostCategory, Currency, FinanceCost } from '@/types/api';
import { lastMonths, monthLabel } from './period';

/** Categorias de custo (Finance → Custos). */
export const COST_CATEGORIES: { key: CostCategory; label: string; color: string; hint: string }[] = [
  { key: 'tools', label: 'Ferramentas', color: '#5b9bff', hint: 'assinaturas mensais: IA, design, analytics…' },
  { key: 'domains', label: 'Domínios', color: '#22d3ee', hint: 'registro e renovação de domínios' },
  { key: 'hosting', label: 'Hospedagem', color: '#a78bfa', hint: 'servidores, CDN, banco de dados' },
  { key: 'team', label: 'Equipe / salários', color: '#34d399', hint: 'salários, freelas, pró-labore' },
  { key: 'taxes', label: 'Impostos e taxas', color: '#f5b84a', hint: 'impostos, contador, taxas bancárias' },
  { key: 'services', label: 'Serviços', color: '#f472b6', hint: 'agências, consultorias, suporte' },
  { key: 'other', label: 'Outros', color: '#8a9bbd', hint: 'o que não se encaixa acima' },
];
export const CATEGORY = Object.fromEntries(COST_CATEGORIES.map((c) => [c.key, c])) as Record<CostCategory, (typeof COST_CATEGORIES)[number]>;

/** "outubro de 2026" → "Outubro 2026" · curto: "out/26". */
export const monthTitle = (ym: string) => monthLabel(ym).replace(' de ', ' ').replace(/^./, (c) => c.toUpperCase());
export const monthShort = (ym: string) => `${monthLabel(ym).slice(0, 3)}/${ym.slice(2, 4)}`;
/** Meses para os seletores: atual primeiro, 36 para trás e 12 para frente (custos futuros). */
export function monthOptions(back = 36, ahead = 12) {
  const past = lastMonths(back);
  const fut: string[] = [];
  let [y, m] = past[0].split('-').map(Number);
  for (let i = 0; i < ahead; i++) { if (++m > 12) { m = 1; y++; } fut.unshift(`${y}-${String(m).padStart(2, '0')}`); }
  return [...fut, ...past];
}
export function shiftMonth(ym: string, n: number) {
  let [y, m] = ym.split('-').map(Number);
  m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

/* =====================================================================================
 * Caixa Empresa (0.11): 100% manual. Receita recebida e gastos pagos são lançados à mão;
 * os custos da aba Custos entram sozinhos. Nada vem do sync das campanhas.
 * Tipos e chamadas do caixa ficam aqui para a atualização mexer só nos arquivos do Finance.
 * ===================================================================================== */

export type EntryKind = 'income' | 'expense' | 'deposit' | 'withdrawal' | 'balance';
export type IncomeCategory = 'adx' | 'adsense' | 'other_income';
export type ExpenseCategory = 'google_ads' | 'meta_ads' | 'other_expense';
export type EntryCategory = IncomeCategory | ExpenseCategory;

/** Tipos de lançamento do caixa, na ordem dos botões. */
export const ENTRY_KINDS: { key: EntryKind; label: string; short: string; sign: '+' | '−' | '='; color: string; hint: string }[] = [
  { key: 'income', label: 'Receita recebida', short: 'Receita', sign: '+', color: '#34d399', hint: 'dinheiro que caiu na conta (pagamento do Ad Manager, AdSense…)' },
  { key: 'expense', label: 'Gasto pago', short: 'Gasto', sign: '−', color: '#f59e4b', hint: 'fatura do Google Ads, da Meta ou outro gasto pago' },
  { key: 'deposit', label: 'Aporte', short: 'Aporte', sign: '+', color: '#5b9bff', hint: 'dinheiro colocado pelos sócios' },
  { key: 'withdrawal', label: 'Retirada', short: 'Retirada', sign: '−', color: '#ff6b7a', hint: 'distribuição de lucro, pró-labore…' },
  { key: 'balance', label: 'Saldo conferido', short: 'Saldo', sign: '=', color: '#a78bfa', hint: 'saldo do banco no fim do dia; o caixa conta a partir dele' },
];
export const KIND = Object.fromEntries(ENTRY_KINDS.map((k) => [k.key, k])) as Record<EntryKind, (typeof ENTRY_KINDS)[number]>;
export const INCOME_CATS: { key: IncomeCategory; label: string }[] = [
  { key: 'adx', label: 'Google Ad Manager / AdX' }, { key: 'adsense', label: 'AdSense' }, { key: 'other_income', label: 'Outra receita' },
];
export const EXPENSE_CATS: { key: ExpenseCategory; label: string }[] = [
  { key: 'google_ads', label: 'Google Ads' }, { key: 'meta_ads', label: 'Meta Ads' }, { key: 'other_expense', label: 'Outro gasto' },
];
export const ENTRY_CAT: Record<EntryCategory, string> = Object.fromEntries([...INCOME_CATS, ...EXPENSE_CATS].map((c) => [c.key, c.label])) as Record<EntryCategory, string>;

export interface CashEntry {
  id: string; companyId: string; date: string; kind: EntryKind; category: EntryCategory | null; amount: number; currency: Currency; converted: number; note: string | null; createdBy: string | null; attachments: number;
  site?: string | null;         // 0.14: de qual site é a receita/gasto (vai para Comissões)
  competence?: string | null;   // 0.14: mês de referência (YYYY-MM); vazio = mês da data
  grossAmount?: number | null;  // receita lançada SEM o revshare: valor informado (bruto); amount = líquido
  revsharePct?: number | null;  // % descontado pelo dash (null = o valor já veio descontado)
}
export interface CashCompany {
  companyId: string; companyName: string;
  anchor: { date: string; amount: number } | null;   // null = sem saldo conferido: o caixa parte de 0
  since?: string;                                     // 0.15: de quando o caixa conta
  income: number; expenses: number; costsSince: number; deposits: number; withdrawals: number;   // depois do ponto de partida
  balance: number | null;
  entries: CashEntry[];
}
export interface CashMonth {
  month: string; partial: boolean;
  income: number; incomeByCategory: Partial<Record<IncomeCategory, number>>;
  googleAds: number; metaAds: number; otherExpense: number; expenses: number;
  costs: number; costsByCategory: Partial<Record<CostCategory, number>>;
  deposits: number; withdrawals: number;
  result: number; margin: number | null;
  entries: CashEntry[];
  costItems?: CostItem[];   // 0.15: custos fixos do mês como linhas automáticas do caixa
  companies: { companyId: string; income: number; expenses: number; costs: number; result: number }[];
}
/** Custo fixo da aba Custos lançado sozinho no mês (valor real da NF quando lançado, senão o do plano). */
export interface CostItem { costId: string; companyId: string; name: string; category: CostCategory; site: string | null; payDate: string; amount: number; currency: Currency; converted: number; actual: boolean; paid: boolean }
export interface CashOverview {
  currency: Currency; from: string; to: string; companies: { id: string; name: string }[]; selected: string | null;
  cash: { total: number | null; companies: CashCompany[] };
  months: CashMonth[];
  totals: { income: number; googleAds: number; metaAds: number; otherExpense: number; expenses: number; costs: number; deposits: number; withdrawals: number; result: number; margin: number | null };
}
export interface CashEntryInput { id?: string; companyId: string; date: string; kind: EntryKind; category: EntryCategory | null; amount: number; currency: Currency; note?: string | null; site?: string | null; competence?: string | null; revsharePct?: number | null }

export const cashApi = {
  overview: (q: { company?: string; from: string; to: string; currency: Currency }) => api.get<CashOverview>('/finance/overview', q),
  save: ({ id, ...b }: CashEntryInput) => (id ? api.put<{ id: string }>(`/finance/cash/${id}`, b) : api.post<{ id: string }>('/finance/cash', b)),
  remove: (id: string) => api.del<void>(`/finance/cash/${id}`),
  /** 0.15: mesma receita/gasto dividido em vários sites (um lançamento por site, tudo ou nada) */
  split: ({ lines, ...b }: Omit<CashEntryInput, 'id' | 'amount' | 'site'> & { lines: { site: string | null; amount: number; revsharePct?: number | null }[] }) => api.post<{ ids: string[]; total: number }>('/finance/cash/split', { ...b, lines }),
};

/* =====================================================================================
 * Comprovantes (NF, recibo, fatura) de gastos/receitas do caixa e de custos da aba Custos:
 * link do Google Drive ou arquivo PDF/JPG/PNG (até 10 MB), com nº, data e valor da NF para conferir.
 * ===================================================================================== */
export type CostWithAttachments = FinanceCost & { attachments?: number };

/* =====================================================================================
 * Custos com valor que muda (0.12):
 *   - mudança de plano: o novo valor vale a partir de um mês (upgrade/downgrade); os meses de antes ficam como estavam
 *   - valor real do mês: o que veio na fatura/NF daquele mês (uso, proporcional de upgrade, logins a menos…).
 *     Quando lançado, o mês fica "fechado" e esse valor substitui o do plano no fechamento e no caixa.
 * ===================================================================================== */
export interface CostPrice { id: string; from: string; amount: number; note: string | null }
export type CostRow = CostWithAttachments & {
  site?: string | null;             // 0.14: custo de um site só (entra no resultado do site e na comissão)
  prices?: CostPrice[];
  plannedAmount?: number;            // valor do plano no mês escolhido (moeda do custo)
  planChangedFrom?: number | null;   // o plano mudou neste mês: valor anterior
  actualAmount?: number | null;      // valor real lançado pela NF (moeda do custo)
  actualNote?: string | null;
};
export const costMonthApi = {
  close: (a: { id: string; month: string; amount: number; note?: string | null }) => api.put<unknown>(`/finance/costs/${a.id}/months/${a.month}`, { amount: a.amount, note: a.note || null }),
  reopen: (a: { id: string; month: string }) => api.del<void>(`/finance/costs/${a.id}/months/${a.month}`),
  addPrice: (a: { id: string; fromMonth: string; amount: number; note?: string | null }) => api.post<CostPrice>(`/finance/costs/${a.id}/prices`, { fromMonth: a.fromMonth, amount: a.amount, note: a.note || null }),
  removePrice: (a: { id: string; priceId: string }) => api.del<void>(`/finance/costs/${a.id}/prices/${a.priceId}`),
};
export interface Attachment {
  id: string; kind: 'link' | 'file'; url: string | null; filename: string | null; mime: string | null; size: number | null;
  amount: number | null; currency: Currency | null; docNumber: string | null; docDate: string | null; month: string | null; note: string | null;
  entryId: string | null; costId: string | null; createdBy: string | null; createdAt: string;
}
export interface AttachmentTarget { entryId?: string; costId?: string }
export interface AttachmentMeta { month?: string; amount?: number; currency?: Currency; docNumber?: string; docDate?: string; note?: string }
export const MAX_FILE_MB = 10;
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string>;

export const attachmentsApi = {
  // no modo demo o roteador de mocks só repassa o corpo, por isso a lista vai como POST .../list
  list: (t: AttachmentTarget & { month?: string }) => (MOCK ? api.post<{ attachments: Attachment[] }>('/finance/attachments/list', t) : api.get<{ attachments: Attachment[] }>('/finance/attachments', t as Record<string, string>)),
  addLink: (t: AttachmentTarget, url: string, m: AttachmentMeta) => api.post<Attachment>('/finance/attachments', { ...t, ...m, url }),
  /** Envia o arquivo cru (sem base64). No modo demo fica só no navegador. */
  upload: async (t: AttachmentTarget, file: File, m: AttachmentMeta): Promise<Attachment> => {
    if (MOCK) return api.post<Attachment>('/finance/attachments/file', { ...t, ...m, mockFile: { name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file) } });
    const qs = new URLSearchParams(clean({ ...t, ...m, amount: m.amount != null ? String(m.amount) : undefined }));
    const r = await fetch(`/api/finance/attachments/file?${qs}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'upload_failed', j?.error?.message ?? 'Não foi possível enviar o arquivo.');
    return j as Attachment;
  },
  remove: (id: string) => api.del<void>(`/finance/attachments/${id}`),
};
/** Endereço para abrir o comprovante (link do Drive ou o arquivo enviado). */
export const attachmentHref = (a: Attachment) => (a.kind === 'link' || MOCK ? a.url ?? '#' : `/api/finance/attachments/${a.id}/file`);
export const fileSize = (n: number | null) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
