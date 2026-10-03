/** Períodos do botão "Data". Datas calculadas no timezone da organização. */
export type PeriodPreset = 'today' | 'yesterday' | '3d' | '7d' | '14d' | '30d' | 'month' | 'custom';
export const PRESETS: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Hoje' }, { key: 'yesterday', label: 'Ontem' }, { key: '3d', label: 'Últimos 3 dias' },
  { key: '7d', label: 'Últimos 7 dias' }, { key: '14d', label: 'Últimos 14 dias' }, { key: '30d', label: 'Últimos 30 dias' }, { key: 'month', label: 'Mês atual' },
];
export const ORG_TZ = 'America/Sao_Paulo';

export function todayISO(tz = ORG_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function rangeFor(p: PeriodPreset, custom?: { from: string; to: string }): { from: string; to: string } {
  const t = todayISO();
  switch (p) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
    case '3d': return { from: addDays(t, -2), to: t };
    case '7d': return { from: addDays(t, -6), to: t };
    case '14d': return { from: addDays(t, -13), to: t };
    case '30d': return { from: addDays(t, -29), to: t };
    case 'month': return { from: t.slice(0, 8) + '01', to: t };
    default: return custom ?? { from: t, to: t };
  }
}
/** Últimos n meses (YYYY-MM), o atual primeiro. */
export function lastMonths(n: number, today = todayISO()): string[] {
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y--; } }
  return out;
}
const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "2026-10" → "outubro de 2026" */
export const monthLabel = (ym: string) => `${MES_LONGO[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
