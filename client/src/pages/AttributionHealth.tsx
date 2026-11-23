import { Box, Button, Card, CardContent, CardHeader, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useTheme } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import { LineChart } from '@mui/x-charts/LineChart';
import { Link as RouterLink } from 'react-router-dom';
import { useHealth } from '@/hooks/queries';
import { useChartHeight } from '@/components/charts/Charts';
import { ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { Money } from '@/components/ui/Values';
import { TrackerCodeButton } from '@/components/attribution/TrackerCodeDialog';
import { ddmm, int, pct } from '@/lib/format';

export default function AttributionHealthPage() {
  const { pluto: p } = useTheme();
  const h = useChartHeight(230);
  const { data, error, isLoading, refetch } = useHealth();
  if (isLoading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return null;
  const m = data.metrics; const r = m.attributionRate ?? 0;
  const tone = (x: number) => (x >= 95 ? 'pos' : x >= 90 ? 'warn' : 'neg') as 'pos';
  const daily = data.daily.slice().sort((a, b) => a.date.localeCompare(b.date));
  const kpi = (l: string, v: React.ReactNode, color?: string, extra?: React.ReactNode) => (
    <Grid size={{ xs: 6, md: 3 }}><Card sx={{ p: 2.25, height: '100%' }}><Typography variant="caption">{l}</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: { xs: 21, md: 28 }, color }}>{v}</Typography>{extra}</Card></Grid>
  );
  return (
    <>
      <PageHead title="Attribution Health" sub="Diagnóstico da atribuição. Receita sem UTM nem rastreador nunca é distribuída entre campanhas; ela fica aqui, separada." right={<TrackerCodeButton />} />
      <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
        {kpi('Attribution Rate', pct(m.attributionRate), undefined, <Box sx={{ mt: 0.5 }}><Tag tone={tone(r)}>{r >= 95 ? 'Confiável' : r >= 90 ? 'Atenção' : 'Verificar UTMs'}</Tag></Box>)}
        {kpi('Revenue total', <Money v={m.revenue} cur="USD" />)}{kpi('Atribuída', <Money v={m.attributedRevenue} cur="USD" />, p.pos)}{kpi('Não atribuída', <Money v={m.unattributedRevenue} cur="USD" />, p.warn)}
      </Grid>
      <Card>
        <CardHeader title="Problemas encontrados" subheader="Ordenados por impacto em receita" action={<Button size="small" variant="outlined" startIcon={<BugReportOutlinedIcon />} component={RouterLink} to="/utm-debugger">Testar uma URL</Button>} />
        {data.issues.map((i) => (
          <Grid container key={i.type} spacing={2} sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Grid size={{ xs: 12, md: 4 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} ><WarningAmberRoundedIcon sx={{ color: i.revenue / Math.max(1, m.revenue) > 0.01 ? p.warn : p.muted, fontSize: 20 }} /><Typography variant="h3">{i.title}</Typography></Stack><Typography variant="caption" sx={{ mt: 0.75, display: 'block' }}>Domínio: {i.domains.join(', ')}</Typography></Grid>
            <Grid size={{ xs: 12, md: 3 }}><Stack direction="row" spacing={3}>
              <Box><Typography variant="overline">Quantidade</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18 }}>{int(i.sessions)}</Typography><Typography variant="caption">sessões</Typography></Box>
              <Box><Typography variant="overline">Impacto</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18, color: p.warn }}><Money v={i.revenue} cur="USD" /></Typography><Typography variant="caption">{pct((i.revenue / m.revenue) * 100, 2)} da receita</Typography></Box>
            </Stack></Grid>
            <Grid size={{ xs: 12, md: 5 }}><Typography variant="overline">Possível problema</Typography><Typography color="text.secondary">{i.cause}</Typography><Typography variant="overline" component="div" sx={{ mt: 1 }}>Ação</Typography><Typography>{i.action}</Typography></Grid>
          </Grid>
        ))}
        {!data.issues.length && <Typography variant="caption" sx={{ p: 4, display: 'block', textAlign: 'center' }}>Nenhum problema no período.</Typography>}
      </Card>
      <Grid container spacing={1.75} sx={{ mt: 0.25 }}>
        <Grid size={{ xs: 12, md: 6 }}><Card><CardHeader title="Attribution Rate por dia" /><CardContent>
          <LineChart height={h} skipAnimation hideLegend grid={{ horizontal: true }} margin={{ left: 8, right: 16, top: 12, bottom: 4 }}
            xAxis={[{ scaleType: 'point', data: daily.map((d) => ddmm(d.date)) }]} yAxis={[{ min: 0, max: 100, valueFormatter: (v: number) => `${v}%`, width: 44 }]}
            series={[{ data: daily.map((d) => d.attributionRate), label: 'Attribution Rate', color: p.pos, showMark: false, valueFormatter: (v) => pct(v) }]}
            sx={{ '& .MuiChartsAxis-tickLabel': { fill: p.muted }, '& .MuiChartsGrid-line': { stroke: p.line } }} />
        </CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 6 }}><TableContainer component={Card}><Table>
          <TableHead><TableRow><TableCell>Domínio</TableCell><TableCell align="right">Receita</TableCell><TableCell align="right">Não atribuída</TableCell><TableCell align="right">Rate</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
          <TableBody>{data.domains.slice().sort((a, b) => (a.attributionRate ?? 0) - (b.attributionRate ?? 0)).map((d) => (
            <TableRow key={d.domain}><TableCell>{d.domain} {!d.registered && <Tag tone="warn">não cadastrado</Tag>}</TableCell><TableCell align="right"><Money v={d.revenue} cur="USD" /></TableCell><TableCell align="right" sx={{ color: 'warning.main' }}><Money v={d.unattributed} cur="USD" /></TableCell><TableCell align="right">{pct(d.attributionRate)}</TableCell><TableCell><Tag tone={tone(d.attributionRate ?? 0)}>{(d.attributionRate ?? 0) >= 95 ? 'OK' : (d.attributionRate ?? 0) >= 90 ? 'Atenção' : 'Verificar'}</Tag></TableCell></TableRow>
          ))}</TableBody>
        </Table></TableContainer></Grid>
      </Grid>
    </>
  );
}
