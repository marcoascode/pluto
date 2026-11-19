/**
 * 0.18 · Rastreador próprio de UTMs → receita por campanha sem depender dos key-values do Ad Manager.
 *
 * Problema: o relatório de Key-values do Ad Manager só traz valores "definidos" e tem limite de valores reportáveis.
 * Uma key com centenas de milhares de valores (utm_content = {{ad.id}}_{{placement}}) deixa os IDs novos fora do
 * relatório, e a receita deles vira "sem campanha" (missing_campaign_id).
 *
 * Solução (mesma ideia de painéis como a Publeno): o script do Pluto no site conta páginas e impressões renderizadas
 * pelo GPT por UTM (tracker_daily, routes/collect.ts). No sync do Ad Manager, a receita que sobrou SEM campanha em cada
 * dia × site × país é dividida entre as campanhas rastreadas:
 *
 *   receita estimada da campanha no país P = impressões rastreadas da campanha × participação de P nos cliques da
 *                                            campanha no dia (Meta/Google, daily_metrics) × eCPM do site em P no dia
 *
 * O eCPM vem do próprio relatório-base do Ad Manager (receita ÷ impressões do dia × site × país). Se a soma estimada
 * passar da receita sem campanha disponível, todas são reduzidas na mesma proporção: nunca se cria receita, só se
 * atribui a que já existe. Campanhas que o key-value já atribuiu naquele dia × site ficam de fora (sem contar duas vezes).
 * As linhas gravadas levam unattributed_reason = 'tracker' para identificar que a atribuição é estimada.
 */
import { q } from '../db.js';

export const TRACKER_REASON = 'tracker';

type M = { revenueUsd: number; impressions: number; adRequests: number; responsesServed: number; adClicks: number; viewable: number };
type Platform = 'google' | 'meta' | 'none';
export interface PreLike {
  x: { day: string; domain: { id: string }; country: string; bucket: string };
  v: M;
  platform: Platform; campaignId: string | null; adGroupId: string | null; adId: string | null; reason: string | null; utmSource: string | null;
}
export type TrackerResolve = (campaign: string, content: string, source: string) =>
  { platform: 'google' | 'meta'; campaignId: string; adGroupId: string | null; adId: string | null } | null;

interface Want { platform: 'google' | 'meta'; campaignId: string; adGroupId: string | null; adId: string | null; rev: number }

/**
 * Divide a receita sem campanha de `pre` (platform none, sem utm_source de retenção) entre as campanhas do rastreador.
 * Altera os pre-fatos de origem (subtrai o que foi atribuído) e devolve os novos pre-fatos atribuídos.
 */
export async function trackerCarve<P extends PreLike>(pre: P[], baseBy: Map<string, M>, domainIds: string[], from: string, to: string,
  resolve: TrackerResolve, isRetention: (s: string) => boolean): Promise<{ carved: P[]; campaigns: number; revenue: number }> {
  const none = { carved: [] as P[], campaigns: 0, revenue: 0 };
  if (!domainIds.length) return none;
  const rows = await q<{ date: string; dom: string; c: string; ct: string; s: string; im: number }>(`
    SELECT date::text, domain_id::text AS dom, utm_campaign AS c, utm_content AS ct, utm_source AS s, impressions AS im
      FROM tracker_daily
     WHERE date BETWEEN $1::date AND $2::date AND domain_id = ANY($3::bigint[]) AND impressions > 0 AND (utm_campaign <> '' OR utm_content <> '')`,
  [from, to, domainIds]);
  if (!rows.length) return none;

  // campanhas que o key-value já atribuiu em cada dia × site
  const kvDone = new Set(pre.filter((f) => f.campaignId).map((f) => `${f.x.day}|${f.x.domain.id}|${f.campaignId}`));
  // impressões rastreadas por dia × site × campanha (+ grupo/anúncio do 1º UTM visto)
  const tracked = new Map<string, { day: string; dom: string; a: NonNullable<ReturnType<TrackerResolve>>; im: number }>();
  for (const r of rows) {
    if (r.s && isRetention(r.s)) continue;
    const a = resolve(r.c, r.ct, r.s);
    if (!a || kvDone.has(`${r.date}|${r.dom}|${a.campaignId}`)) continue;
    const k = `${r.date}|${r.dom}|${a.campaignId}|${a.adId ?? a.adGroupId ?? ''}`;
    const t = tracked.get(k);
    if (t) t.im += Number(r.im); else tracked.set(k, { day: r.date, dom: r.dom, a, im: Number(r.im) });
  }
  if (!tracked.size) return none;

  // mix de países de cada campanha no dia: cliques (Meta: link clicks; Google: cliques) gravados pelo sync da plataforma
  const camps = [...new Set([...tracked.values()].map((t) => t.a.campaignId))];
  const mixRows = await q<{ date: string; cid: string; country: string; clk: number }>(`
    SELECT m.date::text, m.campaign_id::text AS cid, m.country, SUM(m.traffic_clicks)::float AS clk
      FROM daily_metrics m
     WHERE m.source IN ('meta', 'google-ads') AND m.campaign_id = ANY($1::bigint[]) AND m.date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2, 3 HAVING SUM(m.traffic_clicks) > 0`, [camps, from, to]);
  const mix = new Map<string, Map<string, number>>();
  for (const r of mixRows) { const k = `${r.date}|${r.cid}`; const m = mix.get(k) ?? new Map(); m.set(r.country, Number(r.clk)); mix.set(k, m); }

  // eCPM do site por dia × país (e do dia inteiro, quando o país não teve impressão)
  const ecpm = new Map<string, { rev: number; im: number }>();
  const add = (k: string, v: M) => { const e = ecpm.get(k) ?? { rev: 0, im: 0 }; e.rev += v.revenueUsd; e.im += v.impressions; ecpm.set(k, e); };
  for (const [b, v] of baseBy) { const [day, dom, cc] = b.split('|'); add(`${day}|${dom}|${cc}`, v); add(`${day}|${dom}|*`, v); }
  const rate = (day: string, dom: string, cc: string) => {
    const e = ecpm.get(`${day}|${dom}|${cc}`), all = ecpm.get(`${day}|${dom}|*`);
    return e && e.im > 0 ? e.rev / e.im : all && all.im > 0 ? all.rev / all.im : 0;
  };

  // receita desejada por dia × site × país
  const wants = new Map<string, Want[]>();
  for (const t of tracked.values()) {
    const m = mix.get(`${t.day}|${t.a.campaignId}`);
    const tot = m ? [...m.values()].reduce((s, n) => s + n, 0) : 0;
    const parts: [string, number][] = m && tot > 0 ? [...m].map(([cc, n]) => [cc, n / tot]) : [['*', 1]];
    for (const [cc, share] of parts) {
      const countries = cc === '*' ? [...new Set(pre.filter((f) => f.x.day === t.day && f.x.domain.id === t.dom).map((f) => f.x.country))] : [cc];
      for (const c of countries) {
        // sem país (sem cliques ainda): divide pela receita sem campanha de cada país do dia
        const w = cc === '*' ? share / Math.max(1, countries.length) : share;
        const rev = t.im * w * rate(t.day, t.dom, c);
        if (rev <= 0) continue;
        const k = `${t.day}|${t.dom}|${c}`;
        wants.set(k, [...(wants.get(k) ?? []), { ...t.a, rev }]);
      }
    }
  }

  const carved: P[] = [];
  const hitCamps = new Set<string>();
  let revenue = 0;
  for (const [k, list] of wants) {
    const [day, dom, cc] = k.split('|');
    const pool = pre.filter((f) => f.platform === 'none' && !(f.utmSource && isRetention(f.utmSource)) && f.reason !== 'unknown_domain' && f.x.day === day && f.x.domain.id === dom && f.x.country === cc && f.v.revenueUsd > 0);
    const avail = pool.reduce((s, f) => s + f.v.revenueUsd, 0);
    const want = list.reduce((s, w) => s + w.rev, 0);
    if (avail <= 0 || want <= 0) continue;
    const scale = Math.min(1, avail / want);
    const snap = pool.map((f) => ({ f, v: { ...f.v } }));
    for (const w of list) {
      const ratio = (w.rev * scale) / avail;   // fração de cada linha sem campanha que vai para esta campanha
      for (const { f, v } of snap) {
        const take = { ...v };
        for (const key of Object.keys(take) as (keyof M)[]) { take[key] = v[key] * ratio; f.v[key] = Math.max(0, f.v[key] - take[key]); }
        if (take.revenueUsd < 0.0000005 && take.impressions < 0.0005) continue;
        carved.push({ ...f, v: take, platform: w.platform, campaignId: w.campaignId, adGroupId: w.adGroupId, adId: w.adId, reason: TRACKER_REASON });
        revenue += take.revenueUsd;
      }
      hitCamps.add(w.campaignId);
    }
  }
  return { carved, campaigns: hitCamps.size, revenue };
}
