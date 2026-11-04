/**
 * Google Ad Manager (Ad Manager API v1, REST).
 * Relatório HISTORICAL em USD: DATE × SITE × COUNTRY_CODE × key-values (dimensões personalizadas)
 *   métricas REVENUE, IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, CLICKS, ACTIVE_VIEW_VIEWABLE_IMPRESSIONS.
 * Atribuição: o site manda no GPT os key-values utm_campaign ({campaignid} / {{campaign.id}}) e
 * utm_content ({adgroupid}_{creative} / {{adset.id}}_{{ad.id}}). Linha sem key-value válido → receita
 * (também aceita o formato do dash antigo do Google Ads: utm_campaign={creative} e utm_content={creative}_{placement};
 *  o {creative} é o ID do anúncio, e dele saem o grupo e a campanha — veja attribute()),
 * "não atribuída" (platform = 'none' + motivo), nunca rateada entre campanhas.
 * Receita gravada BRUTA; o revShare do domínio é aplicado na consulta.
 * Rede × domínio: VALIDAÇÃO ESTRITA. Só entra a linha cujo domínio está ligado a ESTA rede em Domínios
 * (domains.gam_account_id === net.id). O worker não liga domínio a rede (claimGam removido).
 * Linhas sem site / de site sem rede / de site de outra rede são contadas e viram aviso no status da rede.
 */
import { config } from '../../config.js';
import { q } from '../../db.js';
import { domainResolver, emptyFact, parseUrl, replaceFacts, setAccountStatus, statusFromError, urlCache, type Fact } from './common.js';
import { requestJson, sleep, SyncError } from './http.js';
import { googleAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

export type Val = { intValue?: string; doubleValue?: number; stringValue?: string; boolValue?: boolean };
export const num = (v?: Val) => (v ? Number(v.doubleValue ?? v.intValue ?? 0) || 0 : 0);
export const str = (v?: Val) => (v?.stringValue ?? (v?.intValue != null ? String(v.intValue) : '')).trim();
/** DATE vem como "2026-10-04", 20261004 ou "20261004". */
export function isoDate(v?: Val): string | null {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}
export const date = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return { year, month, day }; };
export const EMPTY = /^(\(?not set\)?|\(?none\)?|-|n\/a|unknown|\(not applicable\))?$/i;

export interface KeyInfo { role: 'campaign' | 'content' | 'source' | 'path' | 'placement'; adTagName: string; id: string | null; usable: boolean }

/** Procura os ids dos key-values pelo nome usado na tag (adTagName). Só servem se estiverem como "Custom dimension". */
export async function resolveKeys(network: string, token: string, wanted: [KeyInfo['role'], string][] = Object.entries(config.gamKeys).filter(([, v]) => v) as [KeyInfo['role'], string][]): Promise<KeyInfo[]> {
  const out: KeyInfo[] = [];
  for (const [role, name] of wanted) {
    const u = `${config.api.gam}/v1/networks/${network}/customTargetingKeys?${new URLSearchParams({ filter: `adTagName = "${name}"`, pageSize: '5' })}`;
    const j = await requestJson<{ customTargetingKeys?: { customTargetingKeyId?: string; name?: string; adTagName?: string; reportableType?: string }[] }>(u, { headers: { Authorization: `Bearer ${token}` } });
    const k = j.customTargetingKeys?.find((x) => x.adTagName === name) ?? j.customTargetingKeys?.[0];
    const id = k?.customTargetingKeyId ?? k?.name?.split('/').pop() ?? null;
    out.push({ role, adTagName: name, id, usable: !!id && k?.reportableType === 'CUSTOM_DIMENSION' });
  }
  return out;
}

/** Cria o relatório (oculto), roda, espera e baixa todas as linhas. */
/** extra: dimensões nativas a mais depois de COUNTRY_CODE (ex.: URL_NAME). As dimensões personalizadas vêm depois delas. */
export async function runReport(network: string, token: string, from: string, to: string, keys: KeyInfo[], label = 'pluto-sync', extra: string[] = []) {
  const auth = { Authorization: `Bearer ${token}` };
  const dims = ['DATE', 'SITE', 'COUNTRY_CODE', ...extra, ...keys.map((_, i) => `CUSTOM_DIMENSION_${i}_VALUE`)];
  const metrics = ['REVENUE', 'IMPRESSIONS', 'AD_REQUESTS', 'RESPONSES_SERVED', 'CLICKS', 'ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'];
  const report = await requestJson<{ name: string }>(`${config.api.gam}/v1/networks/${network}/reports`, {
    method: 'POST', headers: auth,
    body: {
      displayName: `${label} ${from}..${to} ${new Date().toISOString()}`,
      visibility: 'HIDDEN',
      reportDefinition: {
        dimensions: dims, metrics, reportType: 'HISTORICAL', currencyCode: 'USD',
        dateRange: { fixed: { startDate: date(from), endDate: date(to) } },
        ...(keys.length ? { customDimensionKeyIds: keys.map((k) => k.id) } : {}),
      },
    },
  });
  const op = await requestJson<{ name: string }>(`${config.api.gam}/v1/${report.name}:run`, { method: 'POST', headers: auth, body: {} });
  // espera: 5 s e vai aumentando (máx. ~10 min)
  let result: string | null = null;
  for (let i = 0, wait = 5_000; i < 40; i++, wait = Math.min(wait * 1.5, 30_000)) {
    const o = await requestJson<{ done?: boolean; error?: { message?: string }; response?: { reportResult?: string } }>(`${config.api.gam}/v1/${op.name}`, { headers: auth });
    if (o.error) throw new SyncError('api', `Relatório do Ad Manager falhou: ${o.error.message}`);
    if (o.done) { result = o.response?.reportResult ?? null; break; }
    await sleep(wait);
  }
  if (!result) throw new SyncError('api', 'O relatório do Ad Manager demorou demais. Nova tentativa no próximo ciclo.');
  const rows: { dimensionValues: Val[]; metricValueGroups: { primaryValues: Val[] }[] }[] = [];
  let pageToken: string | undefined;
  do {
    const j = await requestJson<{ rows?: typeof rows; nextPageToken?: string }>(`${config.api.gam}/v1/${result}:fetchRows?${new URLSearchParams({ pageSize: '10000', ...(pageToken ? { pageToken } : {}) })}`, { headers: auth, timeoutMs: 120_000 });
    rows.push(...(j.rows ?? []));
    pageToken = j.nextPageToken || undefined;
  } while (pageToken);
  return { rows, dims };
}

/** Índices de campanha/grupo/anúncio por id externo (Google e Meta). */
export async function attributionIndex() {
  const camps = await q<{ id: string; ext: string; platform: 'google' | 'meta'; domain_id: string | null }>('SELECT id::text, external_id AS ext, platform, domain_id::text FROM campaigns');
  const groups = await q<{ id: string; ext: string; cid: string }>('SELECT id::text, external_id AS ext, campaign_id::text AS cid FROM ad_groups');
  const ads = await q<{ id: string; ext: string; gid: string }>('SELECT id::text, external_id AS ext, ad_group_id::text AS gid FROM ads');
  // formato do dash antigo: o {creative} (ID do anúncio do Google Ads) sozinho → anúncio, grupo e campanha.
  // Só entra ID que aparece uma vez (se o mesmo ID existir em dois lugares, não adivinha).
  const gAds = await q<{ id: string; ext: string; gid: string; cid: string }>(`
    SELECT a.id::text, a.external_id AS ext, a.ad_group_id::text AS gid, g.campaign_id::text AS cid
      FROM ads a JOIN ad_groups g ON g.id = a.ad_group_id JOIN campaigns c ON c.id = g.campaign_id WHERE c.platform = 'google'`);
  const seen = new Map<string, number>();
  for (const a of gAds) seen.set(a.ext, (seen.get(a.ext) ?? 0) + 1);
  return {
    camp: new Map(camps.map((c) => [c.ext, c])),
    group: new Map(groups.map((g) => [`${g.cid}|${g.ext}`, g.id])),
    ad: new Map(ads.map((a) => [`${a.gid}|${a.ext}`, a.id])),
    creative: new Map(gAds.filter((a) => seen.get(a.ext) === 1).map((a) => [a.ext, a])),
  };
}

type Resolver = Awaited<ReturnType<typeof domainResolver>>;
type Index = Awaited<ReturnType<typeof attributionIndex>>;

/** Formato do dash antigo (Google Ads): utm_campaign={creative} e utm_content={creative}_{placement}. */
export const isLegacyUtm = (campVal: string, content: string) => !!campVal && (content === campVal || content.startsWith(`${campVal}_`));

/**
 * Campanha, grupo e anúncio de uma linha do Ad Manager, nos dois formatos de UTM:
 *   padrão do dash ........ utm_campaign={campaignid}   utm_content={adgroupid}_{creative}   (Meta: {{campaign.id}} / {{adset.id}}_{{ad.id}})
 *   formato do dash antigo  utm_campaign={creative}     utm_content={creative}_{placement}   (só Google Ads)
 * O formato antigo é reconhecido quando utm_content começa com o próprio utm_campaign + "_"; se o ID do utm_campaign não for
 * de nenhuma campanha, também tenta como {creative}. Assim os dois dashes funcionam com o mesmo sufixo nas campanhas.
 */
export function attribute(idx: Index, campVal: string, content: string, source: string):
  { platform: 'google' | 'meta'; campaignId: string; adGroupId: string | null; adId: string | null } | { reason: string } {
  const legacy = isLegacyUtm(campVal, content);
  const c = legacy ? undefined : idx.camp.get(campVal);
  if (c) {
    const [g, a] = content.split('_');
    const adGroupId = g && !EMPTY.test(g) ? idx.group.get(`${c.id}|${g}`) ?? null : null;
    const adId = adGroupId && a && !EMPTY.test(a) ? idx.ad.get(`${adGroupId}|${a}`) ?? null : null;
    return { platform: c.platform, campaignId: c.id, adGroupId, adId };
  }
  const cr = idx.creative.get(campVal);
  if (cr) return { platform: 'google', campaignId: cr.cid, adGroupId: cr.gid, adId: cr.id };
  if (legacy) return { reason: 'gads_creative_not_found' };
  return { reason: source && /^(fb|facebook|ig|instagram|an|msg|meta)$/.test(source) ? 'meta_ad_not_found' : 'campaign_not_found' };
}

/** Uma rede do Ad Manager: relatório → fatos → grava só os domínios desta rede. */
async function runNetwork(net: { id: string; external_id: string; name: string }, token: string, w: { from: string; to: string }, isFinal: boolean,
  dom: Resolver, idx: Index, url: ReturnType<typeof urlCache>) {
  const all = await resolveKeys(net.external_id, token);
  const keys = all.filter((k) => k.usable);
  const missing = all.filter((k) => !k.usable && (k.role === 'campaign' || k.role === 'content'));   // source e path são opcionais
  /*
   * URL da página (slug) para a tela URLs, nesta ordem:
   *  1. key-value do caminho (GAM_KEY_PATH, padrão page_path) como dimensão personalizada: o caminho exato;
   *  2. sem ele, a dimensão nativa URL_NAME do Ad Manager (Inventário → URL). A API REST ainda recusa essa dimensão
   *     em parte das redes: na 1ª recusa a rede é marcada e o relatório segue sem URL (sem quebrar o sync);
   *  3. sem nenhum dos dois, a receita fica em "(sem URL)" e a rede mostra o aviso de como configurar.
   */
  const pathKey = keys.find((k) => k.role === 'path');
  const tryUrlDim = !pathKey && !URL_DIM_UNSUPPORTED.has(net.external_id);
  let rows: Awaited<ReturnType<typeof runReport>>['rows'];
  let urlDim = false;
  try {
    rows = (await runReport(net.external_id, token, w.from, w.to, keys, 'pluto-sync', tryUrlDim ? ['URL_NAME'] : [])).rows;
    urlDim = tryUrlDim;
  } catch (e) {
    if (!tryUrlDim || !(e instanceof SyncError) || !/URL_NAME|INVALID_ARGUMENT|invalid|not (supported|available)/i.test(e.message)) throw e;
    URL_DIM_UNSUPPORTED.add(net.external_id);
    rows = (await runReport(net.external_id, token, w.from, w.to, keys)).rows;
  }
  const base = 3 + (urlDim ? 1 : 0);
  const ki = (role: KeyInfo['role']) => { const i = keys.findIndex((k) => k.role === role); return i < 0 ? -1 : base + i; };
  const iCamp = ki('campaign'), iContent = ki('content'), iSource = ki('source'), iPath = ki('path'), iUrl = urlDim ? 3 : -1;
  const facts: Fact[] = [];
  // descartes, agrupados para o aviso final da rede (setAccountStatus): linhas e receita (USD) de cada caso
  const noSite = { rows: 0, revenue: 0 };                                       // SITE vazio/inválido na API
  const unlinked = new Map<string, { rows: number; revenue: number }>();        // domínio sem rede do Ad Manager (gam_account_id nulo)
  const otherNet = new Map<string, { rows: number; revenue: number }>();        // domínio ligado a OUTRA rede
  const bump = (m: Map<string, { rows: number; revenue: number }>, host: string, rev: number) => { const x = m.get(host) ?? { rows: 0, revenue: 0 }; x.rows++; x.revenue += rev; m.set(host, x); };
  for (const r of rows) {
    const d = r.dimensionValues;
    const day = isoDate(d[0]);
    const site = str(d[1]);
    const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
    const revenue = num(m[0]);
    if (!day || (!revenue && !num(m[1]) && !num(m[2]))) continue;
    // Linha sem SITE (ou valor inválido): impossível atribuir a um domínio → ignora, mas conta para o aviso
    const domain = site && !EMPTY.test(site) ? await dom.ensure(site) : null;
    if (!domain) { noSite.rows++; noSite.revenue += revenue; continue; }
    // VALIDAÇÃO ESTRITA da rede (fim do claimGam): o domínio só recebe receita da rede ligada a ele manualmente
    // em Domínios (domains.gam_account_id). Nada de UPDATE automático aqui.
    if (domain.gam !== net.id) { bump(domain.gam ? otherNet : unlinked, domain.hostname, revenue); continue; }
    const campVal = iCamp >= 0 ? str(d[iCamp]) : '';
    const content = iContent >= 0 ? str(d[iContent]) : '';
    const source = iSource >= 0 ? str(d[iSource]).toLowerCase() : '';
    // ---- atribuição ----
    let platform: 'google' | 'meta' | 'none' = 'none', reason: string | null = null;
    let campaignId: string | null = null, adGroupId: string | null = null, adId: string | null = null;
    if (iCamp < 0) reason = 'gam_kv_not_configured';
    else if (domain.pending) reason = 'unknown_domain';
    else if (EMPTY.test(campVal)) reason = 'missing_campaign_id';
    else if (/[{}]/.test(campVal) || /[{}]/.test(content)) reason = 'invalid_utm';
    else {
      const a = attribute(idx, campVal, content, source);
      if ('reason' in a) reason = a.reason;
      else ({ platform, campaignId, adGroupId, adId } = a);
    }
    const path = iPath >= 0 ? str(d[iPath]) : iUrl >= 0 ? urlPath(str(d[iUrl])) : '';
    facts.push(emptyFact({
      date: day, domainId: domain.id, urlId: path && !EMPTY.test(path) ? await url(domain.id, path) : null,
      platform, campaignId, adGroupId, adId, country: str(d[2]).toUpperCase() || 'ZZ', reason, utmSource: normSource(source),
      revenueUsd: revenue, impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]),
    }));
  }
  const mine = (await q<{ id: string }>('SELECT id::text FROM domains WHERE gam_account_id = $1', [net.id])).map((x) => x.id);
  const n = await replaceFacts('gam', w.from, w.to, { domains: mine }, facts, isFinal);
  const warn = [
    missing.length ? `key-values sem dimensão personalizada no Ad Manager: ${missing.map((k) => k.adTagName).join(', ')} (Admin → Key-values → "Report on values": Custom dimension)` : '',
    noSite.rows ? `${noSite.rows} linhas sem site ignoradas (${usd(noSite.revenue)}): confira se utm_campaign e utm_content estão como dimensão personalizada nesta rede` : '',
    unlinked.size ? `${sum(unlinked)} linhas de sites sem rede ligada ignoradas (${usd(rev(unlinked))}): ${sites(unlinked)}. Ligue cada site a esta rede em Domínios` : '',
    otherNet.size ? `${sum(otherNet)} linhas de sites ligados a outra rede ignoradas (${usd(rev(otherNet))}): ${sites(otherNet)}. Se o site é desta rede, troque a rede em Domínios` : '',
  ].filter(Boolean).join(' · ');
  // URL é informativo (não deixa a rede amarela): sem caminho, a tela URLs mostra "(sem URL)"
  const urlNote = !pathKey && !urlDim && config.gamKeys.path
    ? `URLs: sem o key-value "${config.gamKeys.path}" como dimensão personalizada a receita fica em "(sem URL)". O site manda googletag.pubads().setTargeting('${config.gamKeys.path}', location.pathname)`
    : '';
  await setAccountStatus(net.id, warn ? 'warn' : 'ok', [warn, urlNote].filter(Boolean).join(' · ') || null);
  return { rows: rows.length, n, warn };
}

/** Todas as redes importadas, uma de cada vez. Erro numa rede não interrompe as outras. */
export async function runGam(w: { from: string; to: string }, isFinal = false): Promise<JobResult> {
  const nets = await q<{ id: string; external_id: string; name: string }>(`SELECT id::text, external_id, name FROM integration_accounts WHERE provider = 'gam' AND imported ORDER BY id`);
  if (!nets.length) return { status: 'skipped', message: 'nenhuma rede do Ad Manager marcada para importar' };
  let token: string;
  try { token = await googleAccessToken('gam'); } catch (e) {
    for (const n of nets) await setAccountStatus(n.id, statusFromError(e), (e as Error).message.slice(0, 300));
    if (e instanceof SyncError && (e.code === 'not_connected' || e.code === 'not_configured')) return { status: 'skipped', message: e.message };
    return { status: 'failed', message: (e as Error).message.slice(0, 500) };
  }
  const [idx, dom] = await Promise.all([attributionIndex(), domainResolver()]);
  const url = urlCache();
  const notes: string[] = [];
  let ok = 0, rowsTotal = 0, saved = 0;
  for (const net of nets) {
    try {
      const r = await runNetwork(net, token, w, isFinal, dom, idx, url);
      ok++; rowsTotal += r.rows; saved += r.n;
      if (r.warn) notes.push(`${net.name}: ${r.warn}`);
    } catch (e) {
      notes.push(`${net.name}: ${(e as Error).message}`);
      await setAccountStatus(net.id, statusFromError(e), (e as Error).message.slice(0, 300)).catch(() => {});
    }
  }
  if (!ok) return { status: 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${nets.length} redes · ${rowsTotal} linhas do relatório · ${saved} gravadas${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}

type Lost = Map<string, { rows: number; revenue: number }>;
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (m: Lost) => [...m.values()].reduce((a, x) => a + x.rows, 0);
const rev = (m: Lost) => [...m.values()].reduce((a, x) => a + x.revenue, 0);
/** Os 5 sites com mais receita descartada, para o admin saber onde mexer. */
const sites = (m: Lost) => { const l = [...m].sort((a, b) => b[1].revenue - a[1].revenue); return l.slice(0, 5).map(([h]) => h).join(', ') + (l.length > 5 ? ` e mais ${l.length - 5}` : ''); };

/** Redes em que a API recusou a dimensão URL_NAME (vale até reiniciar a api; aí tenta de novo uma vez). */
const URL_DIM_UNSUPPORTED = new Set<string>();
/** URL_NAME vem como "site.com/caminho", "https://site.com/caminho?x=1" ou "(not set)": devolve só o caminho. */
export function urlPath(v: string): string {
  if (!v || EMPTY.test(v)) return '';
  const u = parseUrl(/^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''));
  return u ? u.pathname : '';
}

/** utm_source gravado na linha (origem da receita na tela URLs): minúsculo, só [a-z0-9_.-], até 40. Vazio/macro → null. */
export function normSource(v: string): string | null {
  const x = v.trim().toLowerCase();
  if (!x || EMPTY.test(x) || /[{}]/.test(x)) return null;
  const c = x.replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return c || null;
}
