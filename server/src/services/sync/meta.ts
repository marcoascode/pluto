/**
 * Meta Ads (Marketing API).
 *  - estrutura: /act_{id}/ads com campanha, conjunto e o link do criativo (define domínio e URL de cada campanha)
 *  - métricas:  /act_{id}/insights level=ad, time_increment=1, breakdowns=country,
 *               em blocos de até 3 dias (CHUNKING, ver chunkWindow/fetchInsightsChunked)
 * Custo vai para USD pela taxa do dia; IVA = custo × alíquota (app_settings.meta_iva_rate, 13,83%).
 * Limite de uso da Meta: pausa 60 s e repete (metaGet). Consulta pesada: bloco → dias soltos → página menor (paginate).
 * Domínio de cada linha: manual → criativo → campanha → domínio único da conta (resolveDomain). Sem nenhum: domínio
 * técnico "Sem domínio" (só Admin vê) + aviso na conta.
 * Erro numa conta não interrompe as outras.
 */
import { config } from '../../config.js';
import { q } from '../../db.js';
import { addDays } from '../../lib/dates.js';
import { accountDomains, domainResolver, technicalDomainId, emptyFact, fxToUsd, metaIvaRate, parseUrl, replaceFacts, setAccountStatus, statusFromError, upsertAd, upsertAdGroup, upsertCampaign, urlCache, type Fact } from './common.js';
import { isMetaRateLimit, isMetaTooMuchData, requestJson, sleep, SyncError } from './http.js';
import { metaAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

const base = () => `${config.api.metaGraph}/${config.oauth.metaApiVersion}`;
/** account_status da Marketing API. Desativada/encerrada não entra no sync. */
const META_STATUS: Record<number, string> = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED' };
const META_INACTIVE = new Set([2, 100, 101, 202]);

/* =====================================================================================
 * Paginação com proteção contra os dois erros da Meta:
 *  - limite de uso (#4/#17/#32/#613/#80000/#80004, "too many calls to this ad-account"):
 *      PAUSA config.sync.metaRateLimitWaitMs (60 s) e repete a MESMA página, até metaRateLimitRetries vezes.
 *      O worker espera em vez de quebrar; só desiste da conta (neste ciclo) se o limite continuar.
 *  - "Please reduce the amount of data you're asking for": com `shrink`, corta o `limit` da página pela metade
 *      (500 → 250 → … → 25). Sem `shrink` (bloco de vários dias), sobe o erro para fetchInsights quebrar o bloco em dias.
 * ===================================================================================== */
const MIN_PAGE = 25;
/** GET na Graph API que PAUSA no limite de uso em vez de quebrar. */
async function metaGet<T>(url: string, label: string): Promise<T> {
  for (let waits = 0; ; waits++) {
    try {
      return await requestJson<T>(url, { timeoutMs: 120_000 });
    } catch (e) {
      if (!isMetaRateLimit(e) || waits >= config.sync.metaRateLimitRetries) throw e;
      console.warn(`[meta] ${label}: limite de uso da Meta, pausa ${Math.round(config.sync.metaRateLimitWaitMs / 1000)} s (${waits + 1}/${config.sync.metaRateLimitRetries})`);
      await sleep(config.sync.metaRateLimitWaitMs);
    }
  }
}
async function paginate<T>(firstUrl: string, label: string, shrink = true): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const current: string = url;
    try {
      const j: { data?: T[]; paging?: { next?: string } } = await metaGet(current, label);
      out.push(...(j.data ?? []));
      url = j.paging?.next ?? null;
    } catch (e) {
      if (shrink && isMetaTooMuchData(e)) {
        const u = new URL(current);
        const lim = Number(u.searchParams.get('limit') ?? 500);
        if (lim > MIN_PAGE) { u.searchParams.set('limit', String(Math.max(MIN_PAGE, Math.floor(lim / 2)))); url = u.toString(); continue; }
      }
      throw e;
    }
  }
  return out;
}

/* =====================================================================================
 * CHUNKING da janela de métricas.
 * level=ad × breakdowns=country × time_increment=1 explode em janelas longas (backfill de 30 dias) e a Meta
 * aborta por complexidade e reduz o limite da conta. Em vez de limitar o agendador (index.ts), a janela
 * w.from → w.to é fatiada aqui em blocos de no máximo config.sync.metaChunkDays (3) dias, do mais recente para
 * o mais antigo (D-0…D-2, D-3…D-5, …). Cada bloco é uma consulta paginada própria; os resultados são unidos
 * num array só e gravados de uma vez por conta (replaceFacts da janela inteira).
 * ===================================================================================== */
export function chunkWindow(w: { from: string; to: string }, days = config.sync.metaChunkDays): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let to = w.to; to >= w.from; to = addDays(to, -days)) {
    const from = addDays(to, -(days - 1));
    out.push({ from: from < w.from ? w.from : from, to });
  }
  return out;
}
const CHUNK_PAUSE_MS = 1_000;   // respiro entre blocos para não estourar o limite por rajada

interface InsightRow { date_start: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; ad_id: string; ad_name: string; country?: string; spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string }

/** Insights de UM bloco. Se a Meta ainda achar pesado, primeiro quebra o bloco em dias soltos; num dia só, diminui a página. */
async function fetchInsights(acc: Acc, token: string, range: { from: string; to: string }): Promise<InsightRow[]> {
  const url = `${base()}/act_${acc.external_id}/insights?${new URLSearchParams({
    level: 'ad', time_increment: '1', breakdowns: 'country', limit: '500', access_token: token,
    fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks',
    time_range: JSON.stringify({ since: range.from, until: range.to }),
  })}`;
  try {
    return await paginate<InsightRow>(url, `${acc.name} ${range.from}..${range.to}`, range.from === range.to);
  } catch (e) {
    if (isMetaTooMuchData(e) && range.from < range.to) {
      const out: InsightRow[] = [];
      for (const day of chunkWindow(range, 1)) { out.push(...(await fetchInsights(acc, token, day))); await sleep(CHUNK_PAUSE_MS); }
      return out;
    }
    throw e;
  }
}

/** Todos os blocos da janela, um por vez, unidos no array final. */
async function fetchInsightsChunked(acc: Acc, token: string, w: { from: string; to: string }) {
  const rows: InsightRow[] = [];
  const chunks = chunkWindow(w);
  for (const [i, ch] of chunks.entries()) {
    try {
      rows.push(...(await fetchInsights(acc, token, ch)));
    } catch (e) {
      // diz em qual bloco parou; nada desta conta é gravado (os dados antigos ficam) e o próximo ciclo tenta de novo
      const msg = `bloco ${ch.from}..${ch.to} (${i + 1}/${chunks.length}): ${(e as Error).message}`;
      throw e instanceof SyncError ? new SyncError(e.code, msg) : new Error(msg);
    }
    if (i < chunks.length - 1) await sleep(CHUNK_PAUSE_MS);
  }
  return { rows, chunks: chunks.length };
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

/** Atualiza campanhas/conjuntos/anúncios de uma conta. Devolve os mapas de ids externos → internos e o resolvedor de domínio. */
async function syncStructure(acc: Acc, token: string, dom: Awaited<ReturnType<typeof domainResolver>>) {
  const fields = 'id,name,effective_status,adset_id,adset{id,name,effective_status},campaign{id,name,effective_status},creative{link_url,template_url,object_story_spec,asset_feed_spec}';
  const ads = await paginate<MetaAd>(`${base()}/act_${acc.external_id}/ads?${new URLSearchParams({ fields, limit: '200', access_token: token })}`, `${acc.name} estrutura`);
  // fallback da conta: o ÚNICO domínio ligado a ela em domain_accounts (com 0 ou 2+ não dá para adivinhar)
  const linked = await accountDomains(acc.id);
  const accountDomain = linked.length === 1 ? linked[0] : null;
  // domínio da campanha = o mais comum entre os links dos anúncios dela; senão o domínio único da conta
  const votes = new Map<string, Map<string, number>>();
  for (const ad of ads) {
    const d = dom.byUrl(adLink(ad)); const cid = ad.campaign?.id;
    if (!d || !cid) continue;
    if (!votes.has(cid)) votes.set(cid, new Map());
    votes.get(cid)!.set(d.id, (votes.get(cid)!.get(d.id) ?? 0) + 1);
  }
  const campDomain = (cid: string) => { const v = votes.get(cid); if (v?.size) return [...v].sort((a, b) => b[1] - a[1])[0][0]; return accountDomain; };
  const camps = new Map<string, { id: string; domainId: string | null; manual: boolean }>(), groups = new Map<string, string>();
  const adsMap = new Map<string, { id: string; path: string | null; domainId: string | null }>();
  for (const ad of ads) {
    if (!ad.campaign) continue;
    let c = camps.get(ad.campaign.id);
    if (!c) { c = await upsertCampaign(acc.id, 'meta', ad.campaign.id, ad.campaign.name, ad.campaign.effective_status ?? 'ACTIVE', campDomain(ad.campaign.id)); camps.set(ad.campaign.id, c); }
    const gExt = ad.adset?.id ?? ad.adset_id ?? `${ad.campaign.id}-0`;
    let g = groups.get(gExt);
    if (!g) { g = await upsertAdGroup(c.id, gExt, ad.adset?.name ?? 'Conjunto', ad.adset?.effective_status); groups.set(gExt, g); }
    const link = adLink(ad);
    adsMap.set(ad.id, { id: await upsertAd(g, ad.id, ad.name, link, ad.effective_status), path: parseUrl(link)?.pathname ?? null, domainId: dom.byUrl(link)?.id ?? null });
  }
  /**
   * VALIDAÇÃO DE DOMÍNIO (ordem de tentativa) para cada linha de métrica:
   *  0. domínio definido MANUALMENTE na campanha (PATCH /admin/campaigns/:id) — vale sobre tudo
   *  1. domínio do link do próprio criativo (adLink → domínio cadastrado)
   *  2. domínio da campanha (voto dos anúncios, ou o que já está gravado em campaigns.domain_id)
   *  3. domínio único da conta em domain_accounts (conta recém-importada, campanha ainda sem domínio)
   * Só quando todas falham a linha vai para o domínio técnico "Sem domínio" (não é mais descartada).
   */
  const resolveDomain = (ad: { domainId: string | null } | undefined, camp: { domainId: string | null; manual: boolean }) =>
    (camp.manual ? camp.domainId : null) ?? ad?.domainId ?? camp.domainId ?? accountDomain;
  return { camps, groups, ads: adsMap, campDomain, resolveDomain };
}

export async function runMeta(kind: 'structure' | 'metrics', w: { from: string; to: string }): Promise<JobResult> {
  const token = await metaAccessToken();
  const accs = await q<Acc>(`SELECT id::text, external_id, name, currency FROM integration_accounts WHERE provider = 'meta' AND imported ORDER BY id`);
  let skippedInactive = 0;
  if (!accs.length) return { status: 'skipped', message: 'nenhuma conta Meta marcada para importar' };
  const dom = await domainResolver();
  const toUsd = kind === 'metrics' ? await fxToUsd(w.from, w.to) : null;
  const iva = await metaIvaRate();
  const url = urlCache();
  const tech = kind === 'metrics' ? await technicalDomainId() : null;
  const notes: string[] = [];
  let ok = 0, rowsTotal = 0;
  for (const acc of accs) {
    try {
      const info = await metaGet<{ currency?: string; timezone_name?: string; account_status?: number }>(`${base()}/act_${acc.external_id}?${new URLSearchParams({ fields: 'name,currency,timezone_name,account_status', access_token: token })}`, acc.name);
      if (info.currency && ['USD', 'BRL', 'EUR'].includes(info.currency)) acc.currency = info.currency;
      const pst = META_STATUS[info.account_status ?? 1] ?? `STATUS_${info.account_status}`;
      await q('UPDATE integration_accounts SET currency = $2, timezone = COALESCE($3, timezone), platform_status = $4 WHERE id = $1', [acc.id, acc.currency, info.timezone_name ?? null, pst]);
      // conta desativada/encerrada na Meta: não busca dados (as outras seguem normalmente)
      if (META_INACTIVE.has(info.account_status ?? 1)) { skippedInactive++; await setAccountStatus(acc.id, 'ok', `Conta ${pst} na Meta: fora do sync`); continue; }
      const st = await syncStructure(acc, token, dom);
      if (kind === 'structure') { await setAccountStatus(acc.id, 'ok', null); ok++; continue; }

      // ---- métricas em blocos de até 3 dias (chunking) ----
      const { rows, chunks } = await fetchInsightsChunked(acc, token, w);
      const facts: Fact[] = [];
      const lost = { rows: 0, spendUsd: 0, clicks: 0, impressions: 0, campaigns: new Map<string, number>() };
      for (const r of rows) {
        // anúncio novo que a estrutura ainda não viu (ex.: criado agora)
        let c = st.camps.get(r.campaign_id);
        if (!c) { c = await upsertCampaign(acc.id, 'meta', r.campaign_id, r.campaign_name, 'ACTIVE', st.campDomain(r.campaign_id)); st.camps.set(r.campaign_id, c); }
        let g = st.groups.get(r.adset_id);
        if (!g) { g = await upsertAdGroup(c.id, r.adset_id, r.adset_name); st.groups.set(r.adset_id, g); }
        let a = st.ads.get(r.ad_id);
        if (!a) { a = { id: await upsertAd(g, r.ad_id, r.ad_name), path: null, domainId: null }; st.ads.set(r.ad_id, a); }
        const spendUsd = toUsd!(Number(r.spend ?? 0), acc.currency, r.date_start);
        const clicks = Number(r.inline_link_clicks ?? r.clicks ?? 0);
        // manual → criativo → campanha → domínio único da conta (ver resolveDomain)
        const resolved = st.resolveDomain(a, c);
        if (!resolved) {
          // sem domínio identificável (ex.: campanha de mensagens/chatbot): grava no domínio técnico "Sem domínio"
          // para o custo e o IVA não sumirem, e soma para o aviso da conta
          lost.rows++; lost.spendUsd += spendUsd; lost.clicks += clicks; lost.impressions += Number(r.impressions ?? 0);
          lost.campaigns.set(r.campaign_name, (lost.campaigns.get(r.campaign_name) ?? 0) + spendUsd);
        }
        const domainId = resolved ?? tech!;
        facts.push(emptyFact({
          date: r.date_start, domainId, urlId: resolved && a.domainId === resolved ? await url(resolved, a.path) : null, platform: 'meta',
          campaignId: c.id, adGroupId: g, adId: a.id, country: (r.country ?? 'ZZ').toUpperCase(),
          spendUsd, ivaUsd: spendUsd * iva, trafficImpressions: Number(r.impressions ?? 0), trafficClicks: clicks,
        }));
      }
      const scope = (await q<{ id: string }>('SELECT id::text FROM campaigns WHERE account_id = $1', [acc.id])).map((x) => x.id);
      rowsTotal += await replaceFacts('meta', w.from, w.to, scope, facts);
      const msg = lost.rows ? lostMessage(lost) : null;
      if (msg) notes.push(`${acc.name}: ${msg}`);
      if (chunks > 1) console.info(`[meta] ${acc.name}: ${w.from}..${w.to} em ${chunks} blocos · ${rows.length} linhas`);
      await setAccountStatus(acc.id, msg ? 'warn' : 'ok', msg);
      ok++;
    } catch (e) {
      notes.push(`${acc.name}: ${(e as Error).message}`);
      await setAccountStatus(acc.id, statusFromError(e), (e as Error).message.slice(0, 300)).catch(() => {});
      // segue para a próxima conta: um erro numa conta não interrompe as outras
    }
  }
  if (skippedInactive) notes.push(`${skippedInactive} conta(s) inativa(s) na Meta ignorada(s)`);
  if (!ok) return { status: skippedInactive === accs.length ? 'skipped' : 'failed', message: notes.join(' · ').slice(0, 500) };
  return { status: 'success', message: `${ok}/${accs.length - skippedInactive} contas · ${kind === 'structure' ? 'estrutura atualizada' : rowsTotal + ' linhas'}${notes.length ? ' · ' + notes.join(' · ') : ''}`.slice(0, 500) };
}

const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Aviso da conta: quanto ficou de fora e em quais campanhas (as 3 de maior custo). */
function lostMessage(l: { rows: number; spendUsd: number; clicks: number; campaigns: Map<string, number> }) {
  const top = [...l.campaigns].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  const more = l.campaigns.size > 3 ? ` e mais ${l.campaigns.size - 3}` : '';
  return `${l.rows} linhas sem domínio gravadas em "Sem domínio" (${usd(l.spendUsd)} de custo · ${l.clicks} cliques) em ${top.join(', ')}${more}. `
    + 'Defina o domínio dessas campanhas em Integrações → Meta Ads ("Campanhas sem domínio") ou na tela Meta Ads';
}
