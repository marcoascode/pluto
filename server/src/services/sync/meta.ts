/**
 * Meta Ads (Marketing API).
 *  - estrutura: /act_{id}/ads com campanha, conjunto e o link do criativo (define domínio e URL de cada campanha)
 *  - métricas:  /act_{id}/insights level=ad, time_increment=1, breakdowns=country
 * Custo vai para USD pela taxa do dia; IVA = custo × alíquota (app_settings.meta_iva_rate, 13,83%).
 */
import { config } from '../../config.js';
import { q } from '../../db.js';
import { accountDomains, domainResolver, emptyFact, fxToUsd, metaIvaRate, parseUrl, replaceFacts, setAccountStatus, statusFromError, upsertAd, upsertAdGroup, upsertCampaign, urlCache, type Fact } from './common.js';
import { isMetaRateLimit, requestJson, sleep, SyncError } from './http.js';
import { metaAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

const base = () => `${config.api.metaGraph}/${config.oauth.metaApiVersion}`;

/** Segue paging.next. Em limite de uso (#17/#80004…) espera 60 s e tenta de novo (até 3×). */
async function paginate<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  let waits = 0;
  while (url) {
    try {
      const j: { data?: T[]; paging?: { next?: string } } = await requestJson(url, { timeoutMs: 120_000 });
      out.push(...(j.data ?? []));
      url = j.paging?.next ?? null;
    } catch (e) {
      if (isMetaRateLimit(e) && waits++ < 3) { await sleep(60_000); continue; }
      throw e;
    }
  }
  return out;
}

interface MetaAd {
  id: string; name: string; effective_status?: string; adset_id?: string;
  adset?: { id: string; name: string; effective_status?: string };
  campaign?: { id: string; name: string; effective_status?: string };
  creative?: { link_url?: string; template_url?: string; object_story_spec?: any; asset_feed_spec?: any };
}
/** Link de destino do criativo (link, vídeo com CTA, carrossel, dinâmico, catálogo). */
function adLink(ad: MetaAd): string | null {
  const c = ad.creative ?? {};
  const s = c.object_story_spec ?? {};
  return s.link_data?.link ?? s.video_data?.call_to_action?.value?.link ?? s.link_data?.child_attachments?.[0]?.link ?? s.template_data?.link
    ?? c.asset_feed_spec?.link_urls?.[0]?.website_url ?? c.link_url ?? c.template_url ?? null;
}

interface Acc { id: string; external_id: string; name: string; currency: string }

/** Atualiza campanhas/conjuntos/anúncios de uma conta. Devolve os mapas de ids externos → internos. */
async function syncStructure(acc: Acc, token: string, dom: Awaited<ReturnType<typeof domainResolver>>) {
  const fields = 'id,name,effective_status,adset_id,adset{id,name,effective_status},campaign{id,name,effective_status},creative{link_url,template_url,object_story_spec,asset_feed_spec}';
  const ads = await paginate<MetaAd>(`${base()}/act_${acc.external_id}/ads?${new URLSearchParams({ fields, limit: '200', access_token: token })}`);
  const fallback = await accountDomains(acc.id);
  // domínio da campanha = o mais comum entre os links dos anúncios dela; senão o único domínio ligado à conta
  const votes = new Map<string, Map<string, number>>();
  for (const ad of ads) {
    const d = dom.byUrl(adLink(ad)); const cid = ad.campaign?.id;
    if (!d || !cid) continue;
    if (!votes.has(cid)) votes.set(cid, new Map());
    votes.get(cid)!.set(d.id, (votes.get(cid)!.get(d.id) ?? 0) + 1);
  }
  const campDomain = (cid: string) => { const v = votes.get(cid); if (v?.size) return [...v].sort((a, b) => b[1] - a[1])[0][0]; return fallback.length === 1 ? fallback[0] : null; };
  const camps = new Map<string, { id: string; domainId: string | null }>(), groups = new Map<string, string>(), adsMap = new Map<string, { id: string; path: string | null }>();
  for (const ad of ads) {
    if (!ad.campaign) continue;
    let c = camps.get(ad.campaign.id);
    if (!c) { c = await upsertCampaign(acc.id, 'meta', ad.campaign.id, ad.campaign.name, ad.campaign.effective_status ?? 'ACTIVE', campDomain(ad.campaign.id)); camps.set(ad.campaign.id, c); }
    const gExt = ad.adset?.id ?? ad.adset_id ?? `${ad.campaign.id}-0`;
    let g = groups.get(gExt);
    if (!g) { g = await upsertAdGroup(c.id, gExt, ad.adset?.name ?? 'Conjunto', ad.adset?.effective_status); groups.set(gExt, g); }
    const link = adLink(ad);
    adsMap.set(ad.id, { id: await upsertAd(g, ad.id, ad.name, link, ad.effective_status), path: parseUrl(link)?.pathname ?? null });
  }
  return { camps, groups, ads: adsMap, campDomain };
}

interface InsightRow { date_start: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; ad_id: string; ad_name: string; country?: string; spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string }

export async function runMeta(kind: 'structure' | 'metrics', w: { from: string; to: string }): Promise<JobResult> {
  const token = await metaAccessToken();
  const accs = await q<Acc>(`SELECT id::text, external_id, name, currency FROM integration_accounts WHERE provider = 'meta' AND imported ORDER BY id`);
  if (!accs.length) return { status: 'skipped', message: 'nenhuma conta Meta marcada para importar' };
  const dom = await domainResolver();
  const toUsd = kind === 'metrics' ? await fxToUsd(w.from, w.to) : null;
  const iva = await metaIvaRate();
  const url = urlCache();
  const notes: string[] = [];
  let ok = 0, rowsTotal = 0;
  for (const acc of accs) {
    try {
      const info = await requestJson<{ currency?: string; timezone_name?: string; account_status?: number }>(`${base()}/act_${acc.external_id}?${new URLSearchParams({ fields: 'name,currency,timezone_name,account_status', access_token: token })}`);
      if (info.currency && ['USD', 'BRL', 'EUR'].includes(info.currency)) acc.currency = info.currency;
      await q('UPDATE integration_accounts SET currency = $2, timezone = COALESCE($3, timezone) WHERE id = $1', [acc.id, acc.currency, info.timezone_name ?? null]);
      const st = await syncStructure(acc, token, dom);
      if (kind === 'structure') { await setAccountStatus(acc.id, 'ok', null); ok++; continue; }

      const rows = await paginate<InsightRow>(`${base()}/act_${acc.external_id}/insights?${new URLSearchParams({
        level: 'ad', time_increment: '1', breakdowns: 'country', limit: '500', access_token: token,
        fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks',
        time_range: JSON.stringify({ since: w.from, until: w.to }),
      })}`);
      const facts: Fact[] = [];
      let noDomain = 0;
      for (const r of rows) {
        // anúncio novo que a estrutura ainda não viu (ex.: criado agora)
        let c = st.camps.get(r.campaign_id);
        if (!c) { c = await upsertCampaign(acc.id, 'meta', r.campaign_id, r.campaign_name, 'ACTIVE', st.campDomain(r.campaign_id)); st.camps.set(r.campaign_id, c); }
        let g = st.groups.get(r.adset_id);
        if (!g) { g = await upsertAdGroup(c.id, r.adset_id, r.adset_name); st.groups.set(r.adset_id, g); }
        let a = st.ads.get(r.ad_id);
        if (!a) { a = { id: await upsertAd(g, r.ad_id, r.ad_name), path: null }; st.ads.set(r.ad_id, a); }
        if (!c.domainId) { noDomain++; continue; }
        const spendUsd = toUsd!(Number(r.spend ?? 0), acc.currency, r.date_start);
        facts.push(emptyFact({
          date: r.date_start, domainId: c.domainId, urlId: await url(c.domainId, a.path), platform: 'meta',
          campaignId: c.id, adGroupId: g, adId: a.id, country: (r.country ?? 'ZZ').toUpperCase(),
          spendUsd, ivaUsd: spendUsd * iva, trafficImpressions: Number(r.impressions ?? 0), trafficClicks: Number(r.inline_link_clicks ?? r.clicks ?? 0),
        }));
      }
      const scope = (await q<{ id: string }>('SELECT id::text FROM campaigns WHERE account_id = $1', [acc.id])).map((x) => x.id);
      rowsTotal += await replaceFacts('meta', w.from, w.to, scope, facts);
      const msg = noDomain ? `${noDomain} linhas sem domínio: ligue a conta a um domínio em Domínios ou confira o link dos anúncios` : null;
      if (msg) notes.push(`${acc.name}: ${msg}`);
      await setAccountStatus(acc.id, 'ok', msg);
      ok++;
    } catch (e) {
      notes.push(`${acc.name}: ${(e as Error).message}`);
      await setAccountStatus(acc.id, statusFromError(e), (e as Error).message.slice(0, 300));
      if ((e as SyncError).code === 'token') break;   // token vale para todas as contas
    }
  }
  if (!ok) return { status: 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${accs.length} contas · ${kind === 'structure' ? 'estrutura atualizada' : rowsTotal + ' linhas'}${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}
