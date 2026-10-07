/**
 * Agregação de placement_metrics (mesmas fórmulas de toMetrics, mesma conversão de moeda pela taxa do dia).
 * Spend = custo do Google Ads no placement (Google não tem IVA). Revenue = receita bruta do Ad Manager no
 * placement × (1 − revShare do domínio no dia). Em BRL a receita usa a cotação − deságio (igual metrics.ts). Sessions/RPS dependem do tracking próprio do site (ficam vazios).
 */
import { q } from '../db.js';
import { FR_SQL, toMetrics, type Currency, type Metrics } from './metrics.js';

export interface PlAggOpts {
  from: string; to: string; currency: Currency;
  domainId: string;
  campaignIds: string[];
  /** Expressão de agrupamento sobre o alias m (ex.: m.placement_root). Sem = total. */
  groupBy?: string;
  /** Condição extra com placeholders a partir de $6. */
  where?: string;
  params?: unknown[];
}

export async function aggregatePlacements(o: PlAggOpts): Promise<Map<string, Metrics>> {
  if (!o.campaignIds.length) return new Map();
  const g = o.groupBy ?? `''`;
  const rows = await q<Parameters<typeof toMetrics>[0] & { k: string }>(`
    WITH latest AS (
      SELECT rate_per_usd FROM currency_rates WHERE currency = $1 AND date <= $3::date ORDER BY date DESC LIMIT 1
    )
    SELECT (${g})::text AS k,
      SUM(m.spend_usd * r.f) AS spend, SUM(m.spend_usd * r.f) AS gs, 0 AS ms, 0 AS iva,
      SUM(m.revenue_usd * (1 - rs.share) * r.fr) AS rev, SUM(m.revenue_usd * r.fr) AS gross, 0 AS un, 0 AS sess,
      SUM(m.impressions) AS ai, SUM(m.ad_requests) AS ar, SUM(m.responses_served) AS rsv, SUM(m.ad_clicks) AS ac, SUM(m.viewable) AS vw,
      SUM(m.traffic_clicks) AS clk, SUM(m.traffic_impressions) AS ti, COUNT(*) AS n
    FROM placement_metrics m
    LEFT JOIN currency_rates fx ON fx.currency = $1 AND fx.date = m.date
    CROSS JOIN LATERAL (SELECT CASE WHEN $1 = 'USD' THEN 1 ELSE COALESCE(fx.rate_per_usd, (SELECT rate_per_usd FROM latest), 1) END AS f0) f0
    CROSS JOIN LATERAL (SELECT f0.f0 AS f, ${FR_SQL} AS fr) r
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT x.rev_share FROM domain_rev_shares x WHERE x.domain_id = m.domain_id AND x.valid_from <= m.date
                                          ORDER BY x.valid_from DESC LIMIT 1), 0) AS share) rs
    WHERE m.date BETWEEN $2::date AND $3::date
      AND m.domain_id = $4::bigint
      AND m.campaign_id = ANY($5::bigint[])
      ${o.where ? `AND (${o.where})` : ''}
    GROUP BY 1`, [o.currency, o.from, o.to, o.domainId, o.campaignIds, ...(o.params ?? [])]);
  return new Map(rows.map((r) => [r.k ?? '', toMetrics(r)]));
}

/** ROI de hoje, D-1, D-2, D-3 por chave. */
export async function placementRoiDays(o: Omit<PlAggOpts, 'from' | 'to' | 'groupBy'> & { key: string; today: string; d3: string }) {
  const m = await aggregatePlacements({ ...o, from: o.d3, to: o.today, groupBy: `${o.key} || '|' || m.date` });
  const day = (k: number) => { const t = new Date(o.today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); };
  const days = [0, 1, 2, 3].map(day);
  const roi = (id: string) => { const at = (d: string) => m.get(`${id}|${d}`)?.roi ?? null; return { today: at(days[0]), d1: at(days[1]), d2: at(days[2]), d3: at(days[3]) }; };
  /** [spend, revenue] de hoje, D-1, D-2, D-3 — o front usa para o ROI D-x do total quando filtra a lista. */
  const recent = (id: string) => days.map((d) => { const x = m.get(`${id}|${d}`); return [x?.spend ?? 0, x?.revenue ?? 0] as [number, number]; });
  return Object.assign(roi, { recent });
}
