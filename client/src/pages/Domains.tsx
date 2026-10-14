import { Card, Grid, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useDomainsSummary } from '@/hooks/queries';
import { DomainCard } from '@/components/dashboard/DomainCard';
import { ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { Money, Profit, RoiChip } from '@/components/ui/Values';
import { domainLabel, int, longDate, pct } from '@/lib/format';

export default function DomainsPage() {
  const f = useFilters();
  const { data, error, isLoading, refetch } = useDomainsSummary();
  if (isLoading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  const list = (data?.domains ?? []).slice().sort((a, b) => b.metrics.profit - a.metrics.profit);
  return (
    <>
      <PageHead title="Domínios / Sites" sub={`${list.length} domínios · ${longDate(f.from)} – ${longDate(f.to)}`} />
      <Grid container spacing={1.75}>{list.map((d, i) => <Grid key={d.domain} size={{ xs: 12, sm: 6, lg: 4 }}><DomainCard d={d} rank={i + 1} rankLabel="lucro" /></Grid>)}</Grid>
      <TableContainer component={Card} sx={{ mt: 1.75 }}>
        <Table>
          <TableHead><TableRow><TableCell>Domínio</TableCell>{['Receita', 'Despesas', 'ROI', 'ROI %', 'Margem', 'RPM Sessão', 'eCPM', 'Sessões', 'Atribuição'].map((h) => <TableCell key={h} align="right">{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{list.map(({ domain, metrics: m }) => (
            <TableRow key={domain}>
              <TableCell><Link component={RouterLink} to={`/dominios/${encodeURIComponent(domain)}`} color="inherit" underline="hover" sx={{ fontWeight: 600 }}>{domainLabel(domain)}</Link></TableCell>
              <TableCell align="right"><Money v={m.revenue} /></TableCell><TableCell align="right"><Money v={m.spend} /></TableCell><TableCell align="right"><Profit v={m.profit} /></TableCell>
              <TableCell align="right"><RoiChip v={m.roi} /></TableCell><TableCell align="right">{pct(m.margin)}</TableCell><TableCell align="right"><Money v={m.sessionRpm} /></TableCell>
              <TableCell align="right"><Money v={m.ecpm} /></TableCell><TableCell align="right">{int(m.sessions)}</TableCell><TableCell align="right">{pct(m.attributionRate)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
