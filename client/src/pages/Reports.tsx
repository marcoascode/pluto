import { Box, Card, CardHeader, Chip, MenuItem, Select, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography, alpha, useTheme } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { useMemo, useRef, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useDailyReport, useMonthlyReport } from '@/hooks/queries';
import { MetricPicker, usePicked } from '@/components/ui/MetricPicker';
import { ErrorBox, PageHead } from '@/components/ui/States';
import { MetricValue, Money, Profit, RoiText0 } from '@/components/ui/Values';
import { pct0 } from '@/lib/format';
import { marginClass, METRIC_DEFS, metricValue, type MetricKey } from '@/lib/metrics';
import { lastMonths, monthLabel } from '@/lib/period';
import type { Metrics, ReportRow } from '@/types/api';

const REPORT_MONTHS = 14;

// Barrinha de preenchimento de dinheiro nas colunas de custo e receita
const BAR = new Set<MetricKey>(['spend', 'revenue', 'profit', 'googleSpend', 'metaSpend', 'iva', 'adManagerRevenue']);

// 1. Métricas obrigatórias que NÃO dependem do MetricPicker
const BLOCKS_MANDATORY = {
  resultado: ['revenue', 'spend', 'iva', 'roi'] as MetricKey[],
  despesas: ['metaSpend', 'googleSpend'] as MetricKey[],
  receita: ['adManagerRevenue'] as MetricKey[],
};

// 2. Ordem estrita das métricas opcionais para cada bloco (só aparecem se "ms" contiver)
const BLOCKS_OPTIONAL = {
  resultado: ['margin', 'profit', 'unattributedRevenue', 'attributionRate'] as MetricKey[],
  // Nota: A chave "margin" assume o papel do "ROI %"
  despesas: ['googleSpend', 'metaSpend', 'iva', 'googleShare', 'metaShare', 'metaImpressions', 'metaClicks', 'metaCpc'] as MetricKey[],
  // Obs: Se Custo Google/Meta forem os mesmos que os obrigatórios, decida se eles devem repetir (aqui mantivemos as chaves conforme solicitado na lista)
  receita: ['adManagerImpressions', 'adManagerClicks', 'adManagerCpc', 'ctr', 'adManagerEcpm', 'sessions', 'rps', 'responsesServed', 'viewability', 'dropOff', 'fillRate'] as MetricKey[],
};

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

function ReportCell({ k, m, max, bold }: { k: MetricKey; m: Metrics; max?: number; bold?: boolean }) {
  const { pluto: p } = useTheme();
  const v = metricValue(m, undefined, k);
  if (k === 'margin') {
    const c = marginClass(v);
    const tone = { neg: [p.neg, 0.28, '#ffc2c9'], lo: [p.neg, 0.13, '#ff9aa5'], mid: [p.warn, 0.15, p.warn], hi: [p.pos, 0.15, p.pos], na: [p.na, 0, p.fg] }[c] as [string, number, string];
    return <TableCell align="right" sx={{ boxShadow: `inset 0 0 0 999px ${alpha(tone[0], tone[1])}`, color: tone[2], fontWeight: 600 }}>{pct0(v)}</TableCell>;
  }
  if (k === 'roi') return <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined }}><RoiText0 v={v} /></TableCell>;
  if (k === 'metaShare' || k === 'googleShare') return <TableCell align="right" sx={{ color: bold ? 'text.primary' : p.muted, fontWeight: bold ? 600 : undefined }}>{pct0(v)}</TableCell>;
  if (BAR.has(k)) {
    const val = k === 'profit' ? <Profit v={v} /> : <Money v={v} />;
    return (
      <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined }}>
        {max == null ? val : <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><span>{val}</span><Bar v={v} max={max} neg={k === 'profit' && (v ?? 0) < 0} /></Stack>}
      </TableCell>
    );
  }
  return <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined }}><MetricValue k={k} v={v} /></TableCell>;
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
}

function ReportTable({ first, rows, total, totalLabel, label, ms, onRowClick }: TableProps) {
  const { pluto: p } = useTheme();
  const [sort, setSort] = useState<{ k: SortKey; d: 'asc' | 'desc' }>({ k: 'key', d: 'desc' });

  // 3. Montagem da lista final consolidada (Obrigatórias + Opcionais Ativadas)
  const activeResultado = useMemo(() => [
    ...BLOCKS_MANDATORY.resultado,
    ...BLOCKS_OPTIONAL.resultado.filter(k => ms.includes(k))
  ], [ms]);

  const activeDespesas = useMemo(() => [
    ...BLOCKS_MANDATORY.despesas,
    ...BLOCKS_OPTIONAL.despesas.filter(k => ms.includes(k))
  ], [ms]);

  const activeReceita = useMemo(() => [
    ...BLOCKS_MANDATORY.receita,
    ...BLOCKS_OPTIONAL.receita.filter(k => ms.includes(k))
  ], [ms]);

  const allMs = useMemo(() => [
    ...activeResultado, 
    ...activeDespesas, 
    ...activeReceita
  ] as MetricKey[], [activeResultado, activeDespesas, activeReceita]);

  const list = useMemo(() => rows.slice().sort((a, b) => {
    const dir = sort.d === 'asc' ? 1 : -1;
    if (sort.k === 'key') return a.key.localeCompare(b.key) * dir;
    return ((metricValue(a.metrics, undefined, sort.k) ?? -Infinity) - (metricValue(b.metrics, undefined, sort.k) ?? -Infinity)) * dir;
  }), [rows, sort]);

  const max = useMemo(() => Object.fromEntries(
      allMs.filter((k) => BAR.has(k)).map((k) => [k, Math.max(0, ...rows.map((r) => Math.abs(metricValue(r.metrics, undefined, k) ?? 0)))]))
  , [rows, allMs]);

  const head = (k: SortKey, l: string) => (
    <TableCell key={k} align={k === 'key' ? 'left' : 'right'} sx={k === 'key' ? { position: 'sticky', left: 0, zIndex: 3 } : undefined}>
      <TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{l}</TableSortLabel>
    </TableCell>
  );

  const firstCell = { position: 'sticky', left: 0, zIndex: 1, bgcolor: p.panel, boxShadow: `inset -1px 0 0 ${p.line}` } as const;
  const blockHeadStyle = { bgcolor: p.panel2, borderBottom: `1px solid ${p.line2}`, borderRight: `1px solid ${p.line}`, fontWeight: 600, px: 1, py: 0.5 };

  return (
    <TableContainer>
      <Table size="small" sx={{ '& td, & th': { px: 1.1, py: 1.1 } }}>
        <TableHead>
          {/* Cabeçalhos Fixos por Bloco */}
          <TableRow>
            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, bgcolor: p.panel, borderBottom: 'none' }}></TableCell>
            {activeResultado.length > 0 && <TableCell colSpan={activeResultado.length} align="center" sx={blockHeadStyle}>Bloco 1: Resultado</TableCell>}
            {activeDespesas.length > 0 && <TableCell colSpan={activeDespesas.length} align="center" sx={blockHeadStyle}>Bloco 2: Despesas (Ads)</TableCell>}
            {activeReceita.length > 0 && <TableCell colSpan={activeReceita.length} align="center" sx={{ ...blockHeadStyle, borderRight: 'none' }}>Bloco 3: Receita (AD Manager)</TableCell>}
          </TableRow>
          {/* Títulos das colunas */}
          <TableRow>
            {head('key', first)}
            {allMs.map((k) => head(k, METRIC_DEFS[k]?.label || k))}
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow sx={{ '& > td': { bgcolor: `${p.panel2} !important`, borderBottomColor: p.line2 } }}>
            <TableCell sx={{ ...firstCell, bgcolor: p.panel2, fontWeight: 600 }}>{totalLabel}</TableCell>
            {allMs.map((k) => <ReportCell key={k} k={k} m={total} bold />)}
          </TableRow>
          {list.map((r) => (
            <TableRow key={r.key} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(r.key) : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined }}>
              <TableCell sx={firstCell}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Typography component="span" sx={{ fontSize: 'inherit', color: onRowClick ? 'primary.light' : 'inherit' }}>{label(r.key)}</Typography>
                  {r.partial && <Chip size="small" label="parcial" title="Hoje e D-1 a D-3 podem sofrer ajustes" sx={{ height: 18, fontSize: 11, color: p.warn, bgcolor: alpha(p.warn, 0.15) }} />}
                </Stack>
              </TableCell>
              {allMs.map((k) => <ReportCell key={k} k={k} m={r.metrics} max={max[k]} />)}
            </TableRow>
          ))}
          {!list.length && <TableRow><TableCell colSpan={allMs.length + 1} align="center" sx={{ py: 4, color: 'text.disabled' }}>Sem dados.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function ReportsPage() {
  const f = useFilters();
  const months = useMemo(() => lastMonths(REPORT_MONTHS), []);
  const [month, setMonth] = useState(months[0]);
  const ms = usePicked('reports');
  const daily = useDailyReport(month);
  const monthly = useMonthlyReport(REPORT_MONTHS);
  const top = useRef<HTMLDivElement>(null);
  const goMonth = (m: string) => { setMonth(m); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const loading = <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={260} /></Box>;
  return (
    <>
      <PageHead title="Relatórios" sub={`${f.domain || 'Todos os domínios'} · valores em ${f.currency}`} right={<MetricPicker screen="reports" />} />
      <Card ref={top} sx={{ scrollMarginTop: 80 }}>
        <CardHeader title="Resultados diários" subheader={daily.data ? `${monthLabel(month)} · ${daily.data.days.length} ${daily.data.days.length === 1 ? 'dia' : 'dias'}` : monthLabel(month)}
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
        <CardHeader title="Resultados mensais" subheader={`Últimos ${REPORT_MONTHS} meses · clique no mês para ver os dias`} />
        {monthly.error && !monthly.data ? <Box sx={{ p: 2 }}><ErrorBox error={monthly.error} retry={() => monthly.refetch()} /></Box>
          : !monthly.data ? loading
          : <ReportTable first="Mês" rows={monthly.data.months} total={monthly.data.total} totalLabel={`Total ${REPORT_MONTHS} meses`} label={monthTitle} ms={ms} onRowClick={goMonth} />}
      </Card>
      <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>
        Receita = receita do Ad Manager já sem a parte da Network (revShare do domínio) · Despesas (Ads) = Google Ads + Meta Ads + IVA · IVA = 13,83% sobre o gasto da Meta ·
        Meta % e Google % = participação na despesa · Margem (ROI %) e ROI sobre a Receita · Drop-off = respostas servidas que não viraram impressão.
      </Typography>
    </>
  );
}