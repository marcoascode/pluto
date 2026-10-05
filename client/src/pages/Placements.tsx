import {
  Alert, Box, Button, Card, Checkbox, Chip, Grid, IconButton, ListItemText, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TableSortLabel, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useMediaQuery, useTheme,
} from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ListAltRoundedIcon from '@mui/icons-material/ListAltRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TrackChangesRoundedIcon from '@mui/icons-material/TrackChangesRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useMyDomains, usePlacementFilters, usePlacements, type PlacementSel } from '@/hooks/queries';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { ErrorBox, PageHead, PageSkeleton, Provisional, Tag } from '@/components/ui/States';
import { MetricValue, Profit, RoiChip } from '@/components/ui/Values';
import { PlacementDrawer } from '@/components/placements/PlacementDrawer';
import { longDate, money, pct0 } from '@/lib/format';
import { marginClass, METRIC_DEFS, metricValue, type MetricKey } from '@/lib/metrics';
import { addDays, todayISO } from '@/lib/period';
import type { Metrics, PlacementGroup, PlacementRow, PlacementsResponse, PlacementType } from '@/types/api';

/* =====================================================================
   Placements: onde os anúncios do Google Ads apareceram × receita do Ad Manager.
   Fluxo: 1) Domínio (obrigatório) → 2) Contas Google Ads do domínio → 3) Campanhas → "Pesquisar placements".
   A pesquisa aplicada fica na URL (?d=&a=&c=), então dá para recarregar ou mandar o link.
   Data e Moeda do topo continuam valendo; o Domínio do topo some nesta tela.
   ===================================================================== */

type Draft = PlacementSel & { accNone: boolean; campNone: boolean };
const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const ALL = '__all__';

function readSel(p: URLSearchParams): PlacementSel | null {
  const d = p.get('d');
  return d ? { domain: d, accounts: csv(p.get('a')), campaigns: csv(p.get('c')) } : null;
}
const same = (a: PlacementSel | null, b: PlacementSel) => !!a && a.domain === b.domain && a.accounts.join() === b.accounts.join() && a.campaigns.join() === b.campaigns.join();

export default function Placements() {
  const f = useFilters();
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readSel(params), [params]);
  const [draft, setDraft] = useState<Draft>(() => ({ ...(applied ?? { domain: f.domain || '', accounts: [], campaigns: [] }), accNone: false, campNone: false }));
  const res = usePlacements(applied);
  const dirty = !!applied && (!same(applied, draft) || draft.accNone || draft.campNone);
  const search = () => {
    if (!draft.domain || draft.accNone || draft.campNone) return;
    const next = new URLSearchParams({ d: draft.domain });
    if (draft.accounts.length) next.set('a', draft.accounts.join(','));
    if (draft.campaigns.length) next.set('c', draft.campaigns.join(','));
    setParams(next);
  };
  return (
    <>
      <PageHead title="Placements" sub={`Onde os anúncios do Google Ads apareceram × receita no Ad Manager · agrupado pelo domínio principal${applied ? ' · ' + applied.domain : ''} · ${longDate(f.from)} – ${longDate(f.to)}`} />
      {applied && <Provisional show={f.to >= addDays(todayISO(), -3)} />}
      <QueryCard draft={draft} setDraft={setDraft} dirty={dirty} onSearch={search} />
      {!applied ? <EmptyState onPick={(d) => setDraft({ domain: d, accounts: [], campaigns: [], accNone: false, campNone: false })} />
        : res.isLoading && !res.data ? <PageSkeleton />
          : res.error && !res.data ? <ErrorBox error={res.error} retry={() => res.refetch()} />
            : res.data && <Results data={res.data} sel={applied} />}
    </>
  );
}

/* ---------------- 1 · 2 · 3 + Pesquisar ---------------- */
function Step({ n, on, children }: { n: number; on: boolean; children: ReactNode }) {
  const { pluto: p } = useTheme();
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.75 }}>
      <Box sx={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, bgcolor: on ? p.accent2 : p.panel3, color: on ? '#fff' : p.muted }}>{n}</Box>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{children}</Typography>
    </Stack>
  );
}
interface PickItem { id: string; label: string; sub?: string }
/** Multi-seleção com "Todas". value vazio + none=false = todas; none=true = nenhuma (o botão Pesquisar trava). */
function MultiPick({ items, value, none, allLabel, disabled, disabledText, onChange, width, ariaLabel }: {
  ariaLabel: string; items: PickItem[]; value: string[]; none: boolean; allLabel: string; disabled?: boolean; disabledText: string; width: { xs: string; md: number };
  onChange: (v: string[], none: boolean) => void;
}) {
  const isAll = !none && (!value.length || value.length === items.length);
  const selected = none ? [] : isAll ? [ALL, ...items.map((i) => i.id)] : value;
  const label = disabled ? disabledText : none ? 'Nenhuma selecionada' : isAll ? `${allLabel} (${items.length})`
    : value.length === 1 ? items.find((i) => i.id === value[0])?.label ?? '1 selecionada' : `${value.length} de ${items.length} selecionadas`;
  const change = (v: string[]) => {
    const hasAll = v.includes(ALL);
    if (hasAll && !isAll) return onChange([], false);
    if (!hasAll && isAll) return onChange([], true);
    const sel = v.filter((x) => x !== ALL);
    if (!sel.length) return onChange([], true);
    onChange(sel.length === items.length ? [] : items.map((i) => i.id).filter((id) => sel.includes(id)), false);
  };
  return (
    <Select multiple size="small" disabled={disabled} value={selected} displayEmpty renderValue={() => label} inputProps={{ 'aria-label': ariaLabel }} onChange={(e) => change(e.target.value as string[])}
      sx={{ width, color: disabled ? 'text.disabled' : undefined }} MenuProps={{ slotProps: { paper: { sx: { maxHeight: 400, maxWidth: 460 } } } }}>
      <MenuItem value={ALL} sx={{ borderBottom: 1, borderColor: 'divider' }}><Checkbox size="small" checked={isAll} /><ListItemText primary={allLabel} slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 13.5 } } }} /></MenuItem>
      {items.map((i) => (
        <MenuItem key={i.id} value={i.id} sx={{ alignItems: 'flex-start' }}>
          <Checkbox size="small" checked={!none && (isAll || value.includes(i.id))} sx={{ mt: -0.5 }} />
          <ListItemText primary={i.label} secondary={i.sub} slotProps={{ primary: { sx: { fontSize: 13.5, whiteSpace: 'normal' } }, secondary: { sx: { fontSize: 11.5 } } }} />
        </MenuItem>
      ))}
    </Select>
  );
}
function QueryCard({ draft, setDraft, dirty, onSearch }: { draft: Draft; setDraft: (d: Draft) => void; dirty: boolean; onSearch: () => void }) {
  const { pluto: p } = useTheme();
  const { data: doms } = useMyDomains();
  const flt = usePlacementFilters(draft.domain);
  const accs = flt.data?.accounts ?? [];
  const camps = (flt.data?.campaigns ?? []).filter((c) => !draft.accounts.length || draft.accounts.includes(c.accountId));
  const accName = (id: string) => accs.find((a) => a.id === id)?.name ?? '';
  const ready = !!draft.domain && !draft.accNone && !draft.campNone && !!flt.data;
  const why = !draft.domain ? 'Escolha um domínio' : draft.accNone ? 'Escolha ao menos uma conta' : draft.campNone ? 'Escolha ao menos uma campanha' : '';
  const noCamps = !!flt.data && !flt.data.campaigns.length;
  return (
    <Card sx={{ mb: 1.75 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h2">Filtros de pesquisa</Typography>
        <Typography variant="caption">Escolha o domínio, depois as contas e as campanhas dele</Typography>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap sx={{ p: 2, alignItems: { md: 'flex-end' }, flexWrap: 'wrap' }}>
        <Box>
          <Step n={1} on={!!draft.domain}>Domínio <Box component="span" sx={{ color: p.neg }}>*</Box></Step>
          <Select size="small" displayEmpty value={draft.domain} onChange={(e) => setDraft({ domain: e.target.value, accounts: [], campaigns: [], accNone: false, campNone: false })}
            inputProps={{ 'aria-label': 'Domínio' }} sx={{ width: { xs: '100%', md: 240 }, ...(draft.domain ? {} : { boxShadow: `0 0 0 3px ${alpha(p.accent, 0.18)}`, '& fieldset': { borderColor: `${p.accent} !important` } }) }}>
            <MenuItem value="" disabled>Selecione o domínio…</MenuItem>
            {doms?.domains.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
          </Select>
        </Box>
        <Box>
          <Step n={2} on={!!draft.domain}>Contas Google Ads <Typography component="span" variant="caption">(opcional)</Typography></Step>
          <MultiPick ariaLabel="Contas Google Ads" width={{ xs: '100%', md: 250 }} items={accs.map((a) => ({ id: a.id, label: a.name, sub: `${a.externalId} · ${a.campaigns} campanha${a.campaigns === 1 ? '' : 's'}` }))}
            value={draft.accounts} none={draft.accNone} allLabel="Todas as contas" disabled={!draft.domain || !flt.data} disabledText={draft.domain ? 'Carregando…' : 'Escolha o domínio primeiro'}
            onChange={(v, none) => {
              const ok = new Set((flt.data?.campaigns ?? []).filter((c) => !v.length || v.includes(c.accountId)).map((c) => c.id));
              setDraft({ ...draft, accounts: v, accNone: none, campaigns: none ? [] : draft.campaigns.filter((c) => ok.has(c)), campNone: none ? false : draft.campNone });
            }} />
        </Box>
        <Box>
          <Step n={3} on={!!draft.domain}>Campanhas <Typography component="span" variant="caption">(opcional)</Typography></Step>
          <MultiPick ariaLabel="Campanhas" width={{ xs: '100%', md: 360 }} items={camps.map((c) => ({ id: c.id, label: c.name, sub: `${accName(c.accountId)} · ${c.id}${c.status === 'PAUSED' ? ' · pausada' : ''}` }))}
            value={draft.campaigns} none={draft.campNone} allLabel="Todas as campanhas" disabled={!draft.domain || !flt.data || draft.accNone}
            disabledText={!draft.domain ? 'Escolha o domínio primeiro' : draft.accNone ? 'Escolha ao menos uma conta' : 'Carregando…'}
            onChange={(v, none) => setDraft({ ...draft, campaigns: v, campNone: none })} />
        </Box>
        <Tooltip title={why}><span><Button variant="contained" startIcon={<SearchRoundedIcon />} disabled={!ready || noCamps} onClick={onSearch} sx={{ width: { xs: '100%', md: 'auto' } }}>Pesquisar placements</Button></span></Tooltip>
      </Stack>
      {noCamps && <Alert severity="info" variant="outlined" sx={{ mx: 2, mb: 2 }}>Este domínio não tem campanhas do Google Ads importadas.</Alert>}
      {flt.error && <Box sx={{ mx: 2, mb: 2 }}><ErrorBox error={flt.error} retry={() => flt.refetch()} /></Box>}
      {dirty && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 1.1, borderTop: 1, borderColor: 'divider', bgcolor: alpha(p.warn, 0.12), color: p.warn, fontSize: 12.5, borderRadius: '0 0 14px 14px' }}>
          <InfoOutlinedIcon sx={{ fontSize: 16 }} /><span>Você mudou os filtros. Clique em <b>Pesquisar placements</b> para atualizar os dados.</span>
        </Stack>
      )}
    </Card>
  );
}
function EmptyState({ onPick }: { onPick: (d: string) => void }) {
  const { pluto: p } = useTheme();
  const { data: doms } = useMyDomains();
  return (
    <Card sx={{ textAlign: 'center', py: 5, px: 3 }}>
      <TrackChangesRoundedIcon sx={{ fontSize: 46, color: p.accent, mb: 1 }} />
      <Typography variant="h2">Escolha um domínio para ver os placements</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mt: 1, mb: 2 }}>
        Os placements, o ranking e as métricas aparecem depois que você escolher o domínio e clicar em <b>Pesquisar placements</b>. Contas e campanhas são opcionais: sem escolher, entram todas as do domínio.
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {doms?.domains.map((d) => <Button key={d} size="small" variant="outlined" startIcon={<LanguageOutlinedIcon />} onClick={() => onPick(d)}>{d}</Button>)}
      </Stack>
    </Card>
  );
}

/* ---------------- resultados ---------------- */
type Mode = 'all' | 'win' | 'loss';
type CritKey = 'roi' | 'margin' | 'profit' | 'spend' | 'revenue' | 'rps' | 'sessions';
const CRIT: { k: CritKey; l: string; unit: '%' | '$' | '' }[] = [
  { k: 'roi', l: 'ROI', unit: '%' }, { k: 'margin', l: 'Margem', unit: '%' }, { k: 'profit', l: 'Profit', unit: '$' }, { k: 'spend', l: 'Spend', unit: '$' },
  { k: 'revenue', l: 'Revenue', unit: '$' }, { k: 'rps', l: 'RPS', unit: '$' }, { k: 'sessions', l: 'Sessions', unit: '' },
];
type Sort = { k: MetricKey | 'name'; d: 'asc' | 'desc' };
const isWin = (m: Metrics) => m.profit > 0;
const isLoss = (m: Metrics) => m.spend > 0 && m.profit < 0;
const TYPE_TAG: Partial<Record<PlacementType, string>> = { app: 'App', youtube: 'YouTube', google: 'Google' };
const multi = (g: PlacementGroup) => g.children.length > 1 || (g.children[0] && g.children[0].key !== g.key);

function Results({ data, sel }: { data: PlacementsResponse; sel: PlacementSel }) {
  const theme = useTheme(); const p = theme.pluto;
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const { currency } = useFilters();
  const ms = usePicked('placements');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('all');
  const [crit, setCrit] = useState<{ k: CritKey; op: 'le' | 'ge'; v: string }>({ k: 'roi', op: 'le', v: '' });
  const [sort, setSort] = useState<Sort>({ k: 'spend', d: 'desc' });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(50);
  const [drawer, setDrawer] = useState<{ key: string; label: string; level: 'root' | 'host' } | null>(null);

  const all = data.groups;
  const win = all.filter((g) => isWin(g.metrics)), loss = all.filter((g) => isLoss(g.metrics));
  const winP = win.reduce((a, g) => a + g.metrics.profit, 0), lossP = loss.reduce((a, g) => a + g.metrics.profit, 0);
  const minSp = Math.max(data.totals.spend * 0.01, 0.5);
  const best = all.filter((g) => g.metrics.spend >= minSp && g.metrics.roi != null).sort((a, b) => (b.metrics.roi ?? 0) - (a.metrics.roi ?? 0)).slice(0, 3);

  const ql = q.trim().toLowerCase();
  const cv = parseFloat(crit.v.replace(',', '.'));
  const critOn = crit.v.trim() !== '' && Number.isFinite(cv);
  const sortFn = (a: PlacementRow, b: PlacementRow) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'name') return a.label.localeCompare(b.label) * dir;
    return ((metricValue(a.metrics, a.roiDays, sort.k) ?? -Infinity) - (metricValue(b.metrics, b.roiDays, sort.k) ?? -Infinity)) * dir;
  };
  const groups = useMemo(() => all.filter((g) => {
    if (ql && !g.key.includes(ql) && !g.label.toLowerCase().includes(ql) && !g.children.some((c) => c.key.includes(ql))) return false;
    if (mode === 'win' && !isWin(g.metrics)) return false;
    if (mode === 'loss' && !isLoss(g.metrics)) return false;
    if (critOn) { const x = g.metrics[crit.k]; if (x == null || !Number.isFinite(x)) return false; if (crit.op === 'le' ? x > cv : x < cv) return false; }
    return true;
  }).sort(sortFn), [all, ql, mode, critOn, cv, crit.k, crit.op, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = groups.length !== all.length;
  // total do que está na tela (quando filtra, soma só os domínios visíveis)
  const tot = useMemo(() => (filtered ? sumGroups(groups) : { metrics: data.totals, roiDays: data.totalsRoiDays }), [filtered, groups, data]);
  const page = groups.slice(0, limit);
  const isOpen = (g: PlacementGroup) => open.has(g.key) || (!!ql && !g.key.includes(ql) && !g.label.toLowerCase().includes(ql));
  const kidsOf = (g: PlacementGroup) => {
    const ks = g.children.slice().sort(sortFn);
    return ql && !g.key.includes(ql) && !g.label.toLowerCase().includes(ql) ? ks.filter((c) => c.key.includes(ql)) : ks;
  };
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const anyOpen = page.some((g) => multi(g) && open.has(g.key));
  const expandAll = () => setOpen(anyOpen ? new Set() : new Set(groups.filter(multi).map((g) => g.key)));
  const unit = CRIT.find((c) => c.k === crit.k)!.unit;
  const unitTxt = unit === '$' ? { USD: '$', BRL: 'R$', EUR: '€' }[currency] : unit;
  const s = data.selection;
  const scopeTxt = `${data.domain} · ${s.accounts ? `${s.accounts} conta${s.accounts > 1 ? 's' : ''}` : 'todas as contas'} · ${s.campaigns === s.campaignsTotal ? (s.campaignsTotal === 1 ? '1 campanha' : `todas as ${s.campaignsTotal} campanhas`) : `${s.campaigns} de ${s.campaignsTotal} campanhas`}`;
  const nPl = groups.reduce((a, g) => a + g.children.length, 0);

  const head = (k: MetricKey | 'name', label: string, num = true) => (
    <TableCell key={k} align={num ? 'right' : 'left'} sortDirection={sort.k === k ? sort.d : false} sx={k === 'name' ? { position: 'sticky', left: 0, zIndex: 3, minWidth: 320 } : { whiteSpace: 'nowrap' }}>
      <TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{label}</TableSortLabel>
    </TableCell>
  );
  const drawerBtn = (key: string, label: string, level: 'root' | 'host') => (
    <Tooltip title="Campanhas que gastaram aqui"><IconButton size="small" onClick={() => setDrawer({ key, label, level })} aria-label="Campanhas que gastaram aqui"><ListAltRoundedIcon fontSize="small" /></IconButton></Tooltip>
  );
  const nameOf = (r: PlacementRow, count?: number) => (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
      <Typography component="span" sx={{ fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>{r.label}</Typography>
      {TYPE_TAG[r.type] && TYPE_TAG[r.type] !== r.label && <Tag>{TYPE_TAG[r.type]}</Tag>}
      {count != null && <Tooltip title={`${count} placement${count > 1 ? 's' : ''} neste domínio`}><Chip size="small" label={count} sx={{ height: 18, minWidth: 22, fontSize: 11, fontWeight: 600, color: p.accent, bgcolor: alpha(p.accent, 0.14) }} /></Tooltip>}
    </Stack>
  );
  const rowShadow = (m: Metrics) => (isLoss(m) ? `inset 3px 0 0 ${p.neg}` : isWin(m) ? `inset 3px 0 0 ${p.pos}` : 'none');
  const sticky = (bg: string, extra = {}) => ({ position: 'sticky' as const, left: 0, zIndex: 1, bgcolor: bg, borderRight: `1px solid ${p.line}`, whiteSpace: 'normal' as const, minWidth: { xs: 220, md: 320 }, maxWidth: 460, ...extra });

  const summary = (
    <Card sx={{ mb: 1.75 }}>
      <Grid container>
        {[
          ['Dão ROI', <><Box component="span" sx={{ color: p.pos }}>{win.length}</Box> <Typography component="span" variant="caption">de {all.length}</Typography></>, <>lucro somado {money(winP, currency)}</>],
          ['Com prejuízo', <Box key="l" component="span" sx={{ color: loss.length ? p.neg : undefined }}>{loss.length}</Box>, <>prejuízo somado <Profit v={lossP} /></>],
          ['Lucro sem os de prejuízo', <Box key="x" component="span" sx={{ color: data.totals.profit - lossP > 0 ? p.pos : undefined }}>{money(data.totals.profit - lossP, currency)}</Box>, <>lucro atual <Profit v={data.totals.profit} /></>],
        ].map(([l, v, foot], i) => (
          <Grid key={i} size={{ xs: 6, md: 2.6 }} sx={{ p: 2, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{l}</Typography>
            <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, my: 0.5 }} component="div">{v}</Typography>
            <Typography variant="caption" component="div">{foot}</Typography>
          </Grid>
        ))}
        <Grid size={{ xs: 12, md: 4.2 }} sx={{ p: 2 }}>
          <Typography variant="caption" component="div" sx={{ mb: 0.75 }}>Melhor ROI · mín. {money(minSp, currency, 0)} de spend</Typography>
          <Stack spacing={0.75}>
            {best.map((g, i) => (
              <Stack key={g.key} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Box sx={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, color: '#1a1300', flexShrink: 0, bgcolor: ['#f2c94c', '#cdd6e4', '#d99a5b'][i] }}>{i + 1}</Box>
                  <Typography noWrap sx={{ fontSize: 13.5 }}>{g.label}</Typography>
                </Stack>
                <RoiChip v={g.metrics.roi} />
              </Stack>
            ))}
            {!best.length && <Typography variant="caption">Sem placements com spend suficiente.</Typography>}
          </Stack>
        </Grid>
      </Grid>
      <Typography variant="caption" component="div" sx={{ px: 2, py: 1.1, borderTop: 1, borderColor: 'divider' }}>
        Spend do Google Ads por placement (Display, Demand Gen e YouTube; Pesquisa não tem placement e Performance Max não informa custo por placement). Revenue do Ad Manager pelo key-value <b>placement</b>, que o site recebe do <b>{'{placement}'}</b> na URL do anúncio.
      </Typography>
    </Card>
  );

  const toolbar = (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <TextField size="small" placeholder="Buscar placement ou subdomínio" value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} sx={{ width: { xs: '100%', md: 240 } }} />
      <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) { setMode(v); setLimit(50); } }} aria-label="Mostrar">
        {([['all', 'Todos', all.length], ['win', 'Dão ROI', win.length], ['loss', 'Prejuízo', loss.length]] as const).map(([k, l, n]) => (
          <ToggleButton key={k} value={k} sx={{ px: 1.25, textTransform: 'none', fontSize: 12.5 }}>{l}<Box component="span" sx={{ ml: 0.75, fontSize: 11, opacity: 0.65 }}>{n}</Box></ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption">Critério</Typography>
        <Select size="small" value={crit.k} onChange={(e) => setCrit({ ...crit, k: e.target.value as CritKey })} inputProps={{ 'aria-label': 'Métrica do critério' }}>{CRIT.map((c) => <MenuItem key={c.k} value={c.k}>{c.l}</MenuItem>)}</Select>
        <Select size="small" value={crit.op} onChange={(e) => setCrit({ ...crit, op: e.target.value as 'le' | 'ge' })} inputProps={{ 'aria-label': 'Comparação' }}>
          <MenuItem value="le">menor ou igual a</MenuItem><MenuItem value="ge">maior ou igual a</MenuItem>
        </Select>
        <TextField size="small" value={crit.v} onChange={(e) => { setCrit({ ...crit, v: e.target.value }); setLimit(50); }} placeholder={crit.k === 'roi' || crit.k === 'margin' ? 'ex.: -10' : 'ex.: 5'} sx={{ width: 90 }} slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': 'Valor' } }} />
        <Typography variant="caption" sx={{ minWidth: 14 }}>{unitTxt}</Typography>
        {(critOn || ql || mode !== 'all') && <Button size="small" onClick={() => { setQ(''); setMode('all'); setCrit({ ...crit, v: '' }); setLimit(50); }}>Limpar</Button>}
      </Stack>
    </Stack>
  );

  let table: ReactNode;
  if (mobile) {
    const mm = ms.filter((k) => k !== 'roi').slice(0, 6);
    const grid = (r: { metrics: Metrics; roiDays: PlacementRow['roiDays'] }) => (
      <Grid container spacing={1} sx={{ mt: 1.25 }}>{mm.map((k) => <Grid key={k} size={4}><Typography variant="caption" sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{METRIC_DEFS[k].label}</Typography><Typography component="div" sx={{ fontWeight: 600, fontSize: 13.5 }}><MetricValue k={k} v={metricValue(r.metrics, r.roiDays, k)} /></Typography></Grid>)}</Grid>
    );
    table = (
      <Box>
        <Box sx={{ p: 1.75, bgcolor: p.panel2, borderBottom: 1, borderColor: 'divider' }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><b>Total · {groups.length} domínios</b><RoiChip v={tot.metrics.roi} /></Stack>{grid(tot)}</Box>
        {page.map((g) => {
          const m = multi(g), o = m && isOpen(g);
          return (
            <Fragment key={g.key}>
              <Box sx={{ p: 1.75, borderBottom: 1, borderColor: 'divider', boxShadow: rowShadow(g.metrics) }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>{m && <Toggle open={o} onClick={() => toggle(g.key)} />}<Box sx={{ flex: 1, minWidth: 0 }}>{nameOf(g, m ? g.children.length : undefined)}</Box><RoiChip v={g.metrics.roi} />{drawerBtn(g.key, g.label, 'root')}</Stack>
                {grid(g)}
              </Box>
              {o && kidsOf(g).map((c) => (
                <Box key={c.key} sx={{ p: 1.5, pl: 3.5, bgcolor: p.rowL1, borderBottom: 1, borderColor: 'divider' }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontFamily: p.mono, fontSize: 12.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>{c.key}</Typography><RoiChip v={c.metrics.roi} /></Stack>{grid(c)}
                </Box>
              ))}
            </Fragment>
          );
        })}
        {!page.length && <Typography variant="caption" sx={{ p: 4, display: 'block', textAlign: 'center' }}>Nenhum placement para os filtros atuais.</Typography>}
      </Box>
    );
  } else {
    table = (
      <TableContainer>
        <Table size="medium">
          <TableHead><TableRow>{head('name', 'Domínio / Placement', false)}{ms.map((k) => head(k, METRIC_DEFS[k].label))}</TableRow></TableHead>
          <TableBody>
            <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 600 } }}>
              <TableCell sx={sticky(p.panel2)}>Total{filtered ? ' (filtrado)' : ''} · {groups.length} domínios</TableCell>
              {ms.map((k) => <PCell key={k} k={k} r={tot} />)}
            </TableRow>
            {page.map((g) => {
              const m = multi(g), o = m && isOpen(g);
              return (
                <Fragment key={g.key}>
                  <TableRow hover>
                    <TableCell sx={sticky(p.panel, { boxShadow: rowShadow(g.metrics) })}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>{m ? <Toggle open={o} onClick={() => toggle(g.key)} /> : <Box sx={{ width: 22, flexShrink: 0 }} />}<Box sx={{ flex: 1, minWidth: 0 }}>{nameOf(g, m ? g.children.length : undefined)}</Box>{drawerBtn(g.key, g.label, 'root')}</Stack>
                    </TableCell>
                    {ms.map((k) => <PCell key={k} k={k} r={g} />)}
                  </TableRow>
                  {o && kidsOf(g).map((c) => (
                    <TableRow key={c.key} sx={{ '& td': { bgcolor: p.rowL1 } }}>
                      <TableCell sx={sticky(p.rowL1, { pl: 6.5, boxShadow: rowShadow(c.metrics) })}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography sx={{ flex: 1, fontFamily: p.mono, fontSize: 12.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>{c.key}</Typography>{drawerBtn(c.key, c.key, 'host')}</Stack>
                      </TableCell>
                      {ms.map((k) => <PCell key={k} k={k} r={c} />)}
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
            {!page.length && <TableRow><TableCell colSpan={ms.length + 1} align="center" sx={{ py: 4, color: 'text.disabled' }}>Nenhum placement para os filtros atuais.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, color: 'text.secondary' }}>
        <TrackChangesRoundedIcon sx={{ fontSize: 16, color: p.accent }} /><Typography sx={{ fontSize: 13 }}>Mostrando <b style={{ color: p.fg }}>{scopeTxt}</b></Typography>
      </Stack>
      <Box sx={{ mb: 1.75 }}><KpiRow m={data.totals} cmp={data.comparison} split={false} /></Box>
      {summary}
      <Card>
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h2">Placements</Typography><Typography variant="caption">{groups.length} domínio{groups.length === 1 ? '' : 's'} · {nPl} placements</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" onClick={expandAll}>{anyOpen ? 'Recolher subdomínios' : 'Abrir subdomínios'}</Button>
          <MetricPicker screen="placements" />
        </Stack>
        {toolbar}
        {table}
        {groups.length > limit && (
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', alignItems: 'center', p: 1.5 }}>
            <Typography variant="caption">Mostrando {limit} de {groups.length}</Typography>
            <Button size="small" variant="outlined" onClick={() => setLimit(limit + 50)}>Mostrar mais {Math.min(50, groups.length - limit)}</Button>
          </Stack>
        )}
      </Card>
      <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>
        Clique no nome de uma coluna para ordenar (clique de novo para inverter). A seta abre os subdomínios (lp., m., blog.…) agrupados no domínio principal. O ícone de lista mostra quais campanhas gastaram naquele placement. ROI D-1 a D-3 sempre olham os últimos dias, independente do período. Sessions e RPS dependem do tracking próprio do site.
      </Typography>
      {drawer && <PlacementDrawer sel={sel} spec={drawer} onClose={() => setDrawer(null)} />}
    </>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <IconButton size="small" onClick={onClick} aria-label="Ver subdomínios" aria-expanded={open} sx={{ width: 22, height: 22, borderRadius: 1.25, border: 0, bgcolor: open ? 'rgba(91,155,255,.14)' : 'rgba(255,255,255,.06)', color: open ? 'primary.light' : 'text.secondary', flexShrink: 0 }}>
      <ChevronRightRoundedIcon sx={{ fontSize: 16, transform: open ? 'rotate(90deg)' : 'none', transition: '.15s' }} />
    </IconButton>
  );
}
/** Célula de métrica: Margem com fundo colorido (igual Relatórios), o resto pelo formato padrão. */
function PCell({ k, r }: { k: MetricKey; r: { metrics: Metrics; roiDays: PlacementRow['roiDays'] } }) {
  const { pluto: p } = useTheme();
  const v = metricValue(r.metrics, r.roiDays, k);
  if (k === 'margin') {
    const tone = { neg: [p.neg, 0.28, '#ffc2c9'], lo: [p.neg, 0.13, '#ff9aa5'], mid: [p.warn, 0.15, p.warn], hi: [p.pos, 0.15, p.pos], na: [p.na, 0, p.fg] }[marginClass(v)] as [string, number, string];
    return <TableCell align="right" sx={{ boxShadow: `inset 0 0 0 999px ${alpha(tone[0], tone[1])}`, color: tone[2], fontWeight: 600 }}>{pct0(v)}</TableCell>;
  }
  return <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><MetricValue k={k} v={v} /></TableCell>;
}

/** Soma dos grupos visíveis (quando a lista está filtrada). ROI D-x sai da soma de spend/revenue dos últimos 4 dias. */
function sumGroups(gs: PlacementGroup[]): { metrics: Metrics; roiDays: PlacementRow['roiDays'] } {
  const add = (k: keyof Metrics) => gs.reduce((a, g) => a + ((g.metrics[k] as number) || 0), 0);
  const spend = add('spend'), revenue = add('revenue'), sessions = add('sessions'), impressions = add('impressions'), rsv = add('responsesServed');
  const clk = add('trafficClicks'), ti = add('trafficImpressions'), ar = add('adRequests'), ac = add('adClicks');
  const profit = revenue - spend;
  const vw = gs.reduce((a, g) => a + (g.metrics.viewability ?? 0) * g.metrics.impressions / 100, 0);
  const m: Metrics = {
    revenue, grossRevenue: add('grossRevenue'), spend, googleSpend: add('googleSpend'), metaSpend: 0, iva: 0, googleShare: spend ? 100 : null, metaShare: spend ? 0 : null,
    profit, roi: spend > 0 ? (profit / spend) * 100 : null, margin: revenue > 0 ? (profit / revenue) * 100 : null,
    rps: sessions ? (revenue / sessions) * 1000 : null, ecpm: impressions ? (revenue / impressions) * 1000 : null,
    impressions, adRequests: ar, responsesServed: rsv, dropOffRate: rsv ? ((rsv - impressions) / rsv) * 100 : null, fillRate: ar ? (impressions / ar) * 100 : null,
    ctr: impressions ? (ac / impressions) * 100 : null, adClicks: ac, viewability: impressions ? (vw / impressions) * 100 : null, sessions,
    trafficClicks: clk, trafficImpressions: ti, trafficCtr: ti ? (clk / ti) * 100 : null, cpc: clk ? spend / clk : null,
    attributedRevenue: revenue, unattributedRevenue: 0, attributionRate: revenue ? 100 : null,
  };
  const rd = [0, 1, 2, 3].map((i) => { const sp = gs.reduce((a, g) => a + (g.recent[i]?.[0] ?? 0), 0), rv = gs.reduce((a, g) => a + (g.recent[i]?.[1] ?? 0), 0); return sp > 0 ? ((rv - sp) / sp) * 100 : null; });
  return { metrics: m, roiDays: { today: rd[0], d1: rd[1], d2: rd[2], d3: rd[3] } };
}
