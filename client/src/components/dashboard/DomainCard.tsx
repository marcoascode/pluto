import { Avatar, Box, Card, CardActionArea, Chip, Grid, LinearProgress, Stack, Typography, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Money, Profit, RoiChip, RoiText, useRoiColors } from '@/components/ui/Values';
import { domainLabel, pct, pct0 } from '@/lib/format';
import { roiClass } from '@/lib/metrics';
import { RetentionLine } from '@/components/ui/Retention';
import type { DomainSummary } from '@/types/api';

const hue = (d: string) => { let h = 7; for (const c of d) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const init = (d: string) => { const b = d.split('.')[0]; const up = b.slice(1).match(/[A-Z0-9]/); return (b[0] + (up ? up[0] : b[1] ?? '')).toUpperCase(); };

export function DomainCard({ d, rank, rankLabel }: { d: DomainSummary; rank?: number; rankLabel?: string }) {
  const { pluto: p } = useTheme();
  const m = d.metrics; const h = hue(d.domain);
  const col = useRoiColors()(roiClass(m.roi));
  const w = Math.max(2, Math.min(100, (Math.abs(m.roi ?? 0) / 80) * 100));
  const stat = (l: string, v: React.ReactNode) => <Grid size={4}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600, fontSize: 14.5 }}>{v}</Typography></Grid>;
  return (
    <Card sx={{ height: '100%', transition: '.15s', '&:hover': { borderColor: p.accent, transform: 'translateY(-2px)' } }}>
      <CardActionArea component={RouterLink} to={`/dominios/${encodeURIComponent(d.domain)}`} sx={{ p: 2, height: '100%' }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }} >
          <Avatar variant="rounded" sx={{ width: 36, height: 36, fontFamily: 'Sora', fontWeight: 700, fontSize: 15, color: '#fff', borderRadius: 2.5, background: `linear-gradient(135deg,hsl(${h} 62% 50%),hsl(${(h + 36) % 360} 58% 32%))` }}>{init(d.domain)}</Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h3" sx={{ fontSize: 15, overflowWrap: 'anywhere' }}>{domainLabel(d.domain)}</Typography>
            {rank && <Chip size="small" variant="outlined" label={`#${rank} em ${rankLabel}`} sx={{ height: 18, fontSize: 11, fontWeight: 500, mt: 0.25, color: rank === 1 ? '#f2c94c' : 'text.secondary', borderColor: rank === 1 ? 'rgba(242,201,76,.5)' : p.line2 }} />}
          </Box>
          <RoiChip v={m.roi} />
        </Stack>
        <Grid container spacing={1.25} sx={{ mt: 1.25 }}>
          {stat('Receita', <Money v={m.revenue} />)}{stat('Despesas', <Money v={m.spend} />)}{stat('ROI', <Profit v={m.profit} />)}
          {stat('ROI %', <RoiText v={m.roi} />)}{stat('Margem', pct(m.margin))}{stat('eCPM', <Money v={m.ecpm} />)}
        </Grid>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 1.5 }}>
          <Typography variant="caption" sx={{ width: 56 }}>ROI</Typography>
          <LinearProgress variant="determinate" value={w} sx={{ flex: 1, '& .MuiLinearProgress-bar': { bgcolor: col.text === p.fg ? p.na : col.text } }} />
          <Typography sx={{ fontWeight: 600, fontSize: 12.5, minWidth: 44, textAlign: 'right' }}>{pct0(m.roi)}</Typography>
        </Stack>
        <RetentionLine m={m} />
      </CardActionArea>
    </Card>
  );
}
