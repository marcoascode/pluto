import { Alert, Box, Card, Chip, Drawer, Grid, IconButton, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography, useMediaQuery, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useMemo, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { usePlacementCampaigns, type PlacementSel } from '@/hooks/queries';
import { ErrorBox } from '@/components/ui/States';
import { Money, Profit, RoiChip } from '@/components/ui/Values';
import { money, shortDate } from '@/lib/format';

type K = 'name' | 'spend' | 'revenue' | 'profit' | 'roi' | 'rps';

/** Campanhas que gastaram no placement. Um placement pode dar ROI numa campanha e prejuízo em outra. */
export function PlacementDrawer({ sel, spec, onClose }: { sel: PlacementSel; spec: { key: string; label: string; level: 'root' | 'host' }; onClose: () => void }) {
  const theme = useTheme(); const p = theme.pluto;
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const { from, to, currency } = useFilters();
  const { data, error, refetch } = usePlacementCampaigns(sel, spec.key, spec.level);
  const [sort, setSort] = useState<{ k: K; d: 'asc' | 'desc' }>({ k: 'spend', d: 'desc' });
  const rows = useMemo(() => (data?.campaigns ?? []).slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'name') return a.name.localeCompare(b.name) * dir;
    return (((a.metrics[sort.k] as number | null) ?? -Infinity) - ((b.metrics[sort.k] as number | null) ?? -Infinity)) * dir;
  }), [data, sort]);
  const tot = data?.totals;
  const loss = rows.filter((x) => x.metrics.spend > 0 && x.metrics.profit < 0);
  const head = (k: K, l: string, num = true) => <TableCell align={num ? 'right' : 'left'}><TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel></TableCell>;
  return (
    <Drawer anchor={mobile ? 'bottom' : 'right'} open onClose={onClose} slotProps={{ paper: { sx: mobile ? { height: '88%', borderRadius: '20px 20px 0 0' } : { width: 'min(760px, 100%)' } } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline">Placement · {spec.level === 'root' ? 'domínio principal' : 'subdomínio'} · {sel.domain} · {shortDate(from)} – {shortDate(to)}</Typography>
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{spec.label}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Fechar"><CloseRoundedIcon fontSize="small" /></IconButton>
      </Stack>
      <Stack spacing={1.75} sx={{ p: 2, overflow: 'auto' }}>
        {error && <ErrorBox error={error} retry={() => refetch()} />}
        {!data && !error && <><Skeleton variant="rounded" height={64} /><Skeleton variant="rounded" height={220} /></>}
        {data && tot && (
          <>
            <Grid container spacing={1.25}>
              {([['Spend', <Money key="s" v={tot.spend} />], ['Revenue', <Money key="r" v={tot.revenue} />], ['Profit', <Profit key="p" v={tot.profit} />], ['ROI', <RoiChip key="o" v={tot.roi} />]] as const).map(([l, v]) => (
                <Grid key={l} size={{ xs: 6, md: 3 }}><Card sx={{ p: 1.5, background: p.panel2 }}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600, fontSize: 16 }}>{v}</Typography></Card></Grid>
              ))}
            </Grid>
            {loss.length ? (
              <Alert severity="warning" variant="outlined">
                <b>Prejuízo em {loss.length} de {rows.length} campanha{rows.length > 1 ? 's' : ''}</b> ({money(loss.reduce((a, x) => a + x.metrics.profit, 0), currency)}).
                <Typography variant="body2" color="text.secondary">Um placement pode dar ROI numa campanha e prejuízo em outra; avalie a exclusão por campanha.</Typography>
              </Alert>
            ) : rows.length ? <Alert severity="success" variant="outlined">Deu lucro em todas as campanhas no período.</Alert> : null}
            {data.hosts.length > 1 && (
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {data.hosts.slice().sort((a, b) => b.metrics.spend - a.metrics.spend).map((h) => (
                  <Chip key={h.key} size="small" sx={{ bgcolor: p.panel3, height: 26 }} label={<Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Box component="span" sx={{ fontFamily: p.mono, fontSize: 12 }}>{h.key}</Box><RoiChip v={h.metrics.roi} /></Stack>} />
                ))}
              </Stack>
            )}
            {mobile ? (
              <Card>{rows.map((x) => (
                <Box key={x.id} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', boxShadow: x.metrics.profit < 0 ? `inset 3px 0 0 ${p.neg}` : 'none' }}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}><Box sx={{ minWidth: 0 }}><Typography sx={{ overflowWrap: 'anywhere' }}>{x.name}</Typography><Typography variant="caption">{x.accountName}</Typography></Box><RoiChip v={x.metrics.roi} /></Stack>
                  <Grid container spacing={1} sx={{ mt: 1 }}>{([['Spend', <Money key="s" v={x.metrics.spend} />], ['Revenue', <Money key="r" v={x.metrics.revenue} />], ['Profit', <Profit key="p" v={x.metrics.profit} />], ['RPS', <Money key="q" v={x.metrics.rps} />]] as const).map(([l, v]) => <Grid key={l} size={6}><Typography variant="caption">{l}</Typography><Typography component="div" sx={{ fontWeight: 600 }}>{v}</Typography></Grid>)}</Grid>
                </Box>
              ))}</Card>
            ) : (
              <TableContainer component={Card}>
                <Table size="small">
                  <TableHead><TableRow>{head('name', 'Campanha', false)}{head('spend', 'Spend')}{head('revenue', 'Revenue')}{head('profit', 'Profit')}{head('rps', 'RPS')}{head('roi', 'ROI')}</TableRow></TableHead>
                  <TableBody>
                    {rows.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell sx={{ boxShadow: `inset 3px 0 0 ${x.metrics.profit < 0 ? p.neg : p.pos}`, whiteSpace: 'normal' }}>{x.name}<Typography variant="caption" component="div">{x.accountName} · {x.id}{x.status === 'PAUSED' ? ' · pausada' : ''}</Typography></TableCell>
                        <TableCell align="right"><Money v={x.metrics.spend} /></TableCell><TableCell align="right"><Money v={x.metrics.revenue} /></TableCell>
                        <TableCell align="right"><Profit v={x.metrics.profit} /></TableCell><TableCell align="right"><Money v={x.metrics.rps} /></TableCell><TableCell align="right"><RoiChip v={x.metrics.roi} /></TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.disabled' }}>Sem dados no período.</TableCell></TableRow>}
                    <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 600 } }}><TableCell>Total · {rows.length} campanha{rows.length === 1 ? '' : 's'}</TableCell><TableCell align="right"><Money v={tot.spend} /></TableCell><TableCell align="right"><Money v={tot.revenue} /></TableCell><TableCell align="right"><Profit v={tot.profit} /></TableCell><TableCell align="right"><Money v={tot.rps} /></TableCell><TableCell align="right"><RoiChip v={tot.roi} /></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  );
}
