import type { Currency } from '@/types/api';

const LOC: Record<Currency, string> = { USD: 'en-US', BRL: 'pt-BR', EUR: 'de-DE' };
const cache = new Map<string, Intl.NumberFormat>();
const nf = (k: string, loc: string, o: Intl.NumberFormatOptions) => {
  let f = cache.get(k);
  if (!f) { f = new Intl.NumberFormat(loc, o); cache.set(k, f); }
  return f;
};
const ok = (v: number | null | undefined): v is number => v != null && isFinite(v);

export const money = (v: number | null | undefined, cur: Currency, d = 2) =>
  ok(v) ? nf(cur + d, LOC[cur], { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : '—';
export const int = (v: number | null | undefined) => (ok(v) ? nf('int', 'pt-BR', { maximumFractionDigits: 0 }).format(Math.round(v)) : '—');
export const pct = (v: number | null | undefined, d = 1) => (ok(v) ? nf('p' + d, 'pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%' : '—');
export const pct0 = (v: number | null | undefined) => (ok(v) ? Math.round(v) + '%' : '—');
export const compactMoney = (v: number, cur: Currency) => {
  const sym = { USD: '$', BRL: 'R$', EUR: '€' }[cur];
  const a = Math.abs(v);
  if (a >= 1e6) return sym + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return sym + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return sym + (a < 10 && a > 0 ? v.toFixed(a < 1 ? 2 : 1) : Math.round(v));
};

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MES[+m - 1]}`; };
export const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${+d} ${MES[+m - 1]} ${y}`; };
export const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
export const relTime = (isoOrNull: string | null) => {
  if (!isoOrNull) return '—';
  const m = Math.round((Date.now() - new Date(isoOrNull).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
};
export const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
