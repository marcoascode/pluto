/**
 * Google Ads (API REST + GAQL). Precisa de GOOGLE_ADS_DEVELOPER_TOKEN e da MCC em GOOGLE_ADS_LOGIN_CUSTOMER_ID.
 *  - estrutura: contas da MCC (customer_client) + campanhas/grupos/anúncios com o URL final de cada anúncio
 *  - métricas:  custo por anúncio/dia (ad_group_ad) + custo por campanha/dia (campaign, pega Performance Max)
 *               + país por campanha/dia (geographic_view). O custo do anúncio é dividido entre os países
 *               na mesma proporção do custo da campanha naquele dia (o Google não entrega anúncio × país).
 */
import { config } from '../../config.js';
import { one, q } from '../../db.js';
import { loadTimeline, siteForDay } from '../accountLinks.js';
import { accountDomains, domainResolver, emptyFact, fxToBrl, parseUrl, replaceFacts, setAccountStatus, statusFromError, upsertAd, upsertAdGroup, upsertCampaign, urlCache, type Fact } from './common.js';
import { requestJson, SyncError } from './http.js';
import { googleAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

const digits = (s: string) => s.replace(/\D/g, '');

export async function ctx() {
  if (!config.oauth.googleAdsDeveloperToken) throw new SyncError('not_configured', 'Aguardando o developer token do Google Ads (GOOGLE_ADS_DEVELOPER_TOKEN).');
  const conn = await one<{ external_id: string | null }>(`SELECT external_id FROM integration_connections WHERE provider = 'google-ads'`);
  const mcc = config.oauth.googleAdsLoginCustomerId ?? (conn?.external_id ? digits(conn.external_id) : undefined);
  if (!mcc) throw new SyncError('not_configured', 'Informe a MCC em GOOGLE_ADS_LOGIN_CUSTOMER_ID.');
  const token = await googleAccessToken('google-ads');
  return { mcc, token };
}

/** GAQL com paginação (googleAds:search). */
export async function gaql<T = any>(c: { mcc: string; token: string }, customerId: string, query: string): Promise<T[]> {
  const url = `${config.api.googleAds}/${config.oauth.googleAdsApiVersion}/customers/${digits(customerId)}/googleAds:search`;
  const headers = { Authorization: `Bearer ${c.token}`, 'developer-token': config.oauth.googleAdsDeveloperToken!, 'login-customer-id': c.mcc };
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const j = await requestJson<{ results?: T[]; nextPageToken?: string }>(url, { method: 'POST', headers, body: { query, ...(pageToken ? { pageToken } : {}) }, timeoutMs: 120_000 });
    out.push(...(j.results ?? []));
    pageToken = j.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

let countryCodes: Map<string, string> | null = null;
async function geoCountries(c: { mcc: string; token: string }, customerId: string) {
  if (countryCodes) return countryCodes;
  const rows = await gaql<{ geoTargetConstant: { id: string; countryCode?: string } }>(c, customerId,
    `SELECT geo_target_constant.id, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.target_type = 'Country'`);
  countryCodes = new Map(rows.filter((r) => r.geoTargetConstant.countryCode).map((r) => [String(r.geoTargetConstant.id), r.geoTargetConstant.countryCode!.toUpperCase()]));
  return countryCodes;
}

/** Contas da MCC → integration_accounts (contas novas entram desmarcadas; o admin escolhe quais importar). */
async function discoverAccounts(c: { mcc: string; token: string }) {
  const rows = await gaql<{ customerClient: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean; status?: string } }>(c, c.mcc,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.manager = false`);
  for (const { customerClient: a } of rows) {
    const cur = ['USD', 'BRL', 'EUR'].includes(a.currencyCode ?? '') ? a.currencyCode! : 'USD';
    await q(`INSERT INTO integration_accounts (provider, external_id, name, currency, timezone, imported, status, platform_status) VALUES ('google-ads', $1, $2, $3, $4, false, 'ok', $5)
             ON CONFLICT (provider, external_id) DO UPDATE SET currency = EXCLUDED.currency, timezone = EXCLUDED.timezone, platform_status = EXCLUDED.platform_status,
               status = CASE WHEN $5 = 'ENABLED' THEN integration_accounts.status ELSE 'error' END,
               message = CASE WHEN $5 = 'ENABLED' THEN integration_accounts.message ELSE 'Conta ' || $5 || ' no Google Ads' END`,
      [digits(String(a.id)), a.descriptiveName || `Conta ${a.id}`, cur, a.timeZone ?? config.appTz, a.status ?? 'ENABLED']);
  }
  const mccName = await gaql<{ customer: { descriptiveName?: string } }>(c, c.mcc, 'SELECT customer.descriptive_name FROM customer');
  await q(`UPDATE integration_connections SET external_id = $1, display_name = COALESCE($2, display_name) WHERE provider = 'google-ads'`, [c.mcc, mccName[0]?.customer?.descriptiveName ?? null]);
  return rows.length;
}

interface AdRow { segments?: { date: string }; campaign: { id: string; name: string; status: string }; adGroup: { id: string; name: string; status?: string }; adGroupAd: { status?: string; ad: { id: string; name?: string; finalUrls?: string[] } }; metrics?: { costMicros?: string; clicks?: string; impressions?: string } }
interface CampRow { segments: { date: string }; campaign: { id: string; name: string; status: string }; metrics: { costMicros?: string; clicks?: string; impressions?: string } }
interface GeoRow { segments: { date: string }; campaign: { id: string }; geographicView: { countryCriterionId?: string }; metrics: { costMicros?: string; impressions?: string } }
const micros = (v?: string) => Number(v ?? 0) / 1e6;
const n = (v?: string) => Number(v ?? 0);

export async function runGoogleAds(kind: 'structure' | 'metrics', w: { from: string; to: string }): Promise<JobResult> {
  let c: { mcc: string; token: string };
  try { c = await ctx(); } catch (e) { return { status: 'skipped', message: (e as Error).message }; }
  if (kind === 'structure') { try { await discoverAccounts(c); } catch (e) { return { status: 'failed', message: `MCC: ${(e as Error).message}`.slice(0, 500) }; } }
  // só contas ativas no Google Ads (canceladas/suspensas ficam de fora; o status vem da MCC no job de estrutura)
  const accs = await q<{ id: string; external_id: string; name: string; currency: string }>(`SELECT id::text, external_id, name, currency FROM integration_accounts WHERE provider = 'google-ads' AND imported AND COALESCE(platform_status, 'ENABLED') = 'ENABLED' ORDER BY id`);
  if (!accs.length) return { status: kind === 'structure' ? 'success' : 'skipped', message: 'nenhuma conta Google Ads ativa marcada para importar' };
  const dom = await domainResolver();
  const toBrl = kind === 'metrics' ? await fxToBrl(w.from, w.to) : null;
  // 0.17: site da conta em cada dia (vínculo com data). A despesa de um dia vai para o site que a conta pagava nele.
  const tl = await loadTimeline(accs.map((a) => a.id));
  const url = urlCache();
  const notes: string[] = [];
  let ok = 0, total = 0;
  for (const acc of accs) {
    try {
      const fallback = await accountDomains(acc.id);
      const range = `segments.date BETWEEN '${w.from}' AND '${w.to}'`;
      const adRows = await gaql<AdRow>(c, acc.external_id, kind === 'structure'
        ? `SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.status != 'REMOVED' AND ad_group_ad.status != 'REMOVED'`
        : `SELECT segments.date, campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, metrics.cost_micros, metrics.clicks, metrics.impressions FROM ad_group_ad WHERE ${range} AND metrics.impressions > 0`);
      // domínio da campanha: o mais comum entre os URLs finais dos anúncios; senão o único domínio ligado à conta
      const votes = new Map<string, Map<string, number>>();
      for (const r of adRows) { const d = dom.byUrl(r.adGroupAd.ad.finalUrls?.[0]); if (!d) continue; const v = votes.get(r.campaign.id) ?? new Map(); v.set(d.id, (v.get(d.id) ?? 0) + 1); votes.set(r.campaign.id, v); }
      const campDomain = (id: string) => { const v = votes.get(id); return v?.size ? [...v].sort((a, b) => b[1] - a[1])[0][0] : fallback.length === 1 ? fallback[0] : null; };
      const camps = new Map<string, { id: string; domainId: string | null }>(), groups = new Map<string, string>(), ads = new Map<string, { id: string; path: string | null }>();
      const camp = async (x: { id: string; name: string; status: string }) => { let v = camps.get(x.id); if (!v) { v = await upsertCampaign(acc.id, 'google', x.id, x.name, x.status, campDomain(x.id)); camps.set(x.id, v); } return v; };
      for (const r of adRows) {
        const cp = await camp(r.campaign);
        let g = groups.get(r.adGroup.id);
        if (!g) { g = await upsertAdGroup(cp.id, r.adGroup.id, r.adGroup.name, r.adGroup.status); groups.set(r.adGroup.id, g); }
        if (!ads.has(r.adGroupAd.ad.id)) {
          const link = r.adGroupAd.ad.finalUrls?.[0] ?? null;
          ads.set(r.adGroupAd.ad.id, { id: await upsertAd(g, r.adGroupAd.ad.id, r.adGroupAd.ad.name || `Anúncio ${r.adGroupAd.ad.id}`, link, r.adGroupAd.status), path: parseUrl(link)?.pathname ?? null });
        }
      }
      if (kind === 'structure') { await setAccountStatus(acc.id, 'ok', null); ok++; continue; }

      const campRows = await gaql<CampRow>(c, acc.external_id, `SELECT segments.date, campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE ${range} AND metrics.impressions > 0`);
      const geoRows = await gaql<GeoRow>(c, acc.external_id, `SELECT segments.date, campaign.id, geographic_view.country_criterion_id, geographic_view.location_type, metrics.cost_micros, metrics.impressions FROM geographic_view WHERE ${range} AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'`);
      const cc = await geoCountries(c, acc.external_id);
      // participação de cada país no custo (ou impressões) da campanha no dia
      const shares = new Map<string, [string, number][]>();
      {
        const acc2 = new Map<string, Map<string, { cost: number; imp: number }>>();
        for (const g of geoRows) {
          const k = `${g.segments.date}|${g.campaign.id}`, code = cc.get(String(g.geographicView.countryCriterionId)) ?? 'ZZ';
          const m = acc2.get(k) ?? new Map(); const e = m.get(code) ?? { cost: 0, imp: 0 };
          e.cost += micros(g.metrics.costMicros); e.imp += n(g.metrics.impressions); m.set(code, e); acc2.set(k, m);
        }
        for (const [k, m] of acc2) {
          const tc = [...m.values()].reduce((a, x) => a + x.cost, 0), ti = [...m.values()].reduce((a, x) => a + x.imp, 0);
          shares.set(k, [...m].map(([code, x]) => [code, tc > 0 ? x.cost / tc : ti > 0 ? x.imp / ti : 0] as [string, number]).filter(([, s]) => s > 0));
        }
      }
      const split = (date: string, campaignExt: string) => shares.get(`${date}|${campaignExt}`) ?? [['ZZ', 1]];
      const facts: Fact[] = [];
      const used = new Map<string, { cost: number; clicks: number; imp: number }>();
      let noDomain = 0;
      const push = (date: string, domainId: string, cp: { id: string }, ext: string, gid: string | null, adId: string | null, urlId: string | null, costCur: number, clicks: number, imp: number) => {
        const brl = toBrl!(costCur, acc.currency, date);
        for (const [country, s] of split(date, ext)) facts.push(emptyFact({ date, domainId, urlId, platform: 'google', campaignId: cp.id, adGroupId: gid, adId, country, spendBrl: brl * s, trafficClicks: clicks * s, trafficImpressions: imp * s }));
      };
      for (const r of adRows) {
        const date = r.segments!.date, cp = await camp(r.campaign);
        const k = `${date}|${r.campaign.id}`, u = used.get(k) ?? { cost: 0, clicks: 0, imp: 0 };
        const cost = micros(r.metrics?.costMicros), clicks = n(r.metrics?.clicks), imp = n(r.metrics?.impressions);
        u.cost += cost; u.clicks += clicks; u.imp += imp; used.set(k, u);
        const site = siteForDay(tl, acc.id, date, cp.domainId);
        if (!site) { noDomain++; continue; }
        const ad = ads.get(r.adGroupAd.ad.id)!;
        push(date, site, cp, r.campaign.id, groups.get(r.adGroup.id)!, ad.id, await url(site, ad.path), cost, clicks, imp);
      }
      // o que a campanha gastou fora dos anúncios (Performance Max, Demand Gen…) fica no nível da campanha
      for (const r of campRows) {
        const date = r.segments.date, cp = await camp(r.campaign), u = used.get(`${date}|${r.campaign.id}`) ?? { cost: 0, clicks: 0, imp: 0 };
        const cost = micros(r.metrics.costMicros) - u.cost, clicks = n(r.metrics.clicks) - u.clicks, imp = n(r.metrics.impressions) - u.imp;
        if (cost <= 0.000001 && clicks <= 0 && imp <= 0) continue;
        const site = siteForDay(tl, acc.id, date, cp.domainId);
        if (!site) { noDomain++; continue; }
        push(date, site, cp, r.campaign.id, null, null, null, Math.max(0, cost), Math.max(0, clicks), Math.max(0, imp));
      }
      const scope = (await q<{ id: string }>('SELECT id::text FROM campaigns WHERE account_id = $1', [acc.id])).map((x) => x.id);
      total += await replaceFacts('google-ads', w.from, w.to, scope, facts);
      const msg = noDomain ? `${noDomain} linhas sem domínio: ligue a conta a um domínio em Domínios ou confira o URL final dos anúncios` : null;
      if (msg) notes.push(`${acc.name}: ${msg}`);
      await setAccountStatus(acc.id, 'ok', msg);
      ok++;
    } catch (e) {
      notes.push(`${acc.name}: ${(e as Error).message}`);
      await setAccountStatus(acc.id, statusFromError(e), (e as Error).message.slice(0, 300)).catch(() => {});
      // segue para a próxima conta: um erro numa conta não interrompe as outras
    }
  }
  if (!ok) return { status: 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${accs.length} contas · ${kind === 'structure' ? 'estrutura atualizada' : total + ' linhas'}${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}
