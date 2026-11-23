import { Alert, Box, Button, Card, CardHeader, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Select, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useAdminMutation, useDailyReport, useMonthlyReport } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { ErrorBox, PageHead } from '@/components/ui/States';
import { BlockHeaderRow, blockStarts } from '@/components/ui/MetricBlocks';
import { MetricValue, Money, Profit, RoiText0 } from '@/components/ui/Values';
import { pct0 } from '@/lib/format';
import { marginClass, METRIC_DEFS, metricCurrency, metricValue, type MetricKey } from '@/lib/metrics';
import { lastMonths, monthLabel } from '@/lib/period';
import type { MonthFx, Metrics, ReportRow } from '@/types/api';

const REPORT_MONTHS = 14;
/** Colunas de dinheiro que ganham a barrinha proporcional ao maior valor da tabela. */
const BAR = new Set<MetricKey>(['spend', 'revenue', 'profit', 'googleSpend', 'metaSpend', 'iva', 'unattributedRevenue']);

const dayLabel = (iso: string) => iso.split('-').reverse().join('/');
const monthTitle = (ym: string) => monthLabel(ym).replace(/^./, (c) => c.toUpperCase());

function Bar({ v, max, neg }: { v: number | null; max: number; neg?: boolean }) {
  const { pluto: p } = useTheme();
  const w = max > 0 && v != null ? Math.max(2, Math.min(100, (Math.abs(v) / max) * 100)) : 0;
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' }, width: 36, height: 6, borderRadius: 3, bgcolor: p.panel3, overflow: 'hidden', flexShrink: 0 }}>
      <Box sx={{ width: `${w}%`, height: '100%', borderRadius: 3, bgcolor: neg ? p.neg : p.accent }} />
    </Box>
  );
}

/** Uma célula do relatório: Margem com fundo colorido, ROI colorido, % de custo apagado, dinheiro com barra. */
function ReportCell({ k, m, max, bold, edge }: { k: MetricKey; m: Metrics; max?: number; bold?: boolean; edge?: boolean }) {
  const { pluto: p } = useTheme();
  const v = metricValue(m, undefined, k);
  const e = edge ? { borderLeft: `1px solid ${p.line2}` } : {};
  if (k === 'margin') {
    const c = marginClass(v);
    const tone = { neg: [p.neg, 0.28, '#ffc2c9'], lo: [p.neg, 0.13, '#ff9aa5'], mid: [p.warn, 0.15, p.warn], hi: [p.pos, 0.15, p.pos], na: [p.na, 0, p.fg] }[c] as [string, number, string];
    return <TableCell align="right" sx={{ boxShadow: `inset 0 0 0 999px ${alpha(tone[0], tone[1])}`, color: tone[2], fontWeight: 600, ...e }}>{pct0(v)}</TableCell>;
  }
  if (k === 'roi') return <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined, ...e }}><RoiText0 v={v} /></TableCell>;
  if (k === 'metaShare' || k === 'googleShare') return <TableCell align="right" sx={{ color: bold ? 'text.primary' : p.muted, fontWeight: bold ? 600 : undefined, ...e }}>{pct0(v)}</TableCell>;
  if (BAR.has(k)) {
    const val = k === 'profit' ? <Profit v={v} /> : <Money v={v} cur={metricCurrency(k)} />;
    return (
      <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined, ...e }}>
        {max == null ? val : <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><span>{val}</span><Bar v={v} max={max} neg={k === 'profit' && (v ?? 0) < 0} /></Stack>}
      </TableCell>
    );
  }
  return <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined, ...e }}><MetricValue k={k} v={v} /></TableCell>;
}

type SortKey = 'key' | MetricKey;
interface TableProps {
  first: string;
  rows: ReportRow[];
  total: Metrics;
  totalLabel: string;
  label: (key: string) => string;
  ms: MetricKey[];
  onRowClick?: (key: string) => void;
  /** Coluna extra logo depois da primeira (ex.: cotação do mês). */
  extra?: { head: ReactNode; total: ReactNode; cell: (key: string) => ReactNode };
}
function ReportTable({ first, rows, total, totalLabel, label, ms, onRowClick, extra }: TableProps) {
  const { pluto: p } = useTheme();
  const [sort, setSort] = useState<{ k: SortKey; d: 'asc' | 'desc' }>({ k: 'key', d: 'desc' });
  const list = useMemo(() => rows.slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'key') return a.key.localeCompare(b.key) * dir;
    return ((metricValue(a.metrics, undefined, sort.k) ?? -Infinity) - (metricValue(b.metrics, undefined, sort.k) ?? -Infinity)) * dir;
  }), [rows, sort]);
  const max = useMemo(() => Object.fromEntries(ms.filter((k) => BAR.has(k)).map((k) => [k, Math.max(0, ...rows.map((r) => Math.abs(metricValue(r.metrics, undefined, k) ?? 0)))])), [rows, ms]);
  const starts = useMemo(() => blockStarts(ms), [ms]);
  const head = (k: SortKey, l: string) => (
    <TableCell key={k} align={k === 'key' ? 'left' : 'right'} rowSpan={k === 'key' ? 2 : undefined}
      sx={k === 'key' ? { position: 'sticky', left: 0, zIndex: 3, verticalAlign: 'bottom' } : starts.has(k) ? { borderLeft: `1px solid ${p.line2}` } : undefined}>
      <TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel>
    </TableCell>
  );
  const firstCell = { position: 'sticky', left: 0, zIndex: 1, bgcolor: p.panel, boxShadow: `inset -1px 0 0 ${p.line}` } as const;
  return (
    <TableContainer>
      <Table size="small" sx={{ '& td, & th': { px: 1.1, py: 1.1 } }}>
        {/* relatório misto: colunas em 3 blocos (Resultados · Despesas · Receitas) */}
        <TableHead><BlockHeaderRow ms={ms} lead={<>{head('key', first)}{extra && <TableCell rowSpan={2} align="right" sx={{ verticalAlign: 'bottom', whiteSpace: 'nowrap' }}>{extra.head}</TableCell>}</>} /><TableRow>{ms.map((k) => head(k, METRIC_DEFS[k].label))}</TableRow></TableHead>
        <TableBody>
          <TableRow sx={{ '& > td': { bgcolor: `${p.panel2} !important`, borderBottomColor: p.line2 } }}>
            <TableCell sx={{ ...firstCell, bgcolor: p.panel2, fontWeight: 600 }}>{totalLabel}</TableCell>
            {extra && <TableCell align="right" sx={{ color: p.muted }}>{extra.total}</TableCell>}
            {ms.map((k) => <ReportCell key={k} k={k} m={total} bold edge={starts.has(k)} />)}
          </TableRow>
          {list.map((r) => (
            <TableRow key={r.key} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(r.key) : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined }}>
              <TableCell sx={firstCell}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Typography component="span" sx={{ fontSize: 'inherit', color: onRowClick ? 'primary.light' : 'inherit' }}>{label(r.key)}</Typography>
                  {r.partial && <Chip size="small" label="parcial" title="Hoje e D-1 a D-3 podem sofrer ajustes" sx={{ height: 18, fontSize: 11, color: p.warn, bgcolor: alpha(p.warn, 0.15) }} />}
                </Stack>
              </TableCell>
              {extra && <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap', cursor: 'default' }}>{extra.cell(r.key)}</TableCell>}
              {ms.map((k) => <ReportCell key={k} k={k} m={r.metrics} max={max[k]} edge={starts.has(k)} />)}
            </TableRow>
          ))}
          {!list.length && <TableRow><TableCell colSpan={ms.length + 1 + (extra ? 1 : 0)} align="center" sx={{ py: 4, color: 'text.disabled' }}>Sem dados.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const rate4 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(4).replace('.', ','));

/** Cotação do ROI do mês: travada (cadeado fechado) ou a atual c/ deságio (flutua). Admin/SuperAdmin trava e destrava. */
function MonthRateCell({ fx, canLock, onEdit }: { fx: MonthFx; canLock: boolean; onEdit: () => void }) {
  const { pluto: p } = useTheme();
  const tip = fx.locked
    ? `Cotação travada${fx.lockedBy ? ` por ${fx.lockedBy}` : ''}${fx.lockedAt ? ` em ${new Date(fx.lockedAt).toLocaleDateString('pt-BR')}` : ''}${fx.note ? ` · ${fx.note}` : ''}`
    : 'Cotação atual USD/BRL c/ deságio (flutua até o câmbio do mês ser travado)';
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
      <Tooltip title={tip}><Box component="span" sx={{ color: fx.locked ? p.fg : p.muted, fontWeight: fx.locked ? 600 : undefined, fontVariantNumeric: 'tabular-nums' }}>{rate4(fx.rate)}</Box></Tooltip>
      {canLock
        ? <Tooltip title={fx.locked ? 'Alterar ou destravar a cotação do mês' : 'Travar cotação do mês'}>
            <IconButton size="small" onClick={onEdit} aria-label="Travar cotação" sx={{ color: fx.locked ? p.warn : p.muted }}>
              {fx.locked ? <LockOutlinedIcon sx={{ fontSize: 16 }} /> : <LockOpenOutlinedIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        : fx.locked && <LockOutlinedIcon sx={{ fontSize: 14, color: p.warn }} />}
    </Stack>
  );
}

/** Travar cotação: a cotação do câmbio do mês passa a valer para o ROI daquele mês e não flutua mais. */
function LockDialog({ month, fx, current, onClose }: { month: string; fx: MonthFx; current: number | null; onClose: () => void }) {
  const [rate, setRate] = useState(fx.locked && fx.rate != null ? String(fx.rate).replace('.', ',') : '');
  const [note, setNote] = useState(fx.note ?? '');
  const inv = ['reportMonthly', 'reportDaily', 'dashboard', 'domains', 'domain', 'campaigns', 'children', 'countries', 'urls', 'companyOverview', 'placements', 'finance'].map((k) => [k]);
  const save = useAdminMutation(adminApi.lockFx, inv);
  const del = useAdminMutation(adminApi.unlockFx, inv);
  const v = Number(rate.replace(/\./g, '').replace(',', '.'));
  const ok = Number.isFinite(v) && v > 0 && v < 100;
  const err = (save.error ?? del.error) as Error | null;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Travar cotação · {monthTitle(month)}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Informe a cotação USD/BRL aplicada no câmbio dos dólares do Ad Manager deste mês. Ela passa a valer para o ROI do mês
          (ROI = Receita × cotação − Despesas) em todos os relatórios e domínios, e deixa de flutuar.
        </Typography>
        <Stack spacing={2}>
          <TextField label="Cotação USD/BRL" value={rate} onChange={(e) => setRate(e.target.value)} autoFocus placeholder={current != null ? rate4(current) : '5,0000'}
            helperText={`Atual c/ deságio: ${rate4(current)}`} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          <TextField label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: contrato de câmbio nº…" slotProps={{ htmlInput: { maxLength: 300 } }} />
          {err && <Alert severity="error">{err.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {fx.locked && <Button color="warning" startIcon={<LockOpenOutlinedIcon />} disabled={del.isPending} onClick={() => del.mutate(month, { onSuccess: onClose })} sx={{ mr: 'auto' }}>Destravar</Button>}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" startIcon={<LockOutlinedIcon />} disabled={!ok || save.isPending} onClick={() => save.mutate({ month, rate: v, note: note.trim() || null }, { onSuccess: onClose })}>Travar</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Relatórios: resultados por dia (mês escolhido) e por mês (últimos 14). Usa só o Domínio do topo.
 *  Receita em US$ · Despesas em R$ · ROI (R$) = Receita × cotação do mês − Despesas. */
export default function ReportsPage() {
  const f = useFilters();
  const months = useMemo(() => lastMonths(REPORT_MONTHS), []);
  const [month, setMonth] = useState(months[0]);
  const ms = usePicked('reports');
  const daily = useDailyReport(month);
  const monthly = useMonthlyReport(REPORT_MONTHS);
  const top = useRef<HTMLDivElement>(null);
  const goMonth = (m: string) => { setMonth(m); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const [lock, setLock] = useState<string | null>(null);
  const fxOf = useMemo(() => new Map((monthly.data?.months ?? []).map((m) => [m.key, m.fx])), [monthly.data]);
  const dailyFx = fxOf.get(month);
  const loading = <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={260} /></Box>;
  return (
    <>
      <PageHead title="Relatórios" sub={`${f.domain || 'Todos os domínios'} · receita em US$ · despesas e ROI em R$`} right={<MetricPicker screen="reports" />} />
      <Card ref={top} sx={{ scrollMarginTop: 80 }}>
        <CardHeader title="Resultados diários" subheader={`${daily.data ? `${monthLabel(month)} · ${daily.data.days.length} ${daily.data.days.length === 1 ? 'dia' : 'dias'}` : monthLabel(month)}${dailyFx ? ` · cotação do ROI ${rate4(dailyFx.rate)}${dailyFx.locked ? ' (travada)' : ' (atual c/ deságio)'}` : ''}`}
          action={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              <Select size="small" value={month} onChange={(e) => setMonth(e.target.value)} inputProps={{ 'aria-label': 'Mês do relatório diário' }}>
                {months.map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
              </Select>
            </Stack>
          } />
        {daily.error && !daily.data ? <Box sx={{ p: 2 }}><ErrorBox error={daily.error} retry={() => daily.refetch()} /></Box>
          : !daily.data ? loading
          : <ReportTable first="Dia" rows={daily.data.days} total={daily.data.total} totalLabel="Total do mês" label={dayLabel} ms={ms} />}
      </Card>
      <Card sx={{ mt: 1.75 }}>
        <CardHeader title="Resultados mensais" subheader={`Últimos ${REPORT_MONTHS} meses · clique no mês para ver os dias${monthly.data?.canLock ? ' · use o cadeado para travar a cotação do mês após o câmbio' : ''}`} />
        {monthly.error && !monthly.data ? <Box sx={{ p: 2 }}><ErrorBox error={monthly.error} retry={() => monthly.refetch()} /></Box>
          : !monthly.data ? loading
          : <ReportTable first="Mês" rows={monthly.data.months} total={monthly.data.total} totalLabel={`Total ${REPORT_MONTHS} meses`} label={monthTitle} ms={ms} onRowClick={goMonth}
              extra={{
                head: 'Cotação',
                total: rate4(monthly.data.total.fxRate),
                cell: (k) => { const fx = fxOf.get(k); return fx ? <MonthRateCell fx={fx} canLock={monthly.data!.canLock} onEdit={() => setLock(k)} /> : '—'; },
              }} />}
      </Card>
      {lock && fxOf.get(lock) && <LockDialog month={lock} fx={fxOf.get(lock)!} current={monthly.data?.currentRate ?? null} onClose={() => setLock(null)} />}
      <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>
        Receita (US$) = Ad Manager já sem a parte da Network (revShare do domínio) · Despesas (R$) = Google Ads + Meta Ads + IVA · IVA = 13,83% sobre o custo da Meta ·
        ROI (R$) = (Receita − Receita × revShare) × cotação c/ deságio − Despesas Google Ads − Despesas Meta Ads − IVA (mês com cotação travada usa a travada) · ROI % = ROI ÷ Despesas · Margem = ROI ÷ (Receita × cotação) · RNA = receita não atribuída · CPC-L, CPR e CPL = custo Meta (sem IVA) ÷ cliques no link, conversas iniciadas e leads ·
        eCPM = Receita ÷ Impressões × 1000 · Drop-off = respostas servidas que não viraram impressão.
      </Typography>
    </>
  );
}
