import { Box, Paper, Stack, Typography, useMediaQuery, useTheme, type Theme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsTooltipContainer, useAxesTooltip, type ChartsTooltipProps } from '@mui/x-charts/ChartsTooltip';
import { useXScale, useYScale } from '@mui/x-charts/hooks';
import { createContext, useContext, type ReactNode } from 'react';

/** Linhas do tooltip para o índice (dia) em foco. */
type TipRows = (i: number) => [string, ReactNode, string?][];
const TipCtx = createContext<{ rows: TipRows; labels: string[] } | null>(null);

/** Tooltip próprio (MUI Paper) mostrando todas as métricas do dia. */
function RichTooltip(props: ChartsTooltipProps) {
  const ctx = useContext(TipCtx);
  const axes = useAxesTooltip();
  const { pluto: p } = useTheme();
  if (!ctx || !axes?.length) return null;
  const i = axes[0].dataIndex;
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <Paper sx={{ p: 1.25, minWidth: 180, bgcolor: 'rgba(33,55,98,.97)', border: `1px solid ${p.line2}`, borderRadius: 2.5 }}>
        <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>{ctx.labels[i]}</Typography>
        {ctx.rows(i).map(([l, v, c]) => (
          <Stack key={l} direction="row" spacing={2} sx={{ justifyContent: 'space-between', fontSize: 12, py: 0.1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }} >{c && <Box sx={{ width: 10, height: 3, borderRadius: 1, bgcolor: c }} />}<span>{l}</span></Stack>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</b>
          </Stack>
        ))}
      </Paper>
    </ChartsTooltipContainer>
  );
}

/** Pinta a área entre duas séries: verde quando a > b (lucro), vermelho quando a < b (prejuízo). */
function ProfitBand({ a, b }: { a: (number | null)[]; b: (number | null)[] }) {
  const x = useXScale<'point'>();
  const y = useYScale<'linear'>();
  const { pluto: p } = useTheme();
  const dom = x.domain() as string[];
  const X = (i: number) => x(dom[i]) ?? 0;
  const out: ReactNode[] = [];
  const quad = (k: string, x0: number, a0: number, b0: number, x1: number, a1: number, b1: number, pos: boolean) =>
    <path key={k} d={`M${x0},${y(a0)} L${x1},${y(a1)} L${x1},${y(b1)} L${x0},${y(b0)} Z`} fill={pos ? p.pos : p.neg} fillOpacity={0.17} />;
  for (let i = 0; i < dom.length - 1; i++) {
    const a0 = a[i], a1 = a[i + 1], b0 = b[i], b1 = b[i + 1];
    if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
    const d0 = a0 - b0, d1 = a1 - b1, x0 = X(i), x1 = X(i + 1);
    if (d0 * d1 >= 0) out.push(quad('q' + i, x0, a0, b0, x1, a1, b1, d0 + d1 >= 0));
    else { const t = d0 / (d0 - d1); const xm = x0 + (x1 - x0) * t, ym = a0 + (a1 - a0) * t; out.push(quad('q' + i + 'a', x0, a0, b0, xm, ym, ym, d0 > 0), quad('q' + i + 'b', xm, ym, ym, x1, a1, b1, d1 > 0)); }
  }
  return <g>{out}</g>;
}

const axisSx = (p: Theme['pluto']) => ({
  '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: p.line2 },
  '& .MuiChartsAxis-tickLabel': { fill: p.muted, fontSize: 11 },
  '& .MuiChartsGrid-line': { stroke: p.line },
  '& .MuiChartsLegend-label': { color: p.fg2, fontSize: 12 },
  '& .MuiAreaElement-root': { fillOpacity: 0.14 },
});

interface Base { labels: string[]; yfmt: (v: number) => string; tip: TipRows; height?: number }

/** Spend vs Revenue com faixa de lucro/prejuízo. */
export function SpendRevenueChart({ labels, revenue, spend, yfmt, tip, height = 250 }: Base & { revenue: (number | null)[]; spend: (number | null)[] }) {
  const { pluto: p } = useTheme();
  return (
    <TipCtx.Provider value={{ rows: tip, labels }}>
      <LineChart height={height} skipAnimation grid={{ horizontal: true }} sx={axisSx(p)}
        margin={{ left: 8, right: 30, top: 12, bottom: 4 }}
        xAxis={[{ scaleType: 'point', data: labels, tickLabelMinGap: 18 }]}
        yAxis={[{ valueFormatter: (v: number) => yfmt(v), width: 52, min: 0 }]}
        series={[
          { data: revenue, label: 'Revenue', color: p.rev, showMark: false, curve: 'linear' },
          { data: spend, label: 'Spend', color: p.spend, showMark: false, curve: 'linear' },
        ]}
        slots={{ tooltip: RichTooltip }}>
        <ProfitBand a={revenue} b={spend} />
      </LineChart>
    </TipCtx.Provider>
  );
}

/** Lucro diário (barras verdes/vermelhas) ou outra métrica como linha. */
export function DailyChart({ labels, values, yfmt, tip, bars, name, height = 250 }: Base & { values: (number | null)[]; bars?: boolean; name: string }) {
  const { pluto: p } = useTheme();
  return (
    <TipCtx.Provider value={{ rows: tip, labels }}>
      {bars ? (
        <BarChart height={height} skipAnimation hideLegend grid={{ horizontal: true }} sx={axisSx(p)} borderRadius={4}
          margin={{ left: 8, right: 20, top: 12, bottom: 4 }}
          xAxis={[{ scaleType: 'band', data: labels, categoryGapRatio: 0.45, tickLabelMinGap: 14 }]}
          yAxis={[{ valueFormatter: (v: number) => yfmt(v), width: 52, colorMap: { type: 'piecewise', thresholds: [0], colors: [p.neg, p.pos] } }]}
          series={[{ data: values, label: name }]}
          slots={{ tooltip: RichTooltip }} />
      ) : (
        <LineChart height={height} skipAnimation hideLegend grid={{ horizontal: true }} sx={axisSx(p)}
          margin={{ left: 8, right: 30, top: 12, bottom: 4 }}
          xAxis={[{ scaleType: 'point', data: labels, tickLabelMinGap: 18 }]}
          yAxis={[{ valueFormatter: (v: number) => yfmt(v), width: 52 }]}
          series={[{ data: values, label: name, color: p.accent, area: true, showMark: false }]}
          slots={{ tooltip: RichTooltip }} />
      )}
    </TipCtx.Provider>
  );
}

/** Altura menor no celular. */
export function useChartHeight(desktop = 250) {
  const m = useMediaQuery(useTheme().breakpoints.down('md'));
  return m ? Math.round(desktop * 0.82) : desktop;
}
