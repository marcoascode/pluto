import { Box, Card, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useGam } from '@/hooks/queries';
import { MetricsCard } from '@/components/dashboard/MetricsCard';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { MetricValue, Money } from '@/components/ui/Values';
import { longDate } from '@/lib/format';
import { METRIC_DEFS, metricValue } from '@/lib/metrics';

export default function AdManagerPage() {
  const f = useFilters();
  const ms = usePicked('gam');
  const { data, error, isLoading, refetch } = useGam();
  if (isLoading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return null;
  return (
    <>
      <PageHead title="Google Ad Manager" sub={`${data.network.name} · ${longDate(f.from)} – ${longDate(f.to)}`} />
      <MetricsCard title="Métricas Monetização" screen="home" m={data.metrics} />
      <Card sx={{ mt: 1.75 }}>
        <Stack direction="row" sx={{ alignItems: 'center', p: 1.75, borderBottom: 1, borderColor: 'divider' }}><Typography variant="h2">Por domínio</Typography><Box sx={{ flex: 1 }} /><MetricPicker screen="gam" /></Stack>
        <TableContainer><Table>
          <TableHead><TableRow><TableCell>Domínio</TableCell>{ms.map((k) => <TableCell key={k} align="right">{METRIC_DEFS[k].label}</TableCell>)}<TableCell align="right">Não atribuída</TableCell></TableRow></TableHead>
          <TableBody>{data.domains.map((d) => (
            <TableRow key={d.domain}><TableCell><Link component={RouterLink} to={`/dominios/${encodeURIComponent(d.domain)}`} color="inherit" underline="hover">{d.domain}</Link></TableCell>
              {ms.map((k) => <TableCell key={k} align="right"><MetricValue k={k} v={metricValue(d.metrics, undefined, k)} /></TableCell>)}
              <TableCell align="right" sx={{ color: 'warning.main' }}><Money v={d.metrics.unattributedRevenue} cur="USD" /></TableCell></TableRow>
          ))}</TableBody>
        </Table></TableContainer>
      </Card>
      <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>eCPM = Receita ÷ Impressões × 1000 (Ad Manager).</Typography>
    </>
  );
}
