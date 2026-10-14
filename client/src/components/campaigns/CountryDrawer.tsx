import { Alert, Box, Card, Drawer, Grid, IconButton, LinearProgress, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography, useMediaQuery, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useMemo, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useCampaignCountries } from '@/hooks/queries';
import { ErrorBox } from '@/components/ui/States';
import { CountryCode, Money, Profit, RoiChip } from '@/components/ui/Values';
import { money, pct0, shortDate } from '@/lib/format';
import type { CampaignRow, CountryRow } from '@/types/api';

type K = 'name' | 'spend' | 'revenue' | 'profit' | 'roi' | 'sessionRpm';

/** 🌐 Países da campanha: quem dá lucro, quem dá prejuízo, quanto gastou e quanto voltou. */
export function CountryDrawer({ c, onClose }: { c: CampaignRow; onClose: () => void }) {
  const theme = useTheme(); const p = theme.pluto;
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const { from, to, currency } = useFilters();
  const { data, error, refetch } = useCampaignCountries(c.platform, c.id);
  const [sort, setSort] = useState<{ k: K; d: 'asc' | 'desc' }>({ k: 'profit', d: 'desc' });
  const rows = useMemo(() => (data?.countries ?? []).slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'name') return a.name.localeCompare(b.name) * dir;
    return (((a.metrics[sort.k] as number | null) ?? -Infinity) - ((b.metrics[sort.k] as number | null) ?? -Infinity)) * dir;
  }), [data, sort]);
  const tot = data?.totals;
  const loss = rows.filter((x) => x.metrics.profit < 0); const lossSum = loss.reduce((a, b) => a + b.metrics.profit, 0);
  const mxP = Math.max(1, ...rows.map((x) => Math.abs(x.metrics.profit)));
  const share = (x: CountryRow) => (tot?.spend ? pct0((x.metrics.spend / tot.spend) * 100) : '—');
  const head = (k: K, l: string, num = true) => <TableCell align={num ? 'right' : 'left'}><TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel></TableCell>;
  return (
    <Drawer anchor={mobile ? 'bottom' : 'right'} open onClose={onClose} slotProps={{ paper: { sx: mobile ? { height: '88%', borderRadius: '20px 20px 0 0' } : { width: 'min(760px, 100%)' } } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">{c.platform === 'google' ? 'Google Ads' : 'Meta Ads'} · {c.domain} · {shortDate(from)} – {shortDate(to)}</Typography><Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{c.name}</Typography></Box>
        <IconButton size="small" onClick={onClose} aria-label="Fechar"><CloseRoundedIcon fontSize="small" /></IconButton>
      </Stack>
      <Stack spacing={1.75} sx={{ p: 2, overflow: 'auto' }}>
        {error && <ErrorBox error={error} retry={() => refetch()} />}
        {!data && !error && <><Skeleton variant="rounded" height={64} /><Skeleton variant="rounded" height={220} /></>}
        {data && tot && (
          <>
            <Grid container spacing={1.25}>
              {([['Despesas', <Money key="s" v={tot.spend} />], ['Receita', <Money key="r" v={tot.revenue} />], ['ROI', <Profit key="p" v={tot.profit} />], ['ROI %', <RoiChip key="o" v={tot.roi} />]] as const).map(([l, v]) => (
                <Grid key={l} size={{ xs: 6, md: 3 }}><Card sx={{ p: 1.5, bgcolor: p.panel2, background: p.panel2 }}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600, fontSize: 16 }}>{v}</Typography></Card></Grid>
              ))}
            </Grid>
            {loss.length ? (
              <Alert severity="warning" variant="outlined">
                <b>{loss.length} {loss.length > 1 ? 'países' : 'país'} com prejuízo: {loss.map((x) => x.country).join(', ')}</b> ({money(lossSum, currency)}).
                <Typography variant="body2" color="text.secondary">Sem eles, o lucro do período seria {money(tot.profit - lossSum, currency)}. Considere tirar da segmentação se o padrão se repetir em D-1 a D-3.</Typography>
              </Alert>
            ) : <Alert severity="success" variant="outlined">Todos os países da campanha deram lucro no período.</Alert>}
            {mobile ? (
              <Card>{rows.map((x) => (
                <Box key={x.country} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', boxShadow: x.metrics.profit < 0 ? `inset 3px 0 0 ${p.neg}` : 'none' }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }} ><Box><CountryCode c={x.country} />{x.name}<Typography variant="caption" component="div">{share(x)} do spend</Typography></Box><RoiChip v={x.metrics.roi} /></Stack>
                  <Grid container spacing={1} sx={{ mt: 1 }}>{([['Despesas', <Money key="s" v={x.metrics.spend} />], ['Receita', <Money key="r" v={x.metrics.revenue} />], ['ROI', <Profit key="p" v={x.metrics.profit} />], ['RPM Sessão', <Money key="q" v={x.metrics.sessionRpm} />]] as const).map(([l, v]) => <Grid key={l} size={6}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600 }}>{v}</Typography></Grid>)}</Grid>
                </Box>
              ))}</Card>
            ) : (
              <TableContainer component={Card}>
                <Table size="small">
                  <TableHead><TableRow>{head('name', 'País', false)}{head('spend', 'Despesas')}{head('revenue', 'Receita')}{head('profit', 'ROI')}{head('sessionRpm', 'RPM Sessão')}{head('roi', 'ROI %')}</TableRow></TableHead>
                  <TableBody>
                    {rows.map((x) => (
                      <TableRow key={x.country}>
                        <TableCell sx={{ boxShadow: `inset 3px 0 0 ${x.metrics.profit < 0 ? p.neg : p.pos}` }}><CountryCode c={x.country} />{x.name}<Typography variant="caption" component="div">{share(x)} do spend</Typography></TableCell>
                        <TableCell align="right"><Money v={x.metrics.spend} /></TableCell><TableCell align="right"><Money v={x.metrics.revenue} /></TableCell>
                        <TableCell align="right"><Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }} ><Profit v={x.metrics.profit} /><LinearProgress variant="determinate" value={(Math.abs(x.metrics.profit) / mxP) * 100} color={x.metrics.profit < 0 ? 'error' : 'success'} sx={{ width: 40, bgcolor: 'transparent' }} /></Stack></TableCell>
                        <TableCell align="right"><Money v={x.metrics.sessionRpm} /></TableCell><TableCell align="right"><RoiChip v={x.metrics.roi} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 600 } }}><TableCell>Total · {rows.length} países</TableCell><TableCell align="right"><Money v={tot.spend} /></TableCell><TableCell align="right"><Money v={tot.revenue} /></TableCell><TableCell align="right"><Profit v={tot.profit} /></TableCell><TableCell align="right"><Money v={tot.sessionRpm} /></TableCell><TableCell align="right"><RoiChip v={tot.roi} /></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <Typography variant="caption">Despesas por país vêm da {c.platform === 'google' ? 'Google Ads API (visão geográfica)' : 'Meta Marketing API (breakdown por país)'}. Revenue vem do Google Ad Manager cruzado pelo Campaign ID da sessão e pelo país. Receita sem Campaign ID não entra aqui.</Typography>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
