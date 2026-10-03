import { Box, Card, Grid, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { longDate, money, pct, pct0 } from '@/lib/format';
import { roiClass } from '@/lib/metrics';
import { Delta, useRoiColors } from '@/components/ui/Values';
import type { Comparison, Metrics } from '@/types/api';

/** Revenue | Spend | Profit | ROI | Margem — com variação vs período anterior. */
export function KpiRow({ m, cmp, split = true }: { m: Metrics; cmp: Comparison | null; split?: boolean }) {
  const { currency } = useFilters();
  const { pluto: p } = useTheme();
  const roiCol = useRoiColors()(roiClass(m.roi));
  const prev = cmp?.metrics;
  const title = cmp ? `vs ${longDate(cmp.from)} – ${longDate(cmp.to)}` : 'Dia em andamento: sem comparação';
  const gp = m.spend ? (m.googleSpend / m.spend) * 100 : 0;
  const glow = (c: string) => `radial-gradient(260px 140px at 100% 0%, ${c}, transparent 70%), linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,0) 140px), ${p.panel}`;
  const card = (label: string, value: string, delta: ReactNode, o: { bg?: string; color?: string; extra?: ReactNode; first?: boolean } = {}) => (
    <Grid size={{ xs: o.first ? 12 : 6, md: 4, lg: 'grow' }}>
      <Card sx={{ height: '100%', p: { xs: 1.75, md: 2.25 }, pb: { xs: 1.5, md: 1.75 }, background: o.bg }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }} ><Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontWeight: 500 }}>{label}</Typography>{delta}</Stack>
        <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: { xs: o.first ? 28 : 21, md: 28 }, letterSpacing: '-.02em', mt: 0.5, color: o.color }}>{value}</Typography>
        {o.extra}
      </Card>
    </Grid>
  );
  return (
    <Grid container spacing={{ xs: 1.25, md: 1.75 }}>
      {card('Revenue', money(m.revenue, currency), <Delta cur={m.revenue} prev={prev?.revenue} title={title} />, { bg: glow('rgba(61,143,236,.22)'), first: true })}
      {card('Spend', money(m.spend, currency), <Delta cur={m.spend} prev={prev?.spend} neutral title={title} />, {
        extra: split && m.spend > 0 && (
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption">Google <b style={{ color: p.fg2 }}>{money(m.googleSpend, currency, 0)}</b> · Meta <b style={{ color: p.fg2 }}>{money(m.metaSpend, currency, 0)}</b></Typography>
            <Tooltip title={`Google ${pct0(gp)} · Meta ${pct0(100 - gp)}`}><Stack direction="row" spacing={0.25} sx={{ height: 5, mt: 0.75, borderRadius: 1, overflow: 'hidden' }}><Box sx={{ width: `${gp}%`, bgcolor: p.rev }} /><Box sx={{ flex: 1, bgcolor: p.spend }} /></Stack></Tooltip>
          </Box>),
      })}
      {card('Profit', money(m.profit, currency), <Delta cur={m.profit} prev={prev?.profit} title={title} />, { bg: glow(m.profit < 0 ? 'rgba(255,107,122,.16)' : 'rgba(52,211,153,.16)'), color: m.profit > 0 ? p.pos : m.profit < 0 ? p.neg : undefined })}
      {card('ROI', pct(m.roi), <Delta cur={m.roi} prev={prev?.roi} pp title={title} />, { color: roiCol.text })}
      {card('Margem', pct(m.margin), <Delta cur={m.margin} prev={prev?.margin} pp title={title} />)}
    </Grid>
  );
}
