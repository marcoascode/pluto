import { Box, Card, CardHeader, Typography } from '@mui/material';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { MetricValue } from '@/components/ui/Values';
import { METRIC_DEFS, metricValue, type PICKERS } from '@/lib/metrics';
import type { Metrics } from '@/types/api';

/** "Métricas Monetização" com seletor. */
export function MetricsCard({ title, screen, m }: { title: string; screen: keyof typeof PICKERS; m: Metrics }) {
  const ks = usePicked(screen);
  return (
    <Card>
      <CardHeader title={title} action={<MetricPicker screen={screen} />} sx={{ py: 1.25 }} slotProps={{ title: { sx: { fontSize: 14 } } }} />
      {ks.length ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'repeat(auto-fit, minmax(130px, 1fr))' }, gap: '1px', bgcolor: 'divider' }}>
          {ks.map((k) => (
            <Box key={k} sx={{ bgcolor: 'background.paper', px: 2, py: 1.75 }}>
              <Typography variant="caption">{METRIC_DEFS[k].label}{k === 'sessions' && ' *'}</Typography>
              <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18, mt: 0.5 }} component="div"><MetricValue k={k} v={metricValue(m, undefined, k)} /></Typography>
            </Box>
          ))}
        </Box>
      ) : <Typography variant="caption" sx={{ p: 4, display: 'block', textAlign: 'center' }}>Nenhuma métrica selecionada.</Typography>}
    </Card>
  );
}
