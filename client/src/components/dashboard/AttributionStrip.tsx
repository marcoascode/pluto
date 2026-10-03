import { Box, Button, Card, LinearProgress, Stack, Typography, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Money } from '@/components/ui/Values';
import { Tag } from '@/components/ui/States';
import { pct } from '@/lib/format';
import type { Metrics } from '@/types/api';

export function AttributionStrip({ m }: { m: Metrics }) {
  const { pluto: p } = useTheme();
  const r = m.attributionRate;
  const tone = r == null ? 'na' : r >= 95 ? 'pos' : r >= 90 ? 'warn' : 'neg';
  const lab = { pos: 'Confiável', warn: 'Atenção', neg: 'Verificar UTMs', na: 'Sem dados' }[tone];
  const cell = (l: string, v: React.ReactNode, color?: string) => (
    <Box sx={{ px: 2.25, py: 1.5, borderRight: { md: 1 }, borderColor: 'divider', width: { xs: '50%', md: 'auto' } }}>
      <Typography variant="caption">{l}</Typography>
      <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 17, color }}>{v}</Typography>
    </Box>
  );
  return (
    <Card>
      <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center' }} >
        {cell('Revenue total', <Money v={m.revenue} />)}
        {cell('Atribuída', <Money v={m.attributedRevenue} />, p.pos)}
        {cell('Não atribuída', <Money v={m.unattributedRevenue} />, p.warn)}
        <Box sx={{ px: 2.25, py: 1.5, width: { xs: '50%', md: 'auto' } }}>
          <Typography variant="caption">Attribution Rate</Typography>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 17 }}>{pct(r)}</Typography>
          <LinearProgress variant="determinate" value={Math.min(100, r ?? 0)} color={tone === 'pos' ? 'success' : tone === 'warn' ? 'warning' : 'error'} sx={{ width: 140, mt: 0.75 }} />
        </Box>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: { md: 'flex-end' }, flex: 1, px: 2.25, py: 1.25 }}>
          <Tag tone={tone as 'pos'}>{lab}</Tag>
          <Button size="small" variant="outlined" component={RouterLink} to="/atribuicao">Ver saúde da atribuição</Button>
        </Stack>
      </Stack>
    </Card>
  );
}
