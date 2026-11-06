import { Box, Card, CardContent, CardHeader, Grid, MenuItem, Select, useMediaQuery, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useFilters } from '@/context/FiltersContext';
import { usePrefs } from '@/context/PrefsContext';
import { useDashboard } from '@/hooks/queries';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { AttributionStrip } from '@/components/dashboard/AttributionStrip';
import { MetricsCard } from '@/components/dashboard/MetricsCard';
import { DomainStrip } from '@/components/dashboard/DomainStrip';
import { DailyChart, SpendRevenueChart, useChartHeight } from '@/components/charts/Charts';
import { ErrorBox, PageHead, PageSkeleton, Provisional } from '@/components/ui/States';
import { compactMoney, ddmm, longDate, money, pct } from '@/lib/format';
import { addDays, todayISO } from '@/lib/period';
import type { DailyPoint, Metrics } from '@/types/api';

const DAILY: [keyof Metrics, string][] = [['profit', 'ROI'], ['revenue', 'Receita'], ['ecpm', 'eCPM'], ['roi', 'ROI %'], ['margin', 'Margem'], ['trafficCtr', 'CTR'], ['viewability', 'Viewability'], ['fillRate', 'Fill Rate'], ['dropOffRate', 'Drop-off']];

/** Desktop: período (mín. 14 dias). Celular: sincronizado com a Data do topo. Hoje (parcial) fica fora. */
function chartWindow(daily: DailyPoint[], from: string, to: string, mobile: boolean) {
  const full = daily.filter((d) => !d.partial).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO(); let a = from, b = to === today ? addDays(to, -1) : to;
  const short = (new Date(to).getTime() - new Date(from).getTime()) / 864e5 < 6;
  if (mobile && from === to) { b = from === today ? addDays(from, -1) : from; a = addDays(b, -3); }
  else if (!mobile && short) { b = addDays(today, -1); a = addDays(b, -12); }
  return full.filter((d) => d.date >= a && d.date <= b);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const f = useFilters();
  const { prefs, update } = usePrefs();
  const mobile = useMediaQuery(useTheme().breakpoints.down('md'));
  const h = useChartHeight();
  const { data, error, isLoading, refetch } = useDashboard();
  if (isLoading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return null;
  const win = chartWindow(data.daily, f.from, f.to, mobile);
  const labels = win.map((d) => ddmm(d.date));
  const dm = (prefs.dailyMetric as keyof Metrics) ?? 'profit';
  const dml = DAILY.find((x) => x[0] === dm)?.[1] ?? 'ROI';
  const isMoney = ['profit', 'revenue', 'sessionRpm', 'ecpm'].includes(dm);
  const yM = (v: number) => compactMoney(v, f.currency);
  const fullTip = (i: number): [string, ReactNode][] => { const x = win[i].metrics; return [['Receita', money(x.revenue, f.currency)], ['Despesas (c/ IVA)', money(x.spend, f.currency)], ['IVA', money(x.iva, f.currency)], ['ROI', money(x.profit, f.currency)], ['ROI %', pct(x.roi)], ['Margem', pct(x.margin)], ['RPM de Sessão', money(x.sessionRpm, f.currency)], ['eCPM', money(x.ecpm, f.currency)], ['Viewability', pct(x.viewability)], ['CPC', money(x.cpc, f.currency)], ['CTR', pct(x.trafficCtr, 2)], ['Fill Rate', pct(x.fillRate)], ['Drop-off', pct(x.dropOffRate)]]; };
  const sub = mobile ? (f.from === f.to ? 'Dia selecionado e os 3 anteriores' : 'Mesmo período da data selecionada') + ' · hoje (parcial) fica fora' : 'Por dia · hoje (parcial) fica fora';
  return (
    <>
      <PageHead title={`Olá, ${user?.name.split(' ')[0] ?? ''}`} sub={`${f.domain || 'Todos os domínios'} · ${f.from === f.to ? longDate(f.from) : `${longDate(f.from)} – ${longDate(f.to)}`}`} />
      <Provisional show={f.to >= addDays(todayISO(), -3)} />
      <KpiRow m={data.metrics} cmp={data.comparison} />
      <Box sx={{ mt: 1.75 }}><AttributionStrip m={data.metrics} /></Box>
      <Box sx={{ mt: 1.75 }}><MetricsCard title="Métricas Monetização" screen="home" m={data.metrics} /></Box>
      <Grid container spacing={1.75} sx={{ mt: 0.25 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardHeader title="Despesas vs Receita" subheader={sub} />
            <CardContent><SpendRevenueChart height={h} labels={labels} yfmt={yM} revenue={win.map((d) => d.metrics.revenue)} spend={win.map((d) => d.metrics.spend)}
              tip={(i) => [['Receita', money(win[i].metrics.revenue, f.currency), '#3d8fec'], ['Despesas', money(win[i].metrics.spend, f.currency), '#cf7a2e'], ['ROI', money(win[i].metrics.profit, f.currency)], ['ROI %', pct(win[i].metrics.roi)]]} /></CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardHeader title={dm === 'profit' ? 'Lucro diário' : `${dml} por dia`} subheader={mobile ? sub : 'Passe o mouse para ver todas as métricas do dia'}
            action={<Select size="small" value={dm} onChange={(e) => update({ dailyMetric: e.target.value })} inputProps={{ 'aria-label': 'Métrica do gráfico' }}>{DAILY.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</Select>} />
            <CardContent><DailyChart height={h} labels={labels} name={dml} bars={dm === 'profit'} yfmt={isMoney ? yM : (v) => `${Math.round(v)}%`} tip={fullTip} values={win.map((d) => d.metrics[dm] as number | null)} /></CardContent></Card>
        </Grid>
      </Grid>
      <DomainStrip domains={data.domains} />
    </>
  );
}
