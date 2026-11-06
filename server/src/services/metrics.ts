/**
 * Agregação de métricas: todas as telas somam a tabela daily_metrics.
 * Conversão de moeda: cada linha é multiplicada pela taxa DO DIA dela antes de somar
 * (fins de semana/feriados usam a última taxa conhecida). As fórmulas ficam em toMetrics().
 *
 * Receita: daily_metrics.revenue_usd é a receita BRUTA do Ad Manager. A receita exibida (líquida) é
 *   bruta × (1 − revShare do domínio vigente no dia)   — o revShare não aparece em nenhuma tela.
 * Despesa: spend = Google Ads + Meta Ads + IVA (IVA = Meta × 13,83%, gravado na importação).
 * Deságio: em BRL, a RECEITA do Ad Manager usa a cotação do dia − deságio (fx_discounts, ex.: 4,9881 − 0,06).
 *   O custo continua na cotação cheia (as contas BRL voltam exatamente ao valor pago).
 * Escopo: domainIds + filter (Gestor só vê as campanhas das contas dele em cada domínio — auth/scope.ts).
 */
import { q } from '../db.js';
import { rowFilterSql, type RowFilter } from '../auth/scope.js';

export type Currency = 'USD' | 'BRL' | 'EUR';
export interface Metrics {
  revenue: number; grossRevenue: number;
  spend: number; googleSpend: number; metaSpend: number; iva: number; googleShare: number | null; metaShare: number | null;
  profit: number; roi: number | null; margin: number | null; rps: number | null; ecpm: number | null;
  impressions: number; adRequests: number; responsesServed: number; dropOffRate: number | null; fillRate: number | null;
  ctr: number | null; adClicks: number; viewability: number | null; sessions: number;
  trafficClicks: number; trafficImpressions: number; trafficCtr: number | null; cpc: number | null;
  attributedRevenue: number; unattributedRevenue: number; attributionRate: number | null;
  /** Meta: impressões, cliques no link, conversas iniciadas (Resultados), leads e custos por ação (custo Meta sem IVA ÷ ação). */
  metaImpressions: number; metaLinkClicks: number; cpcLink: number | null; metaResults: number; cpr: number | null; metaLeads: number; cpl: number | null;
  /** Ad Manager: receita ÷ cliques no anúncio. */
  cpcAdx: number | null;
  /** RPS = receita ÷ sessões · RPM de Sessão = receita ÷ sessões × 1000. */
  sessionRpm: number | null;
  /** 0.15 · Retenção: receita (líquida) com utm_source de retenção. Push = pushalert ou terminando em "push";
   *  WhatsApp = terminando em "wpp" ou "whatsapp"; o resto (email, sms…) entra só no total. */
  retentionRevenue: number; pushRevenue: number; whatsappRevenue: number;
}

/** utm_source de anúncio: não é retenção (vai para Google/Meta). */
export const AD_SOURCES = 'google|gads|adwords|cpc|ppc|fb|facebook|ig|instagram|an|msg|messenger|meta|th|threads';
export const RET_SQL = `(m.utm_source IS NOT NULL AND m.utm_source !~ '^(${AD_SOURCES})$')`;
export const PUSH_SQL = `(m.utm_source ~ '^pushalert|push$')`;
export const WPP_SQL = `(m.utm_source ~ '(wpp|whatsapp)$')`;
/** Canal de retenção de um utm_source (mesma regra do SQL). */
export const retentionChannel = (s: string | null | undefined): 'push' | 'whatsapp' | 'other' | null => {
  if (!s || new RegExp(`^(${AD_SOURCES})$`).test(s)) return null;
  return /^pushalert|push$/.test(s) ? 'push' : /(wpp|whatsapp)$/.test(s) ? 'whatsapp' : 'other';
};
interface Sums { spend: number; gs: number; ms: number; iva: number; rev: number; gross: number; un: number; rt: number; rp: number; rw: number; sess: number; ai: number; ar: number; rsv: number; ac: number; vw: number; clk: number; ti: number; mi: number; mlc: number; mres: number; mlead: number; n: number }

const n = (v: unknown) => (v == null ? 0 : Number(v));
const div = (a: number, b: number, k = 1) => (b ? (a / b) * k : null);

/** Mesmas fórmulas do front (docs/API.md). */
export function toMetrics(r?: Partial<Sums> | null): Metrics {
  const s: Sums = { spend: n(r?.spend), gs: n(r?.gs), ms: n(r?.ms), iva: n(r?.iva), rev: n(r?.rev), gross: n(r?.gross), un: n(r?.un), rt: n(r?.rt), rp: n(r?.rp), rw: n(r?.rw), sess: n(r?.sess), ai: n(r?.ai), ar: n(r?.ar), rsv: n(r?.rsv), ac: n(r?.ac), vw: n(r?.vw), clk: n(r?.clk), ti: n(r?.ti), mi: n(r?.mi), mlc: n(r?.mlc), mres: n(r?.mres), mlead: n(r?.mlead), n: n(r?.n) };
  const profit = s.rev - s.spend;
  const att = s.rev - s.un;
  return {
    revenue: s.rev, grossRevenue: s.gross,
    spend: s.spend, googleSpend: s.gs, metaSpend: s.ms, iva: s.iva, googleShare: s.spend > 0 ? div(s.gs, s.spend, 100) : null, metaShare: s.spend > 0 ? div(s.ms, s.spend, 100) : null,
    profit, roi: s.spend > 0 ? (profit / s.spend) * 100 : null, margin: s.rev > 0 ? (profit / s.rev) * 100 : null,
    rps: div(s.rev, s.sess), sessionRpm: div(s.rev, s.sess, 1000), ecpm: div(s.rev, s.ai, 1000), cpcAdx: div(s.rev, s.ac),
    impressions: s.ai, adRequests: s.ar, responsesServed: s.rsv, dropOffRate: s.rsv ? ((s.rsv - s.ai) / s.rsv) * 100 : null, fillRate: div(s.ai, s.ar, 100),
    ctr: div(s.ac, s.ai, 100), adClicks: s.ac, viewability: div(s.vw, s.ai, 100), sessions: s.sess,
    trafficClicks: s.clk, trafficImpressions: s.ti, trafficCtr: div(s.clk, s.ti, 100), cpc: div(s.spend, s.clk),
    attributedRevenue: att, unattributedRevenue: s.un, attributionRate: div(att, s.rev, 100),
    metaImpressions: s.mi, metaLinkClicks: s.mlc, cpcLink: div(s.ms, s.mlc), metaResults: s.mres, cpr: div(s.ms, s.mres), metaLeads: s.mlead, cpl: div(s.ms, s.mlead),
    retentionRevenue: s.rt, pushRevenue: s.rp, whatsappRevenue: s.rw,
  };
}

export interface AggOpts {
  from: string;
  to: string;
  domainIds: string[];
  /** Filtro de linhas do escopo (null = domínios inteiros). Obrigatório para nenhuma rota esquecer. */
  filter: RowFilter | null;
  currency: Currency;
  /** Expressão de agrupamento (ex.: `m.date`, `m.domain_id`, `to_char(m.date,'YYYY-MM')`). Sem = total. */
  groupBy?: string;
  /** JOINs extras (podem usar o alias m). */
  joins?: string;
  /** Condição extra com placeholders a partir de $5. */
  where?: string;
  params?: unknown[];
}

/** Soma daily_metrics no período/escopo. Devolve Map(chave → Metrics). Chave '' quando não há groupBy. */
export async function aggregate(o: AggOpts): Promise<Map<string, Metrics>> {
  if (!o.domainIds.length) return new Map();
  const g = o.groupBy ?? `''`;
  const rf = rowFilterSql(o.filter, 5 + (o.params?.length ?? 0));
  const sql = `
    WITH latest AS (
      SELECT rate_per_usd FROM currency_rates WHERE currency = $1 AND date <= $3::date ORDER BY date DESC LIMIT 1
    )
    SELECT (${g})::text AS k,
      SUM((m.spend_usd + m.iva_usd) * r.f) AS spend,
      SUM(CASE WHEN m.platform = 'google' THEN m.spend_usd * r.f ELSE 0 END) AS gs,
      SUM(CASE WHEN m.platform = 'meta'   THEN m.spend_usd * r.f ELSE 0 END) AS ms,
      SUM(m.iva_usd * r.f) AS iva,
      SUM(m.revenue_usd * (1 - rs.share) * r.fr) AS rev,
      SUM(m.revenue_usd * r.fr) AS gross,
      SUM(CASE WHEN m.platform = 'none' THEN m.revenue_usd * (1 - rs.share) * r.fr ELSE 0 END) AS un,
      SUM(CASE WHEN ${RET_SQL} THEN m.revenue_usd * (1 - rs.share) * r.fr ELSE 0 END) AS rt,
      SUM(CASE WHEN ${RET_SQL} AND ${PUSH_SQL} THEN m.revenue_usd * (1 - rs.share) * r.fr ELSE 0 END) AS rp,
      SUM(CASE WHEN ${RET_SQL} AND ${WPP_SQL} AND NOT ${PUSH_SQL} THEN m.revenue_usd * (1 - rs.share) * r.fr ELSE 0 END) AS rw,
      SUM(m.sessions) AS sess, SUM(m.impressions) AS ai, SUM(m.ad_requests) AS ar, SUM(m.responses_served) AS rsv,
      SUM(m.ad_clicks) AS ac, SUM(m.viewable) AS vw, SUM(m.traffic_clicks) AS clk, SUM(m.traffic_impressions) AS ti,
      SUM(CASE WHEN m.platform = 'meta' THEN m.traffic_impressions ELSE 0 END) AS mi,
      SUM(m.meta_link_clicks) AS mlc, SUM(m.meta_results) AS mres, SUM(m.meta_leads) AS mlead,
      COUNT(*) AS n
    FROM daily_metrics m
    LEFT JOIN currency_rates fx ON fx.currency = $1 AND fx.date = m.date
    CROSS JOIN LATERAL (SELECT CASE WHEN $1 = 'USD' THEN 1 ELSE COALESCE(fx.rate_per_usd, (SELECT rate_per_usd FROM latest), 1) END AS f0) f0
    CROSS JOIN LATERAL (SELECT f0.f0 AS f, ${FR_SQL} AS fr) r
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT x.rev_share FROM domain_rev_shares x WHERE x.domain_id = m.domain_id AND x.valid_from <= m.date
                                          ORDER BY x.valid_from DESC LIMIT 1), 0) AS share) rs
    ${o.joins ?? ''}
    WHERE m.date BETWEEN $2::date AND $3::date
      AND m.domain_id = ANY($4::bigint[])
      ${o.where ? `AND (${o.where})` : ''}
      ${rf.sql}
    GROUP BY 1`;
  const rows = await q<Sums & { k: string }>(sql, [o.currency, o.from, o.to, o.domainIds, ...(o.params ?? []), ...rf.params]);
  return new Map(rows.map((r) => [r.k ?? '', toMetrics(r)]));
}

/** Cotação da receita: em BRL, cotação − deságio vigente no dia (nunca abaixo de 0,0001). Alias esperado: f0, m. */
export const FR_SQL = `CASE WHEN $1 = 'BRL' THEN GREATEST(f0.f0 - COALESCE((SELECT x.amount_brl FROM fx_discounts x WHERE x.valid_from <= m.date ORDER BY x.valid_from DESC LIMIT 1), 0), 0.0001) ELSE f0.f0 END`;

export async function total(o: Omit<AggOpts, 'groupBy'>): Promise<Metrics> {
  return (await aggregate(o)).get('') ?? toMetrics();
}

/** ROI de hoje, D-1, D-2, D-3 por chave (campanha, grupo, anúncio…). */
export async function roiDays(o: Omit<AggOpts, 'from' | 'to' | 'groupBy'> & { key: string; today: string; d3: string }) {
  const m = await aggregate({ ...o, from: o.d3, to: o.today, groupBy: `${o.key} || '|' || m.date` });
  return (id: string) => {
    const at = (d: string) => m.get(`${id}|${d}`)?.roi ?? null;
    const day = (k: number) => { const t = new Date(o.today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); };
    return { today: at(day(0)), d1: at(day(1)), d2: at(day(2)), d3: at(day(3)) };
  };
}
