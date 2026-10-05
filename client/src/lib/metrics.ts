import type { Currency, Metrics, RoiDays } from '@/types/api';
import { int, money, pct, pct0 } from './format';

/** Cores do ROI: <0 vermelho · 0 cinza · 0–20 neutro · 20–30 verde claro · 30%+ verde forte */
export type RoiClass = 'neg' | 'na' | 'lo' | 'pos-lite' | 'pos';
export function roiClass(v: number | null | undefined): RoiClass {
  if (v == null || !isFinite(v)) return 'na';
  const r = Math.round(v);
  if (r < 0) return 'neg';
  if (r === 0) return 'na';
  if (r < 20) return 'lo';
  if (r < 30) return 'pos-lite';
  return 'pos';
}

/** Drop-off: até 12% normal · 12–20% atenção · 20%+ crítico. */
export type DropClass = 'ok' | 'warn' | 'bad' | 'na';
export function dropClass(v: number | null | undefined): DropClass {
  if (v == null || !isFinite(v)) return 'na';
  return v >= 20 ? 'bad' : v >= 12 ? 'warn' : 'ok';
}
/** Mínimo de respostas servidas para uma URL entrar nos alertas/ranking de drop-off. */
export const DROP_MIN_RESPONSES = 200;

/** Margem (cor da célula nos relatórios): <0 · 0–30 · 30–50 · 50%+ */
export type MarginClass = 'neg' | 'lo' | 'mid' | 'hi' | 'na';
export function marginClass(v: number | null | undefined): MarginClass {
  if (v == null || !isFinite(v)) return 'na';
  return v < 0 ? 'neg' : v < 30 ? 'lo' : v < 50 ? 'mid' : 'hi';
}

/** Métricas que aparecem no seletor "Selecionar métricas". */
export type MetricKey =
  | 'spend' | 'revenue' | 'profit' | 'roi' | 'margin' | 'rps' | 'ecpm' | 'trafficImpressions' | 'trafficClicks' | 'trafficCtr' | 'cpc'
  | 'sessions' | 'impressions' | 'adRequests' | 'fillRate' | 'ctr' | 'adClicks' | 'viewability' | 'attributionRate'
  | 'r0' | 'r1' | 'r2' | 'r3'
  | 'iva' | 'googleSpend' | 'metaSpend' | 'googleShare' | 'metaShare' | 'unattributedRevenue' | 'responsesServed' | 'dropOffRate';
type Kind = 'money' | 'profit' | 'chip' | 'pct' | 'pct0' | 'pct2' | 'int' | 'drop';
export const METRIC_DEFS: Record<MetricKey, { label: string; kind: Kind }> = {
  spend: { label: 'Spend', kind: 'money' }, revenue: { label: 'Revenue', kind: 'money' }, profit: { label: 'Profit', kind: 'profit' },
  roi: { label: 'ROI', kind: 'chip' }, margin: { label: 'Margem', kind: 'pct' }, rps: { label: 'RPS', kind: 'money' }, ecpm: { label: 'eCPM', kind: 'money' },
  trafficImpressions: { label: 'Impressions', kind: 'int' }, trafficClicks: { label: 'Clicks', kind: 'int' }, trafficCtr: { label: 'CTR', kind: 'pct2' },
  cpc: { label: 'CPC', kind: 'money' }, sessions: { label: 'Sessions', kind: 'int' }, impressions: { label: 'Impressões', kind: 'int' },
  adRequests: { label: 'Ad Requests', kind: 'int' }, fillRate: { label: 'Fill Rate', kind: 'pct' }, ctr: { label: 'CTR', kind: 'pct2' },
  adClicks: { label: 'Clicks', kind: 'int' }, viewability: { label: 'Viewability', kind: 'pct' }, attributionRate: { label: 'Atribuição', kind: 'pct' },
  iva: { label: 'IVA', kind: 'money' }, googleSpend: { label: 'Custo Google', kind: 'money' },
  metaSpend: { label: 'Custo Meta', kind: 'money' }, googleShare: { label: 'Google %', kind: 'pct0' }, metaShare: { label: 'Meta %', kind: 'pct0' },
  unattributedRevenue: { label: 'Não atribuída', kind: 'money' }, responsesServed: { label: 'Respostas servidas', kind: 'int' }, dropOffRate: { label: 'Drop-off', kind: 'drop' },
  r0: { label: 'ROI Hoje', kind: 'chip' }, r1: { label: 'ROI D-1', kind: 'chip' }, r2: { label: 'ROI D-2', kind: 'chip' }, r3: { label: 'ROI D-3', kind: 'chip' },
};

/** ROI e ROI Hoje / D-1 / D-2 / D-3 ficam sempre por último, nesta ordem. Qualquer outra métrica (inclusive as
 *  adicionadas em "Selecionar métricas") entra à esquerda do ROI, nunca à direita dele. */
export const ROI_TAIL: MetricKey[] = ['roi', 'r0', 'r1', 'r2', 'r3'];
export function roiLast(keys: MetricKey[]): MetricKey[] {
  return [...keys.filter((k) => !ROI_TAIL.includes(k)), ...ROI_TAIL.filter((k) => keys.includes(k))];
}

/** Conjuntos por tela: todas as opções + o padrão. */
const PICKERS_RAW: Record<string, { all: MetricKey[]; def: MetricKey[] }> = {
  home: { all: ['rps', 'ecpm', 'dropOffRate', 'impressions', 'adRequests', 'responsesServed', 'fillRate', 'ctr', 'adClicks', 'viewability', 'sessions'], def: ['rps', 'ecpm', 'dropOffRate', 'impressions', 'ctr'] },
  reports: {
    all: ['revenue', 'spend', 'googleSpend', 'metaSpend', 'iva', 'metaShare', 'googleShare', 'profit', 'margin', 'roi', 'unattributedRevenue', 'rps', 'ecpm', 'sessions', 'impressions', 'responsesServed', 'dropOffRate', 'fillRate', 'ctr', 'viewability', 'trafficClicks', 'cpc', 'attributionRate'],
    def: ['revenue', 'spend', 'googleSpend', 'metaSpend', 'iva', 'metaShare', 'googleShare', 'profit', 'margin', 'roi', 'rps', 'sessions', 'dropOffRate'],
  },
  google: { all: ['spend', 'revenue', 'profit', 'roi', 'margin', 'rps', 'ecpm', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'rps', 'r1', 'r2', 'r3'] },
  meta: { all: ['spend', 'metaSpend', 'iva', 'revenue', 'profit', 'roi', 'margin', 'rps', 'ecpm', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'trafficCtr', 'cpc', 'rps'] },
  domain: { all: ['spend', 'revenue', 'profit', 'roi', 'margin', 'rps', 'ecpm', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'rps', 'ecpm'] },
  urls: { all: ['revenue', 'spend', 'profit', 'roi', 'margin', 'rps', 'ecpm', 'dropOffRate', 'sessions', 'ctr', 'viewability', 'impressions', 'responsesServed', 'adRequests', 'fillRate', 'attributionRate'], def: ['revenue', 'spend', 'profit', 'roi', 'rps', 'ecpm', 'dropOffRate', 'sessions'] },
  gam: { all: ['revenue', 'ecpm', 'rps', 'dropOffRate', 'impressions', 'responsesServed', 'adRequests', 'fillRate', 'ctr', 'adClicks', 'viewability', 'sessions', 'attributionRate'], def: ['revenue', 'ecpm', 'rps', 'dropOffRate', 'impressions', 'fillRate', 'viewability'] },
  placements: {
    all: ['spend', 'revenue', 'sessions', 'rps', 'profit', 'margin', 'trafficClicks', 'cpc', 'trafficImpressions', 'trafficCtr', 'ecpm', 'impressions', 'dropOffRate', 'roi', 'r0', 'r1', 'r2', 'r3'],
    def: ['spend', 'revenue', 'sessions', 'rps', 'profit', 'margin', 'roi', 'r1', 'r2', 'r3'],
  },
};
export const PICKERS: Record<string, { all: MetricKey[]; def: MetricKey[] }> = Object.fromEntries(
  Object.entries(PICKERS_RAW).map(([k, v]) => [k, { all: roiLast(v.all), def: roiLast(v.def) }]));

export function metricValue(m: Metrics, roiDays: RoiDays | undefined, k: MetricKey): number | null {
  if (k === 'r0') return roiDays?.today ?? null;
  if (k === 'r1') return roiDays?.d1 ?? null;
  if (k === 'r2') return roiDays?.d2 ?? null;
  if (k === 'r3') return roiDays?.d3 ?? null;
  return (m as unknown as Record<string, number | null>)[k] ?? null;
}

/** Formata como texto simples (para células sem cor). Chips e profit colorido ficam nos componentes. */
export function formatMetric(k: MetricKey, v: number | null, cur: Currency): string {
  const kind = METRIC_DEFS[k].kind;
  if (kind === 'money' || kind === 'profit') return money(v, cur);
  if (kind === 'pct0') return pct0(v);
  if (kind === 'pct' || kind === 'chip' || kind === 'drop') return pct(v);
  if (kind === 'pct2') return pct(v, 2);
  return int(v);
}

/** Variação vs período anterior. pp = diferença em pontos percentuais (ROI, Margem). */
export function delta(cur: number | null, prev: number | null, pp: boolean): number | null {
  if (cur == null || prev == null) return null;
  if (pp) return cur - prev;
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
