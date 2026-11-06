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
  | 'spend' | 'revenue' | 'profit' | 'roi' | 'margin' | 'rps' | 'sessionRpm' | 'ecpm' | 'trafficImpressions' | 'trafficClicks' | 'trafficCtr' | 'cpc'
  | 'sessions' | 'impressions' | 'adRequests' | 'fillRate' | 'ctr' | 'adClicks' | 'cpcAdx' | 'viewability' | 'attributionRate'
  | 'r0' | 'r1' | 'r2' | 'r3'
  | 'iva' | 'googleSpend' | 'metaSpend' | 'googleShare' | 'metaShare' | 'unattributedRevenue' | 'responsesServed' | 'dropOffRate'
  | 'metaImpressions' | 'metaLinkClicks' | 'cpcLink' | 'metaResults' | 'cpr' | 'metaLeads' | 'cpl'
  | 'retentionRevenue' | 'pushRevenue' | 'whatsappRevenue';
type Kind = 'money' | 'money3' | 'profit' | 'chip' | 'pct' | 'pct0' | 'pct2' | 'int' | 'drop';
/** label = cabeçalho da coluna · hint = explicação curta no seletor. */
export const METRIC_DEFS: Record<MetricKey, { label: string; kind: Kind; hint?: string }> = {
  // Resultados
  revenue: { label: 'Receita', kind: 'money', hint: 'Ad Manager, já sem o revShare do domínio' },
  spend: { label: 'Despesas', kind: 'money', hint: 'Google Ads + Meta Ads + IVA' },
  iva: { label: 'IVA', kind: 'money', hint: '13,83% sobre o custo da Meta' },
  profit: { label: 'ROI', kind: 'profit', hint: 'Receita − (Google Ads + Meta Ads + IVA)' },
  roi: { label: 'ROI %', kind: 'chip', hint: '(Receita − Despesas) ÷ Despesas' },
  margin: { label: 'Margem', kind: 'pct', hint: 'ROI ÷ Receita' },
  unattributedRevenue: { label: 'RNA', kind: 'money', hint: 'Receita não atribuída a campanha' },
  attributionRate: { label: 'Atribuição', kind: 'pct', hint: 'Receita atribuída ÷ Receita' },
  // Despesas
  googleSpend: { label: 'Custo Google', kind: 'money' }, metaSpend: { label: 'Custo Meta', kind: 'money', hint: 'sem IVA' },
  googleShare: { label: 'Google %', kind: 'pct0' }, metaShare: { label: 'Meta %', kind: 'pct0' },
  metaImpressions: { label: 'Imp. Meta', kind: 'int' },
  metaLinkClicks: { label: 'Cliques Meta', kind: 'int', hint: 'Cliques no link (link_click)' },
  cpcLink: { label: 'CPC-L', kind: 'money', hint: 'Custo Meta ÷ cliques no link' },
  metaResults: { label: 'Resultados', kind: 'int', hint: 'Conversas por mensagem iniciadas' },
  cpr: { label: 'CPR', kind: 'money', hint: 'Custo Meta ÷ conversas iniciadas' },
  metaLeads: { label: 'Leads', kind: 'int' }, cpl: { label: 'CPL', kind: 'money', hint: 'Custo Meta ÷ leads' },
  trafficImpressions: { label: 'Impressões', kind: 'int', hint: 'Impressões das campanhas (Google + Meta)' },
  trafficClicks: { label: 'Cliques', kind: 'int', hint: 'Cliques das campanhas (Google + Meta)' },
  trafficCtr: { label: 'CTR campanha', kind: 'pct2' }, cpc: { label: 'CPC', kind: 'money', hint: 'Despesas ÷ cliques' },
  // Receitas
  impressions: { label: 'Imp. ADX', kind: 'int', hint: 'Impressões de anúncio no Ad Manager' },
  adClicks: { label: 'Cliques ADX', kind: 'int' }, cpcAdx: { label: 'CPC ADX', kind: 'money', hint: 'Receita ÷ cliques ADX' },
  ctr: { label: 'CTR', kind: 'pct2', hint: 'Cliques ADX ÷ Imp. ADX' }, ecpm: { label: 'eCPM', kind: 'money' },
  responsesServed: { label: 'Respostas servidas', kind: 'int' }, viewability: { label: 'Viewability', kind: 'pct' },
  dropOffRate: { label: 'Drop-off', kind: 'drop' }, fillRate: { label: 'Fill Rate', kind: 'pct' },
  sessions: { label: 'Sessões', kind: 'int' }, rps: { label: 'RPS', kind: 'money3', hint: 'Receita ÷ Sessões' },
  sessionRpm: { label: 'RPM de Sessão', kind: 'money', hint: 'Receita ÷ Sessões × 1000' },
  adRequests: { label: 'Ad Requests', kind: 'int' },
  // Retenção (utm_source de push / WhatsApp colocado à mão nos links de retenção)
  retentionRevenue: { label: 'Retenção', kind: 'money', hint: 'Receita com utm_source de retenção (Push, WhatsApp e outros)' },
  pushRevenue: { label: 'Retenção Push', kind: 'money', hint: 'utm_source=pushalert ou terminando em push' },
  whatsappRevenue: { label: 'Retenção WhatsApp', kind: 'money', hint: 'utm_source terminando em wpp ou whatsapp' },
  // ROI por dia (sempre na ponta direita)
  r0: { label: 'ROI Hoje', kind: 'chip' }, r1: { label: 'ROI D-1', kind: 'chip' }, r2: { label: 'ROI D-2', kind: 'chip' }, r3: { label: 'ROI D-3', kind: 'chip' },
};

/**
 * Blocos de colunas (Prompt-06): Resultados → Despesas → Receitas, cada um na ordem exata abaixo.
 * Uma métrica que aparece em dois blocos (Receita, IVA) é UMA coluna só, no primeiro bloco em que aparece;
 * no seletor ela aparece nos dois grupos com o mesmo liga/desliga.
 * As métricas de tráfego das campanhas e Ad Requests entram no fim do bloco a que pertencem.
 */
export type BlockKey = 'results' | 'costs' | 'revenue' | 'roiDays';
export const BLOCKS: { key: BlockKey; label: string; keys: MetricKey[] }[] = [
  { key: 'results', label: 'Resultados', keys: ['revenue', 'spend', 'profit', 'roi', 'margin', 'unattributedRevenue', 'attributionRate'] },
  { key: 'costs', label: 'Despesas', keys: ['googleSpend', 'metaSpend', 'iva', 'googleShare', 'metaShare', 'metaImpressions', 'metaLinkClicks', 'cpcLink', 'metaResults', 'cpr', 'metaLeads', 'cpl', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc'] },
  { key: 'revenue', label: 'Receitas', keys: ['revenue', 'impressions', 'adClicks', 'cpcAdx', 'ctr', 'ecpm', 'responsesServed', 'viewability', 'dropOffRate', 'fillRate', 'adRequests', 'retentionRevenue', 'pushRevenue', 'whatsappRevenue'] },
  { key: 'roiDays', label: 'ROI por dia', keys: ['r0', 'r1', 'r2', 'r3'] },
];
/** Ordem global de exibição (primeira ocorrência de cada métrica nos blocos). */
const ORDER: MetricKey[] = [...new Set(BLOCKS.flatMap((b) => b.keys))];
/** Bloco "dono" da coluna (primeiro em que a métrica aparece). */
export const BLOCK_OF = Object.fromEntries(ORDER.map((k) => [k, BLOCKS.find((b) => b.keys.includes(k))!.key])) as Record<MetricKey, BlockKey>;
export const byBlockOrder = (keys: MetricKey[]) => ORDER.filter((k) => keys.includes(k));

/** ROI % e ROI Hoje / D-1 / D-2 / D-3 ficam sempre por último nas telas de campanha. Qualquer outra métrica
 *  (inclusive as adicionadas em "Selecionar métricas") entra à esquerda do ROI, nunca à direita dele. */
export const ROI_TAIL: MetricKey[] = ['roi', 'r0', 'r1', 'r2', 'r3'];
export function roiLast(keys: MetricKey[]): MetricKey[] {
  return [...keys.filter((k) => !ROI_TAIL.includes(k)), ...ROI_TAIL.filter((k) => keys.includes(k))];
}

/**
 * Conjuntos por tela: todas as opções + o padrão. mixed = relatório misto (receita, despesa e resultado juntos):
 * colunas em 3 blocos com cabeçalho (Relatórios, URLs). Nas outras telas a ordem é a dos blocos e o ROI % / ROI do dia
 * vão para a ponta direita.
 */
const R: MetricKey[] = ['revenue', 'spend', 'iva', 'profit', 'roi', 'margin'];
const META_RES: MetricKey[] = ['metaImpressions', 'metaLinkClicks', 'cpcLink', 'metaResults', 'cpr', 'metaLeads', 'cpl'];
const PICKERS_RAW: Record<string, { all: MetricKey[]; def: MetricKey[]; mixed?: boolean }> = {
  home: { all: ['rps', 'sessionRpm', 'ecpm', 'dropOffRate', 'impressions', 'adRequests', 'responsesServed', 'fillRate', 'ctr', 'adClicks', 'cpcAdx', 'viewability', 'sessions', 'retentionRevenue', 'pushRevenue', 'whatsappRevenue'], def: ['sessionRpm', 'ecpm', 'dropOffRate', 'impressions', 'ctr'] },
  reports: {
    mixed: true,
    all: byBlockOrder([...BLOCKS[0].keys, ...BLOCKS[1].keys, ...BLOCKS[2].keys]),
    def: ['revenue', 'spend', 'iva', 'profit', 'roi', 'margin', 'googleSpend', 'metaSpend', 'googleShare', 'metaShare', 'sessions', 'sessionRpm', 'dropOffRate', 'retentionRevenue'],
  },
  google: { all: [...R, 'googleSpend', 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'ecpm', 'sessions', 'rps', 'sessionRpm', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'sessionRpm', 'r1', 'r2', 'r3'] },
  meta: { all: [...R, 'metaSpend', ...META_RES, 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'ecpm', 'sessions', 'rps', 'sessionRpm', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'metaLinkClicks', 'cpcLink', 'sessionRpm'] },
  domain: { all: [...R, 'googleSpend', 'metaSpend', ...META_RES, 'trafficImpressions', 'trafficClicks', 'trafficCtr', 'cpc', 'ecpm', 'sessions', 'rps', 'sessionRpm', 'retentionRevenue', 'pushRevenue', 'whatsappRevenue', 'r0', 'r1', 'r2', 'r3'], def: ['spend', 'revenue', 'profit', 'roi', 'sessionRpm', 'ecpm'] },
  urls: {
    mixed: true,
    all: ['revenue', 'spend', 'profit', 'roi', 'margin', 'attributionRate', 'impressions', 'adClicks', 'cpcAdx', 'ctr', 'ecpm', 'responsesServed', 'viewability', 'dropOffRate', 'fillRate', 'sessions', 'rps', 'sessionRpm', 'adRequests'],
    def: ['revenue', 'spend', 'profit', 'roi', 'ecpm', 'dropOffRate', 'sessions', 'sessionRpm'],
  },
  gam: { all: ['revenue', 'unattributedRevenue', 'attributionRate', 'impressions', 'adClicks', 'cpcAdx', 'ctr', 'ecpm', 'responsesServed', 'viewability', 'dropOffRate', 'fillRate', 'sessions', 'rps', 'sessionRpm', 'adRequests', 'retentionRevenue', 'pushRevenue', 'whatsappRevenue'], def: ['revenue', 'ecpm', 'sessionRpm', 'dropOffRate', 'impressions', 'fillRate', 'viewability'] },
  placements: {
    all: ['spend', 'revenue', 'profit', 'margin', 'trafficClicks', 'cpc', 'trafficImpressions', 'trafficCtr', 'ecpm', 'impressions', 'dropOffRate', 'sessions', 'rps', 'sessionRpm', 'roi', 'r0', 'r1', 'r2', 'r3'],
    def: ['spend', 'revenue', 'sessions', 'sessionRpm', 'profit', 'margin', 'roi', 'r1', 'r2', 'r3'],
  },
};
const ordered = (keys: MetricKey[], mixed?: boolean) => (mixed ? byBlockOrder(keys) : roiLast(byBlockOrder(keys)));
/**
 * 0.15: o dash não usa sessões (o site não manda tracking de sessão). RPM de Sessão e RPS saem das telas e
 * Sessões vira Impressões (Ad Manager); onde o padrão tinha RPM entra o eCPM. Escolhas salvas passam pela mesma troca.
 */
export const noSessions = (keys: MetricKey[]): MetricKey[] =>
  [...new Set(keys.map((k): MetricKey => (k === 'sessions' ? 'impressions' : k === 'sessionRpm' ? 'ecpm' : k)).filter((k) => k !== 'rps'))];
export const PICKERS: Record<string, { all: MetricKey[]; def: MetricKey[]; mixed: boolean }> = Object.fromEntries(
  Object.entries(PICKERS_RAW).map(([k, v]) => [k, { all: ordered(noSessions(v.all), v.mixed), def: ordered(noSessions(v.def), v.mixed), mixed: !!v.mixed }]));
/** Ordena a escolha do usuário para a tela (blocos; ROI na ponta nas telas não mistas). */
export const orderFor = (screen: string, keys: MetricKey[]) => ordered(keys, PICKERS[screen]?.mixed);

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
  if (kind === 'money3') return money(v, cur, 3);
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
