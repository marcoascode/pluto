import { Box, Chip, Tooltip, alpha, useTheme } from '@mui/material';
import { useFilters } from '@/context/FiltersContext';
import { money, pct, pct0 } from '@/lib/format';
import { dropClass, formatMetric, METRIC_DEFS, roiClass, type MetricKey, type RoiClass } from '@/lib/metrics';

/** Cores do ROI: <0 vermelho · 0 cinza · 0–20 neutro · 20–30 verde claro · 30%+ verde forte */
export function useRoiColors() {
  const { pluto: p } = useTheme();
  return (c: RoiClass) => ({
    pos: { bg: p.posStrong, fg: '#eefff6', text: p.pos },
    'pos-lite': { bg: alpha('#86efac', 0.14), fg: p.posLite, text: p.posLite },
    lo: { bg: alpha(p.na, 0.12), fg: p.fg2, text: p.fg },
    neg: { bg: alpha(p.neg, 0.15), fg: p.neg, text: p.neg },
    na: { bg: alpha(p.na, 0.14), fg: p.na, text: p.fg },
  })[c];
}
export function RoiChip({ v }: { v: number | null | undefined }) {
  const col = useRoiColors()(roiClass(v));
  return <Chip size="small" label={v == null ? '—' : pct0(v)} sx={{ minWidth: 50, bgcolor: col.bg, color: col.fg }} />;
}
export function RoiText({ v }: { v: number | null | undefined }) {
  const col = useRoiColors()(roiClass(v));
  return <Box component="span" sx={{ color: col.text }}>{pct(v)}</Box>;
}
/** Drop-off colorido: normal até 12% · amarelo 12–20% · vermelho 20%+. */
export function DropOff({ v }: { v: number | null | undefined }) {
  const { pluto: p } = useTheme();
  const c = dropClass(v);
  const tip = c === 'bad' ? 'Acima de 20%: verificar a página' : c === 'warn' ? 'Entre 12% e 20%: atenção' : 'Respostas servidas que não viraram impressão';
  return <Tooltip title={tip}><Box component="span" sx={{ color: c === 'bad' ? p.neg : c === 'warn' ? p.warn : 'inherit', fontWeight: c === 'bad' ? 700 : c === 'warn' ? 600 : 'inherit' }}>{pct(v)}</Box></Tooltip>;
}
/** ROI em texto (sem chip), arredondado — usado nos relatórios. */
export function RoiText0({ v }: { v: number | null | undefined }) {
  const col = useRoiColors()(roiClass(v));
  return <Box component="span" sx={{ color: col.text }}>{pct0(v)}</Box>;
}
export function Profit({ v }: { v: number | null | undefined }) {
  const { currency } = useFilters();
  const { pluto: p } = useTheme();
  if (v == null) return <>—</>;
  return <Box component="span" sx={{ color: v > 0.005 ? p.pos : v < -0.005 ? p.neg : 'inherit' }}>{money(v, currency)}</Box>;
}
export function Money({ v, d = 2 }: { v: number | null | undefined; d?: number }) {
  const { currency } = useFilters();
  return <>{money(v, currency, d)}</>;
}
export function MetricValue({ k, v }: { k: MetricKey; v: number | null }) {
  const { currency } = useFilters();
  const kind = METRIC_DEFS[k].kind;
  if (kind === 'chip') return <RoiChip v={v} />;
  if (kind === 'profit') return <Profit v={v} />;
  if (kind === 'drop') return <DropOff v={v} />;
  return <>{formatMetric(k, v, currency)}</>;
}
/** ▲/▼ vs período anterior. pp = pontos percentuais (ROI, Margem). neutral = sem cor (Spend). */
export function Delta({ cur, prev, pp, neutral, title }: { cur: number | null; prev: number | null | undefined; pp?: boolean; neutral?: boolean; title?: string }) {
  const { pluto: p } = useTheme();
  let label = '—', color = p.na, bg = alpha(p.na, 0.14);
  if (prev != null && cur != null && (pp || prev !== 0)) {
    const d = pp ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
    const up = d >= 0;
    label = `${up ? '▲' : '▼'} ${pp ? Math.abs(d).toFixed(1).replace('.', ',') + ' p.p.' : Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0).replace('.', ',') + '%'}`;
    if (!neutral && Math.abs(d) >= 0.5) { color = up ? p.pos : p.neg; bg = alpha(up ? p.pos : p.neg, 0.15); }
  }
  return <Tooltip title={title ?? 'Sem comparação'}><Chip size="small" label={label} sx={{ height: 20, fontSize: 11.5, color, bgcolor: bg }} /></Tooltip>;
}
export function CountryCode({ c }: { c: string }) {
  const { pluto: p } = useTheme();
  return <Box component="span" sx={{ display: 'inline-grid', placeItems: 'center', width: 26, height: 18, borderRadius: 1, bgcolor: p.panel3, fontSize: 10.5, fontWeight: 600, fontFamily: p.mono, color: p.fg2, mr: 0.75 }}>{c}</Box>;
}
