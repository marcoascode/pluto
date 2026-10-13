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
  // Obrigatórias do Relatório (Não controladas pelo Seletor)
  | 'revenue' | 'spend' | 'iva' | 'roiMonetary' | 'metaSpend' | 'googleSpend'
  // Ativáveis - Bloco 1: Resultado
  | 'roi' | 'margin' | 'unattributedRevenue' | 'attributionRate'
  // Ativáveis - Bloco 2: Despesas (Ads)
  | 'googleShare' | 'metaShare' | 'metaImpressions' | 'metaClicks' | 'metaCpc'
  // Ativáveis - Bloco 3: Receita (AD Manager)
  | 'impressions' | 'adClicks' | 'adCpc' | 'ctr' | 'ecpm' 
  | 'sessions' | 'rps' | 'responsesServed' | 'viewability' | 'dropOffRate' | 'fillRate'
  // Outras / Padrão legado de outras telas do sistema
  | 'trafficImpressions' | 'trafficClicks' | 'trafficCtr' | 'cpc' | 'adRequests'
  // ROIs diários
  | 'r0' | 'r1' | 'r2' | 'r3';

type Kind = 'money' | 'profit' | 'chip' | 'pct' | 'pct0' | 'pct2' | 'int' | 'drop';

export const METRIC_DEFS: Record<MetricKey, { label: string; kind: Kind }> = {
  // === BLOCO 1: Resultado ===
  revenue: { label: 'Receita', kind: 'money' },
  spend: { label: 'Despesas (Ads)', kind: 'money' },
  iva: { label: 'IVA', kind: 'money' },
  roiMonetary: { label: 'ROI', kind: 'money' }, 
  roi: { label: 'ROI %', kind: 'pct' }, 
  margin: { label: 'Margem', kind: 'pct' },
  unattributedRevenue: { label: 'Rec.Não atribuída', kind: 'money' },
  attributionRate: { label: 'Tx. de Atribuição', kind: 'pct' },

  // === BLOCO 2: Despesas (Ads) ===
  metaSpend: { label: 'Meta', kind: 'money' },
  googleSpend: { label: 'Google', kind: 'money' },
  googleShare: { label: 'Google %', kind: 'pct0' },
  metaShare: { label: 'Meta %', kind: 'pct0' },
  metaImpressions: { label: 'Imp. Meta', kind: 'int' },
  metaClicks: { label: 'Cliques Meta', kind: 'int' },
  metaCpc: { label: 'CPC Meta', kind: 'money' },

  // === BLOCO 3: Receita (AD Manager) ===
  impressions: { label: 'Imp. ADX', kind: 'int' },
  adClicks: { label: 'Cliques ADX', kind: 'int' },
  adCpc: { label: 'CPC ADX', kind: 'money' },
  ctr: { label: 'CTR', kind: 'pct2' },
  ecpm: { label: 'eCPM', kind: 'money' },
  sessions: { label: 'Sessões', kind: 'int' },
  rps: { label: 'RPS', kind: 'money' },
  responsesServed: { label: 'Respostas servidas', kind: 'int' },
  viewability: { label: 'Viewability', kind: 'pct' },
  dropOffRate: { label: 'Drop-off', kind: 'drop' },
  fillRate: { label: 'Fill Rate', kind: 'pct' },

  // === Legadas ===
  trafficImpressions: { label: 'Impressões', kind: 'int' },
  trafficClicks: { label: 'Cliques', kind: 'int' },
  trafficCtr: { label: 'CTR', kind: 'pct2' },
  cpc: { label: 'CPC', kind: 'money' },
  adRequests: { label: 'Ad Requests', kind: 'int' },
  r0: { label: 'ROI Hoje', kind: 'chip' }, r1: { label: 'ROI D-1', kind: 'chip' }, r2: { label: 'ROI D-2', kind: 'chip' }, r3: { label: 'ROI D-3', kind: 'chip' },
};

export const ROI_TAIL: MetricKey[] = ['roi', 'r0', 'r1', 'r2', 'r3'];
export function roiLast(keys: MetricKey[]): MetricKey[] {
  return [...keys.filter((k) => !ROI_TAIL.includes(k)), ...ROI_TAIL.filter((k) => keys.includes(k))];
}

const PICKERS_RAW: Record<string, { all: MetricKey[]; def: MetricKey[] }> = {
  home: { all: ['rps', 'ecpm', 'dropOffRate', 'impressions', 'adRequests', 'responsesServed', 'fillRate', 'ctr', 'adClicks', 'viewability', 'sessions'], def: ['rps', 'ecpm', 'dropOffRate', 'impressions', 'ctr'] },
  reports: {
    all: ['roi', 'margin', 'unattributedRevenue', 'attributionRate', 'googleShare', 'metaShare', 'metaImpressions', 'metaClicks', 'metaCpc', 'impressions', 'adClicks', 'adCpc', 'ctr', 'ecpm', 'sessions', 'rps', 'responsesServed', 'viewability', 'dropOffRate', 'fillRate'],
    def: ['roi', 'margin', 'googleShare', 'metaShare', 'ecpm', 'sessions', 'rps', 'dropOffRate'],
  },
  google: { all: ['spend', 'revenue', 'roi', 'margin', 'rps', 'ecpm', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'roi', 'rps', 'r1', 'r2', 'r3'] },
  meta: { all: ['spend', 'metaSpend', 'iva', 'revenue', 'roi', 'margin', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'rps', 'ecpm', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'trafficImpressions', 'trafficClicks', 'cpc', 'trafficCtr'] },
  domain: { all: ['spend', 'revenue', 'roi', 'margin', 'rps', 'ecpm', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'sessions', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'roi', 'rps', 'ecpm'] },
  urls: { all: ['revenue', 'spend', 'roi', 'impressions', 'adClicks', 'ctr', 'ecpm', 'margin', 'adRequests', 'responsesServed', 'dropOffRate', 'sessions', 'rps', 'viewability', 'fillRate', 'attributionRate'], def: ['revenue', 'spend', 'roi', 'ecpm', 'dropOffRate'] },
  gam: { all: ['revenue', 'impressions', 'adClicks', 'ctr', 'ecpm', 'adRequests', 'responsesServed', 'dropOffRate', 'sessions', 'rps', 'attributionRate', 'fillRate', 'viewability'], def: ['revenue', 'impressions', 'adClicks', 'ecpm', 'dropOffRate', 'rps', 'fillRate', 'viewability'] },
  placements: { all: ['spend', 'revenue', 'sessions', 'rps', 'margin', 'trafficClicks', 'cpc', 'trafficImpressions', 'trafficCtr', 'ecpm', 'impressions', 'dropOffRate', 'roi', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'sessions', 'rps', 'margin', 'roi', 'r1', 'r2', 'r3'] },
};
export const PICKERS: Record<string, { all: MetricKey[]; def: MetricKey[] }> = Object.fromEntries(
  Object.entries(PICKERS_RAW).map(([k, v]) => [k, { all: roiLast(v.all), def: roiLast(v.def) }])
);

export function metricValue(m: Metrics, roiDays: RoiDays | undefined, k: MetricKey): number | null {
  if (k === 'roiMonetary') {
    const rev = (m as unknown as Record<string, number | null>)['revenue'] ?? 0;
    const sp = (m as unknown as Record<string, number | null>)['spend'] ?? 0;
    return rev - sp;
  }
  if (k === 'r0') return roiDays?.today ?? null;
  if (k === 'r1') return roiDays?.d1 ?? null;
  if (k === 'r2') return roiDays?.d2 ?? null;
  if (k === 'r3') return roiDays?.d3 ?? null;
  return (m as unknown as Record<string, number | null>)[k] ?? null;
}

export function formatMetric(k: MetricKey, v: number | null, cur: Currency): string {
  const kind = METRIC_DEFS[k].kind;
  if (kind === 'money' || kind === 'profit') return money(v, cur);
  if (kind === 'pct0') return pct0(v);
  if (kind === 'pct' || kind === 'chip' || kind === 'drop') return pct(v);
  if (kind === 'pct2') return pct(v, 2);
  return int(v);
}

export function delta(cur: number | null, prev: number | null, pp: boolean): number | null {
  if (cur == null || prev == null) return null;
  if (pp) return cur - prev;
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}