/**
 * Placements: onde os anúncios do Google Ads apareceram × receita do Ad Manager naquele placement.
 *
 *  google-ads.placements  custo/cliques/impressões por campanha × placement × dia (detail_placement_view:
 *                         Display, Demand Gen e YouTube; Pesquisa não tem placement e Performance Max não
 *                         informa custo por placement).
 *  gam.placements         receita bruta e delivery por site × utm_campaign × placement × dia. O site repassa o
 *                         {placement} da URL do anúncio para o GPT como key-value "placement" (GAM_KEY_PLACEMENT),
 *                         que precisa estar como "Custom dimension" no Ad Manager.
 *                         Formato do dash antigo (utm_campaign={creative}, utm_content={creative}_{placement}): sem o
 *                         key-value "placement", o placement sai do utm_content e a campanha sai do {creative}.
 *                         Sem dimensão personalizada (modo keyvalues, igual à Publeno): basta o utm_content com "Incluir
 *                         valores nos relatórios"; o relatório usa a dimensão nativa Key-values e lê {creative}_{placement}.
 *
 * Os dois lados usam a mesma chave normalizada (normPlacement): host sem "www.", "youtube.com" para vídeos/canais
 * e "mobileapp::…" para apps. placement_root agrupa subdomínios no domínio principal (lp.site.com → site.com).
 * Cada job apaga e regrava só as linhas dele na janela (idempotente).
 */
import { config } from '../../config.js';
import { q, tx } from '../../db.js';
import { domainResolver, fxToUsd, setAccountStatus, statusFromError } from './common.js';
import { loadTimeline, siteForDay } from '../accountLinks.js';
import { ALL, attributeContent, ekvKnown, fetchUnitMap, isConstraint, unitsToSites, attributionIndex, attributionMode, EMPTY, isLegacyUtm, isoDate, kvValue, num, resolveKeys, runKvReport, runReport, str } from './gam.js';
import { ctx, gaql } from './googleAds.js';
import { SyncError } from './http.js';
import { googleAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

export type PlacementType = 'website' | 'app' | 'youtube' | 'google' | 'other';

/** Sufixos de 2 partes: o domínio principal de lp.site.com.br é site.com.br. */
const PSL2 = new Set(['com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'blog.br', 'art.br', 'eco.br', 'co.uk', 'org.uk', 'ac.uk', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.es', 'com.au', 'co.jp', 'com.cl', 'com.pt', 'co.za', 'co.in', 'com.tr']);

/** Mesma chave para o valor do Google Ads (detail_placement_view.placement) e para o key-value do Ad Manager. */
export function normPlacement(raw: string | null | undefined, gType?: string): { key: string; type: PlacementType } | null {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s || EMPTY.test(s) || /[{}]/.test(s)) return null;
  s = s.replace(/\|/g, '');
  if (s.startsWith('mobileapp::') || s.startsWith('mobileappcategory::') || gType === 'MOBILE_APPLICATION' || gType === 'MOBILE_APP_CATEGORY') return { key: s.slice(0, 200), type: 'app' };
  if (gType === 'YOUTUBE_VIDEO' || gType === 'YOUTUBE_CHANNEL' || /^(https?:\/\/)?((www|m)\.)?youtube\.com/.test(s) || s.startsWith('youtube.com::')) return { key: 'youtube.com', type: 'youtube' };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return { key: s.slice(0, 200), type: 'other' };
  return { key: s, type: gType === 'GOOGLE_PRODUCTS' || /(^|\.)google\.com$/.test(s) ? 'google' : 'website' };
}
export function placementRoot(key: string): string {
  if (key.includes('::') || !key.includes('.')) return key;
  const l = key.split('.');
  if (l.length <= 2) return key;
  return l.slice(PSL2.has(l.slice(-2).join('.')) ? -3 : -2).join('.');
}
export function placementType(key: string): PlacementType {
  if (key.includes('::')) return 'app';
  if (key === 'youtube.com') return 'youtube';
  if (/(^|\.)google\.com$/.test(key)) return 'google';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key) ? 'website' : 'other';
}

interface PFact {
  date: string; domainId: string; campaignId: string | null; placement: string;
  spendUsd: number; clicks: number; trafficImpressions: number;
  revenueUsd: number; impressions: number; adRequests: number; responsesServed: number; adClicks: number; viewable: number;
}
const zero = { spendUsd: 0, clicks: 0, trafficImpressions: 0, revenueUsd: 0, impressions: 0, adRequests: 0, responsesServed: 0, adClicks: 0, viewable: 0 };
const NUMS = Object.keys(zero) as (keyof typeof zero)[];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Apaga a janela da origem (no escopo de campanhas) e grava de novo. Soma linhas repetidas da mesma chave. */
async function replacePlacements(source: 'google-ads' | 'gam', from: string, to: string, scope: string[] | 'all' | { domains: string[] }, rows: PFact[], isFinal = false) {
  const m = new Map<string, PFact>();
  for (const f of rows) {
    if (f.date < from || f.date > to) continue;
    const k = `${f.date}|${f.domainId}|${f.campaignId ?? ''}|${f.placement}`;
    const x = m.get(k);
    if (!x) m.set(k, { ...f });
    else for (const n of NUMS) x[n] += f[n];
  }
  const data = [...m.values()];
  await tx(async (c) => {
    if (scope === 'all') await c.query('DELETE FROM placement_metrics WHERE source = $1 AND date BETWEEN $2 AND $3', [source, from, to]);
    else if (!Array.isArray(scope)) { if (scope.domains.length) await c.query('DELETE FROM placement_metrics WHERE source = $1 AND date BETWEEN $2 AND $3 AND domain_id = ANY($4::bigint[])', [source, from, to, scope.domains]); }
    else if (scope.length) await c.query('DELETE FROM placement_metrics WHERE source = $1 AND date BETWEEN $2 AND $3 AND campaign_id = ANY($4::bigint[])', [source, from, to, scope]);
    for (let i = 0; i < data.length; i += 2000) {
      const ch = data.slice(i, i + 2000);
      const col = <K extends keyof PFact>(k: K) => ch.map((f) => f[k]);
      const int = (k: keyof typeof zero) => ch.map((f) => Math.round(f[k]));
      await c.query(`
        INSERT INTO placement_metrics (source, date, domain_id, campaign_id, placement, placement_root, spend_usd, traffic_clicks, traffic_impressions,
          revenue_usd, impressions, ad_requests, responses_served, ad_clicks, viewable, is_final, updated_at)
        SELECT $1, d, dom, c, p, pr, sp, tc, ti, rv, im, ar, rs, ac, vw, $16, now()
          FROM unnest($2::date[], $3::bigint[], $4::bigint[], $5::text[], $6::text[], $7::numeric[], $8::bigint[], $9::bigint[],
                      $10::numeric[], $11::bigint[], $12::bigint[], $13::bigint[], $14::bigint[], $15::bigint[])
            AS t(d, dom, c, p, pr, sp, tc, ti, rv, im, ar, rs, ac, vw)`,
        [source, col('date'), col('domainId'), col('campaignId'), col('placement'), ch.map((f) => placementRoot(f.placement)),
          ch.map((f) => r4(f.spendUsd)), int('clicks'), int('trafficImpressions'), ch.map((f) => r4(f.revenueUsd)),
          int('impressions'), int('adRequests'), int('responsesServed'), int('adClicks'), int('viewable'), isFinal]);
    }
  });
  return data.length;
}

async function saveLabels(labels: Map<string, { label: string; type: PlacementType }>) {
  if (!labels.size) return;
  const ks = [...labels.keys()];
  await q(`INSERT INTO placement_labels (placement, label, type) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
           ON CONFLICT (placement) DO UPDATE SET label = EXCLUDED.label, type = EXCLUDED.type, updated_at = now()`,
    [ks, ks.map((k) => labels.get(k)!.label.slice(0, 200)), ks.map((k) => labels.get(k)!.type)]);
}

/* ---------------- Google Ads: custo por placement ---------------- */
interface PlRow {
  segments: { date: string }; campaign: { id: string };
  detailPlacementView: { placement?: string; displayName?: string; placementType?: string; targetUrl?: string; groupPlacementTargetUrl?: string };
  metrics: { costMicros?: string; clicks?: string; impressions?: string };
}
export async function runGoogleAdsPlacements(w: { from: string; to: string }): Promise<JobResult> {
  let c: { mcc: string; token: string };
  try { c = await ctx(); } catch (e) { return { status: 'skipped', message: (e as Error).message }; }
  const accs = await q<{ id: string; external_id: string; name: string; currency: string }>(`SELECT id::text, external_id, name, currency FROM integration_accounts WHERE provider = 'google-ads' AND imported AND COALESCE(platform_status, 'ENABLED') = 'ENABLED' ORDER BY id`);
  if (!accs.length) return { status: 'skipped', message: 'nenhuma conta Google Ads ativa marcada para importar' };
  const toUsd = await fxToUsd(w.from, w.to);
  const tl = await loadTimeline(accs.map((a) => a.id));   // 0.17: site da conta em cada dia
  const labels = new Map<string, { label: string; type: PlacementType }>();
  const notes: string[] = [];
  let ok = 0, total = 0;
  for (const acc of accs) {
    try {
      const camps = await q<{ id: string; ext: string; domain_id: string | null }>(`SELECT id::text, external_id AS ext, domain_id::text FROM campaigns WHERE account_id = $1 AND platform = 'google'`, [acc.id]);
      const byExt = new Map(camps.map((x) => [x.ext, x]));
      const rows = await gaql<PlRow>(c, acc.external_id, `
        SELECT segments.date, campaign.id, detail_placement_view.placement, detail_placement_view.display_name,
               detail_placement_view.placement_type, detail_placement_view.target_url, detail_placement_view.group_placement_target_url,
               metrics.cost_micros, metrics.clicks, metrics.impressions
          FROM detail_placement_view
         WHERE segments.date BETWEEN '${w.from}' AND '${w.to}' AND metrics.impressions > 0`);
      const facts: PFact[] = [];
      let noCamp = 0;
      for (const r of rows) {
        const v = r.detailPlacementView;
        const p = normPlacement(v.placement || v.targetUrl || v.groupPlacementTargetUrl, v.placementType);
        if (!p) continue;
        const camp = byExt.get(String(r.campaign.id));
        const site = camp ? siteForDay(tl, acc.id, r.segments.date, camp.domain_id) : null;
        if (!camp || !site) { noCamp++; continue; }
        if ((p.type === 'app' || p.type === 'youtube') && !labels.has(p.key)) labels.set(p.key, { label: p.type === 'youtube' ? 'YouTube' : v.displayName || p.key, type: p.type });
        facts.push({ ...zero, date: r.segments.date, domainId: site, campaignId: camp.id, placement: p.key,
          spendUsd: toUsd(Number(r.metrics.costMicros ?? 0) / 1e6, acc.currency, r.segments.date), clicks: Number(r.metrics.clicks ?? 0), trafficImpressions: Number(r.metrics.impressions ?? 0) });
      }
      total += await replacePlacements('google-ads', w.from, w.to, camps.map((x) => x.id), facts);
      if (noCamp) notes.push(`${acc.name}: ${noCamp} linhas de campanhas sem domínio (rode a estrutura)`);
      ok++;
    } catch (e) {
      notes.push(`${acc.name}: ${(e as Error).message}`);
      await setAccountStatus(acc.id, statusFromError(e), (e as Error).message.slice(0, 300)).catch(() => {});
      // segue para a próxima conta: um erro numa conta não interrompe as outras
    }
  }
  await saveLabels(labels);
  if (!ok) return { status: 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${accs.length} contas · ${total} linhas de placement${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}

/* ---------------- Ad Manager: receita por placement ---------------- */
/**
 * 0.18 · Relatório de placements por EKV (utm_content como Key-values aprimorados). Formatos tentados, em ordem:
 * 6 métricas → só receita/impressões/cliques (AD_REQUESTS/RESPONSES_SERVED/Active View costumam ser incompatíveis
 * com dimensões de key-values: REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY). Se a rede recusar todos (ou o sync principal
 * já viu que o utm_content não está marcado como EKV), não tenta de novo por 12 h e usa o relatório de Key-values.
 */
const EKV_PL_LAYOUTS = [{ site: true, country: true, core: false, filter: false }, { site: true, country: true, core: true, filter: false }];
const EKV_PL_REFUSED = new Map<string, number>();
const EKV_PL_RETRY_MS = 12 * 3600_000;
const ekvPlacementsOff = (net: string) => { const t = EKV_PL_REFUSED.get(net); return (!!t && Date.now() - t < EKV_PL_RETRY_MS) || ekvKnown(net, 'content') === 'refused'; };

/** Todas as redes importadas; erro numa rede não interrompe as outras. Cada rede só grava os domínios dela. */
export async function runGamPlacements(w: { from: string; to: string }, isFinal = false): Promise<JobResult> {
  const nets = await q<{ id: string; external_id: string; name: string }>(`SELECT id::text, external_id, name FROM integration_accounts WHERE provider = 'gam' AND imported ORDER BY id`);
  if (!nets.length) return { status: 'skipped', message: 'nenhuma rede do Ad Manager marcada para importar' };
  let token: string;
  try { token = await googleAccessToken('gam'); } catch (e) {
    if (e instanceof SyncError && (e.code === 'not_connected' || e.code === 'not_configured')) return { status: 'skipped', message: e.message };
    return { status: 'failed', message: (e as Error).message.slice(0, 500) };
  }
  const camps = await q<{ id: string; ext: string; platform: string }>(`SELECT id::text, external_id AS ext, platform FROM campaigns`);
  const byExt = new Map(camps.filter((x) => x.platform === 'google').map((x) => [x.ext, x.id]));
  const metaIds = new Set(camps.filter((x) => x.platform === 'meta').map((x) => x.ext));   // placements aqui são só do Google Ads
  const idx = await attributionIndex();   // {creative} → campanha (formato do dash antigo)
  const dom = await domainResolver();
  const notes: string[] = [];
  let ok = 0, skippedNets = 0, saved = 0, rowsTotal = 0;
  for (const net of nets) {
    try {
      const all = await resolveKeys(net.external_id, token, [['campaign', config.gamKeys.campaign], ['placement', config.gamPlacementKey], ['content', config.gamKeys.content]]);
      const keys = all.filter((k) => k.usable);
      const has = (r: string) => keys.some((k) => k.role === r);
      const contentKey = all.find((k) => k.role === 'content')!;
      // sem dimensão personalizada: lê o utm_content pela dimensão nativa Key-values ({creative}_{placement})
      if (attributionMode(all) === 'keyvalues' && !(has('campaign') && has('placement'))) {
        // 0.16: primeiro como Key-values aprimorados (EKV: exato, até 100.000 valores); se a rede recusar,
        // 0.15.3: dimensão Key-values no formato que a rede aceitar (sem SITE, só com um site na rede)
        let ekv = false;
        let got: { rows: Awaited<ReturnType<typeof runKvReport>>['rows']; layout: Awaited<ReturnType<typeof runKvReport>>['layout'] } | null = null;
        if (contentKey.id && !ekvPlacementsOff(net.external_id)) {
          for (const lay of EKV_PL_LAYOUTS) {
            try { got = { rows: (await runReport(net.external_id, token, w.from, w.to, [{ ...contentKey, ekv: true }], 'pluto-placements-ekv', [], undefined, lay)).rows, layout: lay }; ekv = true; EKV_PL_REFUSED.delete(net.external_id); break; }
            catch (e) {
              if (e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code)) throw e;
              if (!isConstraint(e)) break;   // outro erro (ex.: 5xx): segue para o relatório de Key-values neste ciclo
              if (lay === EKV_PL_LAYOUTS[EKV_PL_LAYOUTS.length - 1]) {
                EKV_PL_REFUSED.set(net.external_id, Date.now());
                console.warn(`[gam] ${JSON.stringify({ network: net.external_id, report: 'pluto-placements-ekv', ekvRefused: contentKey.adTagName, fallback: 'pluto-placements-kv', nextTry: new Date(Date.now() + EKV_PL_RETRY_MS).toISOString() })}`);
              }
            }
          }
        }
        let { rows: raw, layout } = got ?? await runKvReport(net.external_id, token, w.from, w.to, [], 'pluto-placements-kv', [], contentKey.adTagName);
        // 0.17.1: aceito por bloco de anúncios → vira site pelo mapa bloco → site
        if (layout.unit) { raw = unitsToSites(raw, await fetchUnitMap(net.external_id, token, w.from, w.to), { rows: 0, revenue: 0 }); layout = { ...layout, site: true, unit: false }; }
        const netSites = layout.site ? [] : (await q<{ hostname: string }>('SELECT hostname FROM domains WHERE gam_account_id = $1 AND NOT is_technical', [net.id])).map((x) => x.hostname);
        if (!layout.site && netSites.length !== 1) { notes.push(`${net.name}: o Ad Manager só aceitou o relatório de placements sem site e a rede tem ${netSites.length} sites; placements desta rede ficam sem receita`); continue; }
        const rows = layout.site ? raw : raw.map((r) => ({ ...r, dimensionValues: r.dimensionValues.map((v, i) => (i === 1 && str(v) === ALL ? { stringValue: netSites[0] } : v)) }));
        const facts: PFact[] = [];
        let noPl = 0;
        for (const r of rows) {
          const d = r.dimensionValues; const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
          const day = isoDate(d[0]); const site = str(d[1]);
          if (!day || !site || EMPTY.test(site)) continue;
          const content = ekv ? str(d[3]).trim() : kvValue(str(d[3]), contentKey.adTagName);
          if (!content) continue;
          const a = attributeContent(idx, content);
          // placement só existe no formato do dash antigo; se o {creative} não foi achado, usa o resto do valor do mesmo jeito
          const i = content.indexOf('_');
          const plRaw = 'reason' in a ? (i > 0 ? content.slice(i + 1) : '') : a.placement;
          const p = normPlacement(plRaw);
          if (!p) { noPl++; continue; }
          const domain = await dom.ensure(site);
          if (!domain || domain.pending || domain.gam !== net.id) continue;
          if (!('reason' in a) && a.platform !== 'google') continue;   // placements aqui são só do Google Ads
          facts.push({ ...zero, date: day, domainId: domain.id, campaignId: 'reason' in a ? null : a.campaignId, placement: p.key,
            revenueUsd: num(m[0]), impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]) });
        }
        const mine = (await q<{ id: string }>('SELECT id::text FROM domains WHERE gam_account_id = $1', [net.id])).map((x) => x.id);
        saved += await replacePlacements('gam', w.from, w.to, { domains: mine }, facts, isFinal);
        rowsTotal += rows.length; ok++;
        if (noPl) notes.push(`${net.name}: ${noPl} linhas sem placement`);
        continue;
      }
      // precisa da campanha e de onde tirar o placement: o key-value "placement" ou o utm_content do formato antigo ({creative}_{placement})
      if (!has('campaign') || (!has('placement') && !has('content'))) {
        const bad = all.filter((k) => !k.usable && (k.role === 'campaign' || !has('placement') && !has('content')));
        skippedNets++; notes.push(`${net.name}: key-values fora dos relatórios no Ad Manager: ${bad.map((k) => k.adTagName).join(', ')} (Inventário → Key-values → "Incluir valores nos relatórios"). O site precisa enviar "${config.gamPlacementKey}" com o {placement} da URL, ou o utm_content={creative}_{placement}.`); continue;
      }
      const { rows } = await runReport(net.external_id, token, w.from, w.to, keys, 'pluto-placements');
      const at = (r: string) => { const i = keys.findIndex((k) => k.role === r); return i < 0 ? -1 : 3 + i; };
      const iCamp = at('campaign'), iPl = at('placement'), iContent = at('content');
      // relatório com DATE, SITE, COUNTRY_CODE + key-values; o país é somado aqui
      const facts: PFact[] = [];
      let noPl = 0;
      for (const r of rows) {
        const d = r.dimensionValues; const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
        const day = isoDate(d[0]); const site = str(d[1]);
        if (!day || !site || EMPTY.test(site)) continue;
        const cv = str(d[iCamp]);
        if (metaIds.has(cv) || idx.creative.get(cv)?.platform === 'meta') continue;   // placements aqui são só do Google Ads
        const content = iContent >= 0 ? str(d[iContent]) : '';
        // placement: key-value próprio; sem ele, a parte depois de "{creative}_" no utm_content (formato do dash antigo)
        const legacy = isLegacyUtm(cv, content);
        const plRaw = (iPl >= 0 ? str(d[iPl]) : '') || (legacy ? content.slice(cv.length + 1) : '');
        const p = normPlacement(plRaw);
        if (!p) { noPl++; continue; }
        const domain = await dom.ensure(site);
        if (!domain || domain.pending || domain.gam !== net.id) continue;   // só domínios ligados a esta rede (manual, em Domínios)
        facts.push({ ...zero, date: day, domainId: domain.id, campaignId: cv && !EMPTY.test(cv) ? (legacy ? null : byExt.get(cv)) ?? idx.creative.get(cv)?.cid ?? null : null, placement: p.key,
          revenueUsd: num(m[0]), impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]) });
      }
      const mine = (await q<{ id: string }>('SELECT id::text FROM domains WHERE gam_account_id = $1', [net.id])).map((x) => x.id);
      saved += await replacePlacements('gam', w.from, w.to, { domains: mine }, facts, isFinal);
      rowsTotal += rows.length; ok++;
      if (noPl) notes.push(`${net.name}: ${noPl} linhas sem placement`);
    } catch (e) {
      notes.push(`${net.name}: ${(e as Error).message}`);
    }
  }
  if (!ok && skippedNets === nets.length) return { status: 'skipped', message: notes.join(' · ').slice(0, 500) };
  if (!ok) return { status: 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${nets.length} redes · ${rowsTotal} linhas do relatório · ${saved} gravadas${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}
