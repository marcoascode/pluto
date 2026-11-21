/**
 * 0.18 · Atribuição da receita do Ad Manager por PARTICIPAÇÃO nas impressões rastreadas (rastreador do Pluto v1.2).
 *
 * Os key-values das redes são "Predefinido" + "Incluir valores nos relatórios": o relatório não traz os utm_content
 * novos e recusa EKV. Então o Ad Manager entra só com dimensões nativas (sempre aceitas) e o script do site diz de onde
 * veio cada impressão:
 *
 *   célula = dia × site × bloco de anúncios × país × dispositivo
 *   receita da campanha na célula = receita do Ad Manager na célula × impressões rastreadas da campanha ÷ impressões
 *                                   rastreadas de TODAS as visitas na célula (orgânicas incluídas)
 *
 * - O total do dia × site × país continua o do relatório-base (só é dividido, nunca estimado à parte).
 * - Perdas do script (bloqueador, saída antes do envio) atingem campanhas e orgânico na mesma proporção: se cancelam.
 * - Sem o bloco (caminho do GPT não casa com os blocos da rede em ≥ 90% das impressões) ou sem o dispositivo
 *   (o Ad Manager recusou a dimensão), a célula fica sem esse nível. Sem país conhecido, a impressão fica fora da conta.
 * - Só vale para dia × site com o script v1.2 (há impressões orgânicas registradas); os demais seguem no método antigo
 *   (services/tracker.ts), que recebe `covered` para não atribuir duas vezes.
 * As linhas atribuídas levam unattributed_reason = 'tracker_share'.
 */
import { q } from '../db.js';
import type { PreLike, TrackerResolve } from './tracker.js';

export const SHARE_REASON = 'tracker_share';
type M = PreLike['v'];
const KEYS: (keyof M)[] = ['revenueUsd', 'impressions', 'adRequests', 'responsesServed', 'adClicks', 'viewable'];
const MIN_IMPRESSIONS = 30;   // dia × site com menos impressões rastreadas: amostra pequena, fica no método antigo
const MIN_UNIT_MATCH = 0.9;

/** Linha do relatório nativo do Ad Manager já resolvida para o domínio. unit = AD_UNIT_ID; device normalizado. */
export interface ShareCell { day: string; dom: string; country: string; unit: string | null; device: string | null; rev: number }

/** Nome da categoria de dispositivo do Ad Manager → o mesmo vocabulário do script. */
export function normDevice(v: string): string {
  const s = v.toLowerCase();
  return /phone|mobile/.test(s) ? 'smartphone' : /tablet/.test(s) ? 'tablet' : /desktop/.test(s) ? 'desktop' : s ? 'other' : '';
}

/** Chaves de busca de um caminho de bloco do GPT (/rede[,filho]/a/b): sem o 1º segmento e completo, em minúsculas. */
export function unitPathKeys(path: string): string[] {
  const segs = path.split('/').filter(Boolean).map((x) => x.toLowerCase());
  return [segs.slice(1).join('/'), segs.join('/')].filter(Boolean);
}

export async function trackerShare<P extends PreLike>(pre: P[], cells: ShareCell[], unitByPath: Map<string, string> | null, hasDevice: boolean,
  domainIds: string[], from: string, to: string, resolve: TrackerResolve, isRetention: (s: string) => boolean, normSource: (s: string) => string | null) {
  if (!domainIds.length || !cells.length) return { pre, covered: new Set<string>(), campaigns: 0, revenue: 0, days: 0, unitLevel: 0 };
  const rows = await q<TrackRow>(`
    SELECT date::text, domain_id::text AS dom, utm_campaign AS c, utm_content AS ct, utm_source AS s, ad_unit AS unit, country AS cc, device AS dev, impressions::text AS im
      FROM tracker_impressions WHERE date BETWEEN $1::date AND $2::date AND domain_id = ANY($3::bigint[]) AND impressions > 0`, [from, to, domainIds]);
  return shareFromRows(pre, cells, unitByPath, hasDevice, rows, resolve, isRetention, normSource);
}

export interface TrackRow { date: string; dom: string; c: string; ct: string; s: string; unit: string; cc: string; dev: string; im: string | number }

/** Cálculo puro (sem banco) da divisão por participação. */
export function shareFromRows<P extends PreLike>(pre: P[], cells: ShareCell[], unitByPath: Map<string, string> | null, hasDevice: boolean, rows: TrackRow[],
  resolve: TrackerResolve, isRetention: (s: string) => boolean, normSource: (s: string) => string | null) {
  const out = { pre, covered: new Set<string>(), campaigns: 0, revenue: 0, days: 0, unitLevel: 0 };
  if (!rows.length || !cells.length) return out;

  const byDaySite = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.date}|${r.dom}`; byDaySite.set(k, [...(byDaySite.get(k) ?? []), r]); }
  const cellsBy = new Map<string, ShareCell[]>();
  for (const c of cells) { const k = `${c.day}|${c.dom}`; cellsBy.set(k, [...(cellsBy.get(k) ?? []), c]); }
  const unitOf = (path: string) => { if (!unitByPath) return null; for (const k of unitPathKeys(path)) { const id = unitByPath.get(k); if (id) return id; } return null; };

  /** fração da receita de cada balde dia|site|país que vai para cada origem (chave c\u0001ct\u0001s) */
  const fracs = new Map<string, Map<string, number>>();
  for (const [ds, list] of byDaySite) {
    const gam = cellsBy.get(ds);
    const total = list.reduce((a, r) => a + Number(r.im), 0);
    // v1.2 no ar = há visitas orgânicas registradas; sem elas não dá para calcular participação
    if (!gam?.length || total < MIN_IMPRESSIONS || !list.some((r) => !r.c && !r.ct && !r.s)) continue;
    const matched = list.reduce((a, r) => a + (r.unit && unitOf(r.unit) ? Number(r.im) : 0), 0);
    const useUnit = !!unitByPath && gam.some((c) => c.unit) && matched / total >= MIN_UNIT_MATCH;
    const useDev = hasDevice && gam.some((c) => c.device) && list.some((r) => r.dev);
    const cellKey = (cc: string, unit: string | null, dev: string | null) => `${cc}|${useUnit ? unit ?? '' : '*'}|${useDev ? dev ?? '' : '*'}`;

    const rev = new Map<string, number>(), revCountry = new Map<string, number>();
    for (const c of gam) {
      const k = cellKey(c.country, c.unit, c.device);
      rev.set(k, (rev.get(k) ?? 0) + c.rev);
      revCountry.set(c.country, (revCountry.get(c.country) ?? 0) + c.rev);
    }
    const tTot = new Map<string, number>(), tBy = new Map<string, Map<string, number>>();
    for (const r of list) {
      if (!r.cc) continue;   // país desconhecido: fora da conta (numerador e denominador)
      const unit = useUnit ? unitOf(r.unit) : null;
      if (useUnit && !unit) continue;
      const k = cellKey(r.cc, unit, r.dev || null);
      const n = Number(r.im);
      tTot.set(k, (tTot.get(k) ?? 0) + n);
      if (!r.c && !r.ct && !r.s) continue;   // orgânico: só entra no denominador
      const src = `${r.c}\u0001${r.ct}\u0001${r.s}`;
      const m = tBy.get(k) ?? new Map<string, number>();
      m.set(src, (m.get(src) ?? 0) + n); tBy.set(k, m);
    }
    // receita de cada origem por país = Σ células do país (receita × participação) → fração do país
    const want = new Map<string, Map<string, number>>();
    for (const [k, m] of tBy) {
      const R = rev.get(k) ?? 0, T = tTot.get(k) ?? 0;
      if (R <= 0 || T <= 0) continue;
      const cc = k.split('|')[0];
      const w = want.get(cc) ?? new Map<string, number>();
      for (const [src, n] of m) w.set(src, (w.get(src) ?? 0) + R * (n / T));
      want.set(cc, w);
    }
    for (const [cc, w] of want) {
      const Rc = revCountry.get(cc) ?? 0;
      if (Rc <= 0) continue;
      const f = new Map<string, number>();
      for (const [src, r] of w) f.set(src, Math.min(1, r / Rc));
      fracs.set(`${ds}|${cc}`, f);
    }
    out.covered.add(ds); out.days++;
    if (useUnit) out.unitLevel++;
  }
  if (!fracs.size) return out;

  // aplica nos pre-fatos: cada linha do balde (qualquer atribuição anterior) é dividida pelas frações; o resto fica sem campanha
  const hit = new Set<string>();
  const next: P[] = [];
  const resolved = new Map<string, ReturnType<TrackerResolve> | { retention: string } | null>();
  const who = (src: string) => {
    if (resolved.has(src)) return resolved.get(src)!;
    const [c, ct, s] = src.split('\u0001');
    const ret = s && isRetention(s) && !c ? normSource(s) : null;
    const r = ret ? { retention: ret } : resolve(c, ct, s);
    resolved.set(src, r); return r;
  };
  for (const f of pre) {
    const fr = f.reason === 'unknown_domain' ? undefined : fracs.get(`${f.x.day}|${f.x.domain.id}|${f.x.country}`);
    if (!fr) { next.push(f); continue; }
    const left: M = { ...f.v };
    for (const [src, share] of fr) {
      const a = who(src);
      if (!a) continue;   // campanha não encontrada: fica no resto (sem campanha)
      const take = {} as M;
      for (const k of KEYS) { take[k] = f.v[k] * share; left[k] = Math.max(0, left[k] - take[k]); }
      if (take.revenueUsd < 0.0000005 && take.impressions < 0.0005) continue;
      if ('retention' in a) next.push({ ...f, v: take, platform: 'none', campaignId: null, adGroupId: null, adId: null, reason: f.reason ?? 'missing_campaign_id', utmSource: a.retention });
      else { next.push({ ...f, v: take, platform: a.platform, campaignId: a.campaignId, adGroupId: a.adGroupId, adId: a.adId, reason: SHARE_REASON, utmSource: null }); hit.add(a.campaignId); out.revenue += take.revenueUsd; }
    }
    next.push({ ...f, v: left, platform: 'none', campaignId: null, adGroupId: null, adId: null, reason: f.platform === 'none' && f.reason ? f.reason : 'missing_campaign_id', utmSource: null });
  }
  out.pre = next; out.campaigns = hit.size;
  return out;
}
