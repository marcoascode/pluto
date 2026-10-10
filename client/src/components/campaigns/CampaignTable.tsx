import { Box, Grid, IconButton, Link, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useCampaignChildren } from '@/hooks/queries';
import { usePicked } from '@/components/ui/MetricPicker';
import { MetricValue, RoiChip } from '@/components/ui/Values';
import { METRIC_DEFS, metricValue, type MetricKey, type PICKERS } from '@/lib/metrics';
import type { CampaignRow, ChildRow, Metrics, RoiDays } from '@/types/api';
import { CountryDrawer } from './CountryDrawer';
import { CampaignDomainSelect } from './CampaignDomainSelect';
import { domainLabel } from '@/lib/format';

interface Props { screen: keyof typeof PICKERS; campaigns: CampaignRow[]; totals: Metrics; totalsRoiDays: RoiDays; showDomain?: boolean; showPlatform?: boolean }
type Sort = { k: MetricKey | 'name'; d: 'asc' | 'desc' };

function Toggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return <IconButton size="small" onClick={onClick} aria-label={label} aria-expanded={open} sx={{ width: 22, height: 22, borderRadius: 1.25, border: 0, bgcolor: open ? 'rgba(91,155,255,.14)' : 'rgba(255,255,255,.06)', color: open ? 'primary.light' : 'text.secondary' }}>
    <ChevronRightRoundedIcon sx={{ fontSize: 16, transform: open ? 'rotate(90deg)' : 'none', transition: '.15s' }} /></IconButton>;
}

/** Campanha → Grupo/Conjunto → Criativo (inline) + 🌐 países em gaveta. Desktop = tabela, celular = cartões. */
export function CampaignTable({ screen, campaigns, totals, totalsRoiDays, showDomain = true, showPlatform = false }: Props) {
  const ms = usePicked(screen);
  const theme = useTheme(); const p = theme.pluto;
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [sort, setSort] = useState<Sort>({ k: 'spend', d: 'desc' });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [countries, setCountries] = useState<CampaignRow | null>(null);
  const [saved, setSaved] = useState('');
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = useMemo(() => campaigns.slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'name') return a.name.localeCompare(b.name) * dir;
    return ((metricValue(a.metrics, a.roiDays, sort.k) ?? -Infinity) - (metricValue(b.metrics, b.roiDays, sort.k) ?? -Infinity)) * dir;
  }), [campaigns, sort]);
  const head = (k: MetricKey | 'name', label: string, num = true) => (
    <TableCell key={k} align={num ? 'right' : 'left'} sortDirection={sort.k === k ? sort.d : false} sx={k === 'name' ? { position: 'sticky', left: 0, zIndex: 3 } : undefined}>
      <TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{label}</TableSortLabel>
    </TableCell>
  );
  const sub = (c: CampaignRow) => {
    const parts: ReactNode[] = [];
    // campanha sem domínio (custo em "Sem domínio"): no lugar do domínio, o seletor para definir (só Admin vê essas campanhas)
    if (c.noDomain) parts.push(<CampaignDomainSelect key="d" id={c.id} platform={c.platform} name={c.name} width={200} dense onSaved={setSaved} />);
    else if (showDomain) parts.push(<Link key="d" component={RouterLink} to={`/dominios/${encodeURIComponent(c.domain)}`} color="inherit" underline="hover">{domainLabel(c.domain)}</Link>);
    parts.push(c.accountName);
    if (showPlatform) parts.push(c.platform === 'google' ? 'Google Ads' : 'Meta Ads');
    if (c.status === 'PAUSED') parts.push('Pausada');
    return <Typography variant="caption" component="div" sx={c.noDomain ? { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.5 } : undefined}>{parts.map((x, i) => <Fragment key={i}>{i > 0 && ' · '}{x}</Fragment>)}</Typography>;
  };
  const globe = (c: CampaignRow) => <Tooltip title="Países da campanha"><IconButton size="small" onClick={() => setCountries(c)} aria-label="Países da campanha"><PublicRoundedIcon fontSize="small" /></IconButton></Tooltip>;
  const neg = (m: Metrics) => m.profit < 0 && m.spend > 0;
  const stickyCell = (bg: string, extra = {}) => ({ position: 'sticky', left: 0, zIndex: 1, bgcolor: bg, borderRight: `1px solid ${p.line}`, whiteSpace: 'normal', minWidth: { xs: 240, md: 380 }, maxWidth: 520, ...extra });

  if (mobile) {
    const mm = ms.filter((k) => k !== 'roi').slice(0, 6);
    const grid = (m: Metrics, r: RoiDays) => <Grid container spacing={1} sx={{ mt: 1.25 }}>{mm.map((k) => <Grid key={k} size={4}><Typography variant="caption" sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{METRIC_DEFS[k].label}</Typography><Typography component="div" sx={{ fontWeight: 600, fontSize: 13.5 }}><MetricValue k={k} v={metricValue(m, r, k)} /></Typography></Grid>)}</Grid>;
    return (
      <Box>
        <Box sx={{ p: 1.75, bgcolor: p.panel2, borderBottom: 1, borderColor: 'divider' }}><Stack direction="row" sx={{ justifyContent: 'space-between' }} ><b>Total · {rows.length} campanhas</b><RoiChip v={totals.roi} /></Stack>{grid(totals, totalsRoiDays)}</Box>
        {rows.map((c) => (
          <Fragment key={c.id}>
            <Box sx={{ p: 1.75, borderBottom: 1, borderColor: 'divider', boxShadow: neg(c.metrics) ? `inset 3px 0 0 ${p.neg}` : 'none' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} ><Toggle open={open.has(c.id)} onClick={() => toggle(c.id)} label="Abrir" /><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{c.name}</Typography>{sub(c)}</Box><RoiChip v={c.metrics.roi} />{globe(c)}</Stack>
              {grid(c.metrics, c.roiDays)}
            </Box>
            {open.has(c.id) && <Children c={c} ms={ms} grid={grid} />}
          </Fragment>
        ))}
        {!rows.length && <Typography variant="caption" sx={{ p: 4, display: 'block', textAlign: 'center' }}>Nenhuma campanha para os filtros atuais.</Typography>}
        {countries && <CountryDrawer c={countries} onClose={() => setCountries(null)} />}
        <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
      </Box>
    );
  }
  return (
    <>
      <TableContainer>
        <Table size="medium">
          <TableHead><TableRow>{head('name', 'Campanha', false)}{ms.map((k) => head(k, METRIC_DEFS[k].label))}</TableRow></TableHead>
          <TableBody>
            <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 600 } }}><TableCell sx={stickyCell(p.panel2)}>Total · {rows.length} campanhas</TableCell>{ms.map((k) => <TableCell key={k} align="right"><MetricValue k={k} v={metricValue(totals, totalsRoiDays, k)} /></TableCell>)}</TableRow>
            {rows.map((c) => (
              <Fragment key={c.id}>
                <TableRow>
                  <TableCell sx={stickyCell(p.panel, neg(c.metrics) ? { boxShadow: `inset 3px 0 0 ${p.neg}` } : {})}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} ><Toggle open={open.has(c.id)} onClick={() => toggle(c.id)} label={c.platform === 'google' ? 'Ver grupos' : 'Ver conjuntos'} /><Box sx={{ flex: 1, minWidth: 0 }}>{c.name}{sub(c)}</Box>{globe(c)}</Stack>
                  </TableCell>
                  {ms.map((k) => <TableCell key={k} align="right"><MetricValue k={k} v={metricValue(c.metrics, c.roiDays, k)} /></TableCell>)}
                </TableRow>
                {open.has(c.id) && <Children c={c} ms={ms} />}
              </Fragment>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={ms.length + 1} align="center" sx={{ py: 4, color: 'text.disabled' }}>Nenhuma campanha para os filtros atuais.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {countries && <CountryDrawer c={countries} onClose={() => setCountries(null)} />}
      <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

/** Busca grupos/conjuntos e criativos só quando a campanha é aberta. */
function Children({ c, ms, grid }: { c: CampaignRow; ms: MetricKey[]; grid?: (m: Metrics, r: RoiDays) => ReactNode }) {
  const { pluto: p } = useTheme();
  const { data, isLoading } = useCampaignChildren(c.platform, c.id, true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [l1, l2] = c.platform === 'google' ? ['Ad Group', 'Creative'] : ['Ad Set', 'Ad'];
  if (isLoading || !data) return grid ? <Typography variant="caption" sx={{ p: 1.5, pl: 4, display: 'block', bgcolor: p.rowL1 }}>Carregando…</Typography>
    : <TableRow><TableCell colSpan={ms.length + 1} sx={{ bgcolor: p.rowL1, pl: 4, color: 'text.disabled' }}>Carregando…</TableCell></TableRow>;
  const cells = (r: ChildRow) => ms.map((k) => <TableCell key={k} align="right"><MetricValue k={k} v={metricValue(r.metrics, r.roiDays, k)} /></TableCell>);
  const name = (bg: string, pl: number) => ({ position: 'sticky' as const, left: 0, zIndex: 1, bgcolor: bg, borderRight: `1px solid ${p.line}`, whiteSpace: 'normal', pl });
  return (
    <>
      {data.groups.map((g) => (
        <Fragment key={g.id}>
          {grid ? (
            <Box sx={{ p: 1.5, pl: 3, bgcolor: p.rowL1, borderBottom: 1, borderColor: 'divider' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} ><Toggle open={open.has(g.id)} onClick={() => toggle(g.id)} label="Ver criativos" /><Typography sx={{ flex: 1 }}>{g.name}</Typography><RoiChip v={g.metrics.roi} /></Stack>{grid(g.metrics, g.roiDays)}</Box>
          ) : (
            <TableRow sx={{ '& td': { bgcolor: p.rowL1 } }}><TableCell sx={name(p.rowL1, 3.5)}><Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} ><Toggle open={open.has(g.id)} onClick={() => toggle(g.id)} label="Ver criativos" /><Box>{g.name}<Typography variant="caption" component="div" sx={{ fontFamily: p.mono, fontSize: 11 }}>{l1} {g.id}</Typography></Box></Stack></TableCell>{cells(g)}</TableRow>
          )}
          {open.has(g.id) && g.ads.map((a) => grid
            ? <Box key={a.id} sx={{ p: 1.5, pl: 5, bgcolor: p.rowL2, borderBottom: 1, borderColor: 'divider' }}><Stack direction="row" sx={{ justifyContent: 'space-between' }} ><Typography>{a.name}</Typography><RoiChip v={a.metrics.roi} /></Stack>{grid(a.metrics, a.roiDays)}</Box>
            : <TableRow key={a.id} sx={{ '& td': { bgcolor: p.rowL2, fontSize: 12.5 } }}><TableCell sx={name(p.rowL2, 7)}>{a.name}<Typography variant="caption" component="div" sx={{ fontFamily: p.mono, fontSize: 11 }}>{l2} {a.id}</Typography></TableCell>{cells(a)}</TableRow>)}
        </Fragment>
      ))}
    </>
  );
}
