import { Avatar, Box, Button, Card, CardContent, CardHeader, Chip, Grid, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useCompanyOverview } from '@/hooks/queries';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { SpendRevenueChart, DailyChart, useChartHeight } from '@/components/charts/Charts';
import { ErrorBox, PageHead, PageSkeleton, Provisional, Tag } from '@/components/ui/States';
import { Money, Profit, RoiChip } from '@/components/ui/Values';
import { compactMoney, ddmm, initials, longDate, money, pct, pct0 } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/roles';
import { addDays, todayISO } from '@/lib/period';
import type { CompanyOverviewResponse, Metrics } from '@/types/api';

/**
 * Painel da Empresa (/empresas/:id): sócios, totais, série diária e Squads → domínios → gestores.
 * Mesma regra de acesso do resto do painel (o servidor responde 403 se a Empresa não for visível).
 */
export default function CompanyOverviewPage() {
  const { id = '' } = useParams();
  const f = useFilters();
  const { pluto: p } = useTheme();
  const h = useChartHeight(230);
  const { data, error, isLoading, refetch } = useCompanyOverview(id);
  if (isLoading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return null;
  const days = data.daily.filter((d) => !d.partial).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const labels = days.map((d) => ddmm(d.date));
  const yM = (v: number) => compactMoney(v, 'BRL');
  const nDom = data.squads.reduce((a, s) => a + s.domains.length, 0);
  const filtered = f.company === data.company.id;
  return (
    <>
      <PageHead
        crumb="Empresa"
        title={<Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}><ApartmentRoundedIcon sx={{ color: p.accent }} /><span>{data.company.name}</span></Stack>}
        sub={`${data.squads.length} Squad${data.squads.length === 1 ? '' : 's'} · ${nDom} domínio${nDom === 1 ? '' : 's'} · ${f.from === f.to ? longDate(f.from) : `${longDate(f.from)} – ${longDate(f.to)}`}`}
        right={filtered
          ? <Chip icon={<FilterAltRoundedIcon />} label="O painel inteiro está filtrado por esta Empresa" sx={{ bgcolor: alpha(p.accent, 0.14), color: p.accent }} />
          : <Button variant="outlined" startIcon={<FilterAltRoundedIcon />} onClick={() => f.setCompany(data.company.id)}>Filtrar o painel por esta Empresa</Button>}
      />
      <Provisional show={f.to >= addDays(todayISO(), -3)} />
      <Card sx={{ mb: 1.75 }}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.5 }}>
          <Typography variant="overline" sx={{ mr: 0.5 }}>Sócios</Typography>
          {data.company.partners.map((s) => (
            <Stack key={s.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 600, background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' }}>{initials(s.name)}</Avatar>
              <Box><Typography sx={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.2 }}>{s.name}</Typography><Typography variant="caption">{ROLE_LABEL[s.role] ?? s.role}</Typography></Box>
            </Stack>
          ))}
          {!data.company.partners.length && <Typography variant="caption">Nenhum sócio cadastrado (Admin → Usuários & Squads → Empresas).</Typography>}
        </Stack>
      </Card>
      <KpiRow m={data.totals} cmp={data.comparison} />
      <Grid container spacing={1.75} sx={{ mt: 0.25 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardHeader title="Despesas vs Receita" subheader="Por dia · hoje (parcial) fica fora" />
            <CardContent><SpendRevenueChart height={h} labels={labels} yfmt={yM} revenue={days.map((d) => d.metrics.revenueBrl)} spend={days.map((d) => d.metrics.spend)}
              tip={(i) => [['Receita', `${money(days[i].metrics.revenue, 'USD')} · ${money(days[i].metrics.revenueBrl, 'BRL')}`, '#3d8fec'], ['Despesas', money(days[i].metrics.spend, 'BRL'), '#cf7a2e'], ['ROI', money(days[i].metrics.profit, 'BRL')], ['ROI %', pct(days[i].metrics.roi)]]} /></CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardHeader title="Lucro diário" subheader="Soma de todos os Squads da Empresa" />
            <CardContent><DailyChart height={h} labels={labels} name="Lucro" bars yfmt={yM} values={days.map((d) => d.metrics.profit)}
              tip={(i) => [['ROI', money(days[i].metrics.profit, 'BRL')], ['ROI %', pct(days[i].metrics.roi)], ['Margem', pct(days[i].metrics.margin)]]} /></CardContent></Card>
        </Grid>
      </Grid>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mt: 3, mb: 1.25 }}>
        <Typography variant="h2">Squads e domínios</Typography>
        <Typography variant="caption">Clique no domínio para abrir as campanhas dele</Typography>
      </Stack>
      <Stack spacing={1.75}>
        {data.squads.map((s) => <SquadCard key={s.id} s={s} />)}
        {!data.squads.length && <Card><CardContent><Typography variant="caption">Esta Empresa ainda não tem Squads com domínios que você possa ver.</Typography></CardContent></Card>}
      </Stack>
    </>
  );
}

type Sq = CompanyOverviewResponse['squads'][number];
type K = 'domain' | 'revenue' | 'spend' | 'profit' | 'margin' | 'roi';
function SquadCard({ s }: { s: Sq }) {
  const theme = useTheme(); const p = theme.pluto;
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [sort, setSort] = useState<{ k: K; d: 'asc' | 'desc' }>({ k: 'revenue', d: 'desc' });
  const rows = useMemo(() => s.domains.slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'domain') return a.domain.localeCompare(b.domain) * dir;
    return (((a.metrics[sort.k] as number | null) ?? -Infinity) - ((b.metrics[sort.k] as number | null) ?? -Infinity)) * dir;
  }), [s, sort]);
  const head = (k: K, l: string, num = true) => <TableCell align={num ? 'right' : 'left'}><TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel></TableCell>;
  const m: Metrics = s.metrics;
  const gest = (g: { id: string; name: string }[]) => g.length
    ? <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>{g.map((x) => <Chip key={x.id} size="small" label={x.name} sx={{ height: 20, fontSize: 11, bgcolor: p.panel3 }} />)}</Stack>
    : <Typography variant="caption" component="div">sem gestor</Typography>;
  return (
    <Card>
      <CardHeader title={s.name} subheader={`${s.domains.length} domínio${s.domains.length === 1 ? '' : 's'}`}
        action={<Stack direction="row" spacing={2} sx={{ alignItems: 'center', pr: 1, display: { xs: 'none', sm: 'flex' } }}>
          {([['Receita', <Money key="r" v={m.revenue} cur="USD" />], ['Despesas', <Money key="s" v={m.spend} cur="BRL" />], ['ROI', <Profit key="p" v={m.profit} />]] as const).map(([l, v]) => <Box key={l} sx={{ textAlign: 'right' }}><Typography variant="caption" component="div">{l}</Typography><Typography sx={{ fontWeight: 600 }} component="div">{v}</Typography></Box>)}
          <RoiChip v={m.roi} />
        </Stack>} />
      {mobile ? (
        <Box>{rows.map((d) => (
          <Box key={d.domain} sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', boxShadow: d.metrics.profit < 0 && d.metrics.spend > 0 ? `inset 3px 0 0 ${p.neg}` : 'none' }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Box><Link component={RouterLink} to={`/dominios/${encodeURIComponent(d.domain)}`} underline="hover" sx={{ fontWeight: 600 }}>{d.domain}</Link>{gest(d.gestores)}</Box><RoiChip v={d.metrics.roi} /></Stack>
            <Grid container spacing={1} sx={{ mt: 1 }}>{([['Receita', <Money key="r" v={d.metrics.revenue} cur="USD" />], ['Despesas', <Money key="s" v={d.metrics.spend} cur="BRL" />], ['ROI', <Profit key="p" v={d.metrics.profit} />]] as const).map(([l, v]) => <Grid key={l} size={4}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600 }}>{v}</Typography></Grid>)}</Grid>
          </Box>
        ))}</Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>{head('domain', 'Domínio', false)}{head('revenue', 'Receita')}{head('spend', 'Despesas')}{head('profit', 'ROI')}{head('margin', 'Margem')}{head('roi', 'ROI %')}</TableRow></TableHead>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.domain} hover>
                  <TableCell sx={{ boxShadow: d.metrics.profit < 0 && d.metrics.spend > 0 ? `inset 3px 0 0 ${p.neg}` : d.metrics.profit > 0 ? `inset 3px 0 0 ${p.pos}` : 'none' }}>
                    <Link component={RouterLink} to={`/dominios/${encodeURIComponent(d.domain)}`} underline="hover" sx={{ fontWeight: 600 }}>{d.domain}</Link>
                    <Tooltip title="Gestores do domínio"><Box>{gest(d.gestores)}</Box></Tooltip>
                  </TableCell>
                  <TableCell align="right"><Money v={d.metrics.revenue} cur="USD" /></TableCell>
                  <TableCell align="right"><Money v={d.metrics.spend} cur="BRL" /></TableCell>
                  <TableCell align="right"><Profit v={d.metrics.profit} /></TableCell>
                  <TableCell align="right">{d.metrics.margin == null ? '—' : <Tag tone={d.metrics.margin < 0 ? 'neg' : d.metrics.margin < 30 ? 'warn' : 'pos'}>{pct0(d.metrics.margin)}</Tag>}</TableCell>
                  <TableCell align="right"><RoiChip v={d.metrics.roi} /></TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 600 } }}>
                <TableCell>Total · {s.name}</TableCell><TableCell align="right"><Money v={m.revenue} cur="USD" /></TableCell><TableCell align="right"><Money v={m.spend} cur="BRL" /></TableCell>
                <TableCell align="right"><Profit v={m.profit} /></TableCell><TableCell align="right">{pct0(m.margin)}</TableCell><TableCell align="right"><RoiChip v={m.roi} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}
