import type { CostCategory } from '@/types/api';
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
