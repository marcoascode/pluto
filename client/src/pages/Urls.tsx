import { Alert, Avatar, Box, Chip, Card, CardContent, CardHeader, Grid, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography, alpha, useTheme } from '@mui/material';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useMyDomains, useUrls } from '@/hooks/queries';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { BlockHeaderRow, blockStarts } from '@/components/ui/MetricBlocks';
import { ErrorBox, PageHead, PageSkeleton, Provisional, Tag } from '@/components/ui/States';
import { DropOff, MetricValue, RoiChip } from '@/components/ui/Values';
import { NO_URL, UrlLink } from '@/components/ui/UrlLink';
import { OriginCard } from '@/components/urls/OriginCard';
import { domainLabel, int, longDate, money, pct0 } from '@/lib/format';
import { DROP_MIN_RESPONSES, METRIC_DEFS, metricValue, type MetricKey } from '@/lib/metrics';
import { addDays, todayISO } from '@/lib/period';

const RANK: [MetricKey, string][] = [['roi', 'ROI %'], ['profit', 'ROI'], ['revenue', 'Receita'], ['ecpm', 'eCPM'], ['dropOffRate', 'Drop-off (maior)']];
const MEDAL = ['#f2c94c', '#cdd6e4', '#d99a5b'];

export default function UrlsPage() {
  const f = useFilters();
  const { pluto: p } = useTheme();
  const [params] = useSearchParams();
  const [dom, setDom] = useState(params.get('domain') ?? f.domain);
  const [q, setQ] = useState('');
  const [rk, setRk] = useState<MetricKey>('roi');
  const [sort, setSort] = useState<{ k: MetricKey | 'path'; d: 'asc' | 'desc' }>({ k: 'revenue', d: 'desc' });
  const ms = usePicked('urls');
  const starts = useMemo(() => blockStarts(ms), [ms]);
  const { data: doms } = useMyDomains();
  const [origin, setOrigin] = useState(params.get('origin') ?? '');
  const { data, error, isLoading, refetch } = useUrls(dom, origin);
  const list = useMemo(() => (data?.urls ?? []).filter((u) => !q || (u.domain + u.path).toLowerCase().includes(q.toLowerCase())).sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    return sort.k === 'path' ? (a.domain + a.path).localeCompare(b.domain + b.path) * dir : ((metricValue(a.metrics, undefined, sort.k) ?? -Infinity) - (metricValue(b.metrics, undefined, sort.k) ?? -Infinity)) * dir;
  }), [data, q, sort]);
  const isDrop = rk === 'dropOffRate';
  const top = useMemo(() => (data?.urls ?? []).filter((u) => (isDrop ? u.metrics.responsesServed >= DROP_MIN_RESPONSES : u.metrics.impressions >= 100) && (rk !== 'roi' || u.metrics.spend > 0) && metricValue(u.metrics, undefined, rk) != null)
    .sort((a, b) => metricValue(b.metrics, undefined, rk)! - metricValue(a.metrics, undefined, rk)!).slice(0, 5), [data, rk, isDrop]);
  /** Painel de drop-off: soma do período + URLs acima de 20% (mín. de respostas servidas) + receita estimada perdida pelo eCPM da própria URL. */
  const drop = useMemo(() => {
    const urls = data?.urls ?? [];
    const rsv = urls.reduce((a, u) => a + u.metrics.responsesServed, 0), imps = urls.reduce((a, u) => a + u.metrics.impressions, 0);
    const big = urls.filter((u) => u.metrics.responsesServed >= DROP_MIN_RESPONSES && u.metrics.dropOffRate != null);
    const hot = big.filter((u) => u.metrics.dropOffRate! >= 20).sort((a, b) => b.metrics.dropOffRate! - a.metrics.dropOffRate!);
    return { rate: rsv ? ((rsv - imps) / rsv) * 100 : null, lostResp: rsv - imps, rsv, hot, warn: big.filter((u) => u.metrics.dropOffRate! >= 12 && u.metrics.dropOffRate! < 20).length,
      lost: hot.reduce((a, u) => a + ((u.metrics.ecpm ?? 0) * (u.metrics.responsesServed - u.metrics.impressions)) / 1000, 0) };
  }, [data]);
  /** Quanto da receita veio sem caminho (o site não manda page_path ao Ad Manager). */
  const noPath = useMemo(() => {
    const urls = data?.urls ?? []; const rev = urls.reduce((a, u) => a + u.metrics.revenue, 0);
    const none = urls.filter((u) => u.path === NO_URL).reduce((a, u) => a + u.metrics.revenue, 0);
    return rev > 0 && none / rev >= 0.2 ? { share: (none / rev) * 100 } : null;
  }, [data]);
  const cell = { p: 1.75, minWidth: 0, borderColor: 'divider' } as const;
  const head = (k: MetricKey | 'path', l: string, num = true) => <TableCell key={k} align={num ? 'right' : 'left'} sx={k !== 'path' && starts.has(k) ? { borderLeft: `1px solid ${p.line2}` } : undefined}><TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel></TableCell>;
  return (
    <>
      <PageHead title="URLs" sub={`${dom || 'Todos os domínios'} · ${longDate(f.from)} – ${longDate(f.to)}`} />
      <Provisional show={f.to >= addDays(todayISO(), -3)} />
      {isLoading && !data ? <PageSkeleton /> : error && !data ? <ErrorBox error={error} retry={() => refetch()} /> : (
        <Grid container spacing={1.75}>
          {noPath && (
            <Grid size={12}>
              <Alert severity="info" variant="outlined">
                <b>{pct0(noPath.share)} da receita está em "(sem URL)".</b> O Ad Manager só entrega a slug da página se o site mandar o caminho no GPT:{' '}
                <Box component="code" sx={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}>googletag.pubads().setTargeting('page_path', location.pathname)</Box>{' '}
                e, no Ad Manager, o key <b>page_path</b> estiver com <b>"Incluir valores nos relatórios"</b> (Inventário → Key-values). Não precisa de dimensão personalizada. Depois, sincronize o Ad Manager: a receita de cada slug aparece aqui junto com o custo das campanhas que levam para ela.
              </Alert>
            </Grid>
          )}
          <Grid size={12}>
            <Card>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(3, minmax(0,1fr)) minmax(0,1.4fr)' } }}>
                <Box sx={{ ...cell, borderRight: 1, borderBottom: { xs: 1, lg: 0 } }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Typography variant="caption" sx={{ color: 'text.secondary' }}>Drop-off do período</Typography><Tag tone="accent">GAM</Tag></Stack>
                  <Typography component="div" sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, my: 0.5 }}><DropOff v={drop.rate} /></Typography>
                  <Typography variant="caption">{int(drop.lostResp)} de {int(drop.rsv)} respostas servidas não viraram impressão</Typography>
                </Box>
                <Box sx={{ ...cell, borderRight: { lg: 1 }, borderBottom: { xs: 1, lg: 0 } }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>URLs acima de 20%</Typography>
                  <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, my: 0.5, color: drop.hot.length ? p.neg : 'inherit' }}>{drop.hot.length}</Typography>
                  <Typography variant="caption">{drop.warn} entre 12% e 20%</Typography>
                </Box>
                <Box sx={{ ...cell, borderRight: 1 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Receita estimada perdida</Typography>
                  <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, my: 0.5, color: drop.lost > 0 ? p.warn : 'inherit' }}>{money(drop.lost, f.currency)}</Typography>
                  <Typography variant="caption">nas URLs acima de 20%, pelo eCPM da própria URL</Typography>
                </Box>
                <Stack spacing={0.75} sx={{ ...cell, justifyContent: 'center' }}>
                  {drop.hot.slice(0, 3).map((u) => (
                    <Stack key={u.domain + u.path} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.75 }}><UrlLink domain={u.domain} path={u.path} noWrap />{!dom && <Typography component="span" variant="caption" noWrap>{u.domain}</Typography>}</Box>
                      <DropOff v={u.metrics.dropOffRate} />
                    </Stack>
                  ))}
                  {!drop.hot.length && <Typography variant="caption">Nenhuma URL com drop-off alto.</Typography>}
                </Stack>
              </Box>
              <Typography variant="caption" component="div" sx={{ px: 1.75, py: 1, borderTop: 1, borderColor: 'divider' }}>
                Drop-off = (Respostas servidas − Impressões) ÷ Respostas servidas. Alto drop-off costuma indicar página lenta, anúncio abaixo da dobra, refresh agressivo ou saída rápida do usuário.
              </Typography>
            </Card>
          </Grid>
          {data && <Grid size={12}><OriginCard origins={data.origins} value={origin} onChange={setOrigin} /></Grid>}
          <Grid size={{ xs: 12, lg: 8 }}>
            <Card>
              <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', p: 1.75, borderBottom: 1, borderColor: 'divider' }}>
                <Select size="small" displayEmpty value={dom} onChange={(e) => setDom(e.target.value)} inputProps={{ 'aria-label': 'Domínio' }}><MenuItem value="">Todos os domínios</MenuItem>{doms?.domains.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}</Select>
                <TextField size="small" placeholder="Filtrar URL" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 200 }} />
                {origin && <Chip size="small" color="primary" variant="outlined" label={`Origem: ${data?.origins.find((o) => o.key === origin)?.label ?? origin.replace(/^utm:/, '')}`} onDelete={() => setOrigin('')} />}
                <Box sx={{ flex: 1 }} /><MetricPicker screen="urls" />
              </Stack>
              <TableContainer><Table>
                {/* relatório misto: colunas em 3 blocos (Resultados · Despesas · Receitas) */}
                <TableHead><BlockHeaderRow ms={ms} lead={<TableCell rowSpan={2} sx={{ verticalAlign: 'bottom' }}>{head('path', 'URL', false).props.children}</TableCell>} /><TableRow>{ms.map((k) => head(k, METRIC_DEFS[k].label))}</TableRow></TableHead>
                <TableBody>{list.map((u) => (
                  <TableRow key={u.domain + u.path}>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                        <UrlLink domain={u.domain} path={u.path} />
                        {(u.metrics.dropOffRate ?? 0) >= 20 && u.metrics.responsesServed >= DROP_MIN_RESPONSES && <Box component="span" sx={{ fontSize: 11, px: 0.75, borderRadius: 1, color: p.neg, bgcolor: alpha(p.neg, 0.15) }}>drop-off alto</Box>}
                      </Stack>
                      {!dom && <Typography variant="caption" component="div">{domainLabel(u.domain)}</Typography>}
                    </TableCell>
                    {ms.map((k) => <TableCell key={k} align="right" sx={starts.has(k) ? { borderLeft: `1px solid ${p.line2}` } : undefined}><MetricValue k={k} v={metricValue(u.metrics, undefined, k)} /></TableCell>)}
                  </TableRow>
                ))}</TableBody>
              </Table></TableContainer>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Card>
              <CardHeader title={isDrop ? 'Maior drop-off' : 'Top URLs'} subheader={`${dom || 'Todos os domínios'} · ${isDrop ? `mín. ${DROP_MIN_RESPONSES} respostas servidas` : 'mín. 100 impressões'}`} action={<Select size="small" value={rk} onChange={(e) => setRk(e.target.value as MetricKey)}>{RANK.map(([k, l]) => <MenuItem key={k} value={k}>Por {l}</MenuItem>)}</Select>} />
              <CardContent>
                {top.map((u, i) => (
                  <Stack key={u.domain + u.path} direction="row" spacing={1.25} sx={{ alignItems: 'center', py: 1.1, borderBottom: i < top.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                    <Avatar sx={{ width: 26, height: 26, fontSize: 12, fontWeight: 700, ...(isDrop ? { bgcolor: alpha(p.neg, 0.15), color: p.neg } : { bgcolor: MEDAL[i] ?? 'action.selected', color: i < 3 ? '#1a1300' : 'text.secondary' }) }}>{i + 1}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}><UrlLink domain={u.domain} path={u.path} />{!dom && <Typography variant="caption" component="div">{u.domain}</Typography>}</Box>
                    <b>{rk === 'roi' ? <RoiChip v={u.metrics.roi} /> : isDrop ? <DropOff v={u.metrics.dropOffRate} /> : money(metricValue(u.metrics, undefined, rk), f.currency)}</b>
                  </Stack>
                ))}
                {!top.length && <Typography variant="caption">Sem dados suficientes.</Typography>}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </>
  );
}
