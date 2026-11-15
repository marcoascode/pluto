/**
 * Google Ad Manager (Ad Manager API v1, REST).
 * Relatório HISTORICAL em USD: DATE × SITE × COUNTRY_CODE × key-values
 *   métricas REVENUE, IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, CLICKS, ACTIVE_VIEW_VIEWABLE_IMPRESSIONS.
 * Dois jeitos de ler os key-values (escolhido por rede, veja attributionMode()):
 *   keyvalues  — SEM dimensão personalizada: o key utm_content só precisa de "Incluir valores nos relatórios"
 *                (Report on values = ON, igual à Publeno; sem o limite de valores da dimensão personalizada).
 *                Usa a dimensão nativa "Key-values" (KEY_VALUES_NAME = "utm_content=<valor>") num 2º relatório;
 *                a campanha sai só do utm_content. O que sobra do total do site fica "não atribuído".
 *   dimension  — utm_campaign e utm_content como dimensão personalizada (CUSTOM_DIMENSION_n_VALUE), como antes.
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
import { retentionChannel } from '../metrics.js';
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

/** reportable: "Report on values" do key no Ad Manager. ON = incluir valores nos relatórios; CUSTOM_DIMENSION = dimensão personalizada. */
export interface KeyInfo { role: 'campaign' | 'content' | 'source' | 'path' | 'placement'; adTagName: string; id: string | null; usable: boolean; reportable: string | null;
  /** 0.16: pedir como dimensão de Key-values aprimorada (EKV_DIMENSION_n_VALUE) em vez de dimensão personalizada */
  ekv?: boolean }

/** Procura os ids dos key-values pelo nome usado na tag (adTagName). usable = está como "Custom dimension" (CUSTOM_DIMENSION_n). */
export async function resolveKeys(network: string, token: string, wanted: [KeyInfo['role'], string][] = Object.entries(config.gamKeys).filter(([, v]) => v) as [KeyInfo['role'], string][]): Promise<KeyInfo[]> {
  const out: KeyInfo[] = [];
  for (const [role, name] of wanted) {
    type KeysResp = { customTargetingKeys?: { customTargetingKeyId?: string; name?: string; adTagName?: string; reportableType?: string }[] };
    const u = `${config.api.gam}/v1/networks/${network}/customTargetingKeys?${new URLSearchParams({ filter: `adTagName = "${name}"`, pageSize: '5' })}`;
    let j: KeysResp;
    try { j = await requestJson<KeysResp>(u, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) {
      if (e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code)) throw e;
      // 0.15.2: a busca filtrada falhou ("An error has occurred."): lista os keys sem filtro e procura aqui
      logGam({ network, step: 'customTargetingKeys', key: name, message: (e as Error).message, body: e instanceof SyncError ? e.body ?? null : null });
      try {
        j = await requestJson<KeysResp>(`${config.api.gam}/v1/networks/${network}/customTargetingKeys?pageSize=1000`, { headers: { Authorization: `Bearer ${token}` } });
        j = { customTargetingKeys: (j.customTargetingKeys ?? []).filter((x) => x.adTagName === name) };
      } catch (e2) {
        throw new SyncError(e2 instanceof SyncError ? e2.code : 'api', `Ad Manager (lista de key-values, ${name}): ${(e2 as Error).message}`, e2 instanceof SyncError ? e2.http : undefined, e2 instanceof SyncError ? e2.body : undefined);
      }
    }
    const k = j.customTargetingKeys?.find((x) => x.adTagName === name) ?? j.customTargetingKeys?.[0];
    const id = k?.customTargetingKeyId ?? k?.name?.split('/').pop() ?? null;
    out.push({ role, adTagName: name, id, usable: !!id && k?.reportableType === 'CUSTOM_DIMENSION', reportable: id ? k?.reportableType ?? null : null });
  }
  return out;
}

/** Cria o relatório (oculto), roda, espera e baixa todas as linhas. */
/** extra: dimensões nativas a mais depois de COUNTRY_CODE (ex.: URL_NAME). As dimensões personalizadas vêm depois delas.
 *  kvKey: acrescenta por último a dimensão nativa KEY_VALUES_NAME ("key=valor"), filtrada só para esse key
 *  (funciona com "Incluir valores nos relatórios", sem dimensão personalizada). */
/** Log da api (docker compose logs api): uma linha JSON por falha de relatório do Ad Manager, com a resposta da API. */
function logGam(ev: Record<string, unknown>) {
  console.error(`[gam] ${JSON.stringify({ at: new Date().toISOString(), ...ev })}`);
}
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const spanDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;
type ReportRows = { dimensionValues: Val[]; metricValueGroups: { primaryValues: Val[] }[] }[];

/**
 * Relatório do Ad Manager com tolerância a falha (0.15.2). O Ad Manager às vezes devolve só "An error has occurred."
 * (HTTP 500 INTERNAL) para relatórios grandes (30 dias × site × país × URL/key-values). Então:
 *   1. tenta o período inteiro;
 *   2. se falhar (erro da API, não de login/permissão), divide o período ao meio e tenta cada metade, até 1 dia;
 *   3. cada falha vai para o log da api com a rede, o relatório, a etapa e a resposta da API.
 * A mensagem final diz em que etapa e em que dia falhou, para a tela de Integrações.
 */
export async function runReport(network: string, token: string, from: string, to: string, keys: KeyInfo[], label = 'pluto-sync', extra: string[] = [], kvKey?: string, layout: Layout = FULL): Promise<{ rows: ReportRows; dims: string[] }> {
  try {
    return await runReportOnce(network, token, from, to, keys, label, extra, kvKey, layout);
  } catch (e) {
    const se = e instanceof SyncError ? e : null;
    logGam({ network, report: label, from, to, kvKey: kvKey ?? null, extra, customKeys: keys.map((k) => k.adTagName), layout: layout === FULL ? undefined : layout, code: se?.code ?? 'erro', http: se?.http ?? null, message: (e as Error).message, body: se?.body ?? null });
    if (se && (se.code === 'token' || se.code === 'permission' || se.code === 'not_connected')) throw e;
    // 4xx (INVALID_ARGUMENT…) é o pedido que está errado: repetir em pedaços não muda nada
    if (se?.http && se.http >= 400 && se.http < 500) throw e;
    const days = spanDays(from, to);
    if (days <= 1) throw e;
    // falha do relatório inteiro: se nem 1 dia funciona, o problema não é tamanho (repetir em pedaços só atrasaria)
    try { await runReportOnce(network, token, to, to, keys, label, extra, kvKey, layout); } catch (e2) {
      logGam({ network, report: label, from: to, to, probe: true, message: (e2 as Error).message, body: e2 instanceof SyncError ? e2.body ?? null : null });
      throw e;
    }
    const half = Math.floor(days / 2);
    const mid = addDays(from, half - 1);
    const a = await runReport(network, token, from, mid, keys, label, extra, kvKey, layout);
    const b = await runReport(network, token, addDays(mid, 1), to, keys, label, extra, kvKey, layout);
    return { rows: [...a.rows, ...b.rows], dims: a.dims };
  }
}

/**
 * 0.15.3 · Formato do relatório. O Ad Manager recusa algumas combinações com a dimensão Key-values
 * (REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY, "An error has occurred.") e a regra muda por rede. Então o relatório de
 * Key-values tenta, nesta ordem, até um ser aceito (e a rede guarda o que funcionou):
 *   site + país + 6 métricas → site + país + receita/impressões/cliques → site + 6 → site + 3 → país + 3 → só 3 → sem filtro.
 * Sem site ou sem país, cada valor é distribuído entre os sites/países do relatório-base do mesmo dia pela proporção
 * de cada um (estimativa; o total do dia é exato). Linhas sempre voltam no formato DATE, SITE, COUNTRY_CODE, …
 */
/** metrics: full = as 6 de sempre · core = receita/impressões/cliques totais · adx = as mesmas só do Ad Exchange */
/** unit = AD_UNIT_ID no lugar de SITE (0.17.1): o Ad Manager aceita Key-values com bloco de anúncios em redes que
 *  recusam com SITE; o bloco vira site por um relatório DATE × SITE × AD_UNIT_ID × país (sem key-values). */
export interface Layout { site: boolean; country: boolean; core: boolean; filter: boolean; adx?: boolean; unit?: boolean }
const FULL: Layout = { site: true, country: true, core: false, filter: true };
// 0.15.4: nas 5 redes do log de 06/11 TODOS os formatos com as métricas totais foram recusados; entram os de Ad Exchange
export const KV_LAYOUTS: Layout[] = [
  FULL,
  { site: true, country: true, core: true, filter: true },
  { site: true, country: true, core: true, filter: true, adx: true },
  { site: true, country: false, core: true, filter: true, adx: true },
  // 0.17.1: bloco de anúncios no lugar do site (convertido para site depois, sem estimar entre sites)
  { site: false, unit: true, country: true, core: true, filter: true },
  { site: false, unit: true, country: true, core: true, filter: true, adx: true },
  { site: false, unit: true, country: false, core: true, filter: true, adx: true },
  { site: false, country: true, core: true, filter: true },
  { site: false, country: true, core: true, filter: true, adx: true },
  { site: false, country: false, core: true, filter: false, adx: true },
];
const KV_LAYOUT_OK = new Map<string, number>();   // rede|key → formato aceito (até reiniciar a api)
/** rede|key → quando todos os formatos foram recusados. Não tenta de novo por 12 h (evita ~30 chamadas e linhas de log por sync). */
const KV_REFUSED = new Map<string, number>();
const KV_RETRY_MS = 12 * 3600_000;
/** rede → quando o relatório com Key-values aprimorados (EKV) foi recusado (key não marcado como EKV) */
const EKV_REFUSED = new Map<string, number>();
export const ekvRefused = (net: string) => EKV_REFUSED_UNTIL(net) > 0;
const EKV_REFUSED_UNTIL = (net: string) => { const t = EKV_REFUSED.get(net); return t && Date.now() - t < KV_RETRY_MS ? t + KV_RETRY_MS : 0; };
/** 0.17.1 · rede → keys aceitos como EKV quando nem todos foram (ex.: utm_source marcado e page_path não). 12 h, depois testa todos de novo. */
const EKV_PARTIAL = new Map<string, { roles: string[]; at: number }>();
/** Erro de "esta rede não aceita relatório por Key-values": a solução é configuração no Ad Manager, não código. */
export class KvUnsupported extends SyncError {
  constructor(public key: string, until: number) {
    super('kv_unsupported', `o Ad Manager desta rede recusa relatório pelo key "${key}" só com "Incluir valores nos relatórios" (REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY em todos os formatos). Marque o key como "Key-values aprimorados" (Enhanced key-values: até 100.000 valores) nesta rede. Nova tentativa ${new Date(until).toISOString().slice(11, 16)} UTC`);
  }
}
export const ALL = '__ALL__';
const isConstraint = (e: unknown) => e instanceof SyncError && e.http === 400 && /CONSTRAINTS_INCOMPATIBILITY|INVALID_ARGUMENT|invalid as specified/i.test(`${e.body ?? ''} ${e.message}`);

/** Relatório de Key-values com o primeiro formato que o Ad Manager aceitar nesta rede. */
export async function runKvReport(network: string, token: string, from: string, to: string, keys: KeyInfo[], label: string, extra: string[], kvKey: string) {
  const ck = `${network}|${kvKey}|${extra.join(',')}|${keys.length}`;
  const refused = KV_REFUSED.get(`${network}|${kvKey}`);
  if (refused && Date.now() - refused < KV_RETRY_MS) throw new KvUnsupported(kvKey, refused + KV_RETRY_MS);
  for (let i = KV_LAYOUT_OK.get(ck) ?? 0; i < KV_LAYOUTS.length; i++) {
    try {
      const r = await runReportOnce(network, token, from, to, keys, label, extra, kvKey, KV_LAYOUTS[i]).catch(async (e) => {
        if (isConstraint(e)) throw e;
        return runReport(network, token, from, to, keys, label, extra, kvKey, KV_LAYOUTS[i]);   // erro de outro tipo: com as tentativas normais
      });
      if (KV_LAYOUT_OK.get(ck) !== i) { KV_LAYOUT_OK.set(ck, i); if (i) logGam({ network, report: label, kvKey, accepted: KV_LAYOUTS[i] }); }
      KV_REFUSED.delete(`${network}|${kvKey}`);
      return { rows: r.rows, layout: KV_LAYOUTS[i] };
    } catch (e) { if (!isConstraint(e)) throw e; }
  }
  // todos recusados: uma linha de log (não uma por formato) e pausa de 12 h para este key nesta rede
  const now = Date.now();
  KV_REFUSED.set(`${network}|${kvKey}`, now);
  KV_LAYOUT_OK.delete(ck);
  logGam({ network, report: label, kvKey, refusedAllFormats: KV_LAYOUTS.length, nextTry: new Date(now + KV_RETRY_MS).toISOString(), fix: `marcar ${kvKey} como Key-values aprimorados (EKV) nesta rede` });
  throw new KvUnsupported(kvKey, now + KV_RETRY_MS);
}

/**
 * Linhas de um relatório sem site e/ou sem país → linhas por site e país, repartindo cada métrica pela proporção
 * do relatório-base (mesmo dia; e mesmo site/país quando o relatório os tem). Sem base no dia, a linha é descartada.
 */
export function spreadByBase(rows: ReportRows, base: ReportRows): ReportRows {
  const agg = new Map<string, { site: Val; country: Val; m: number[] }>();
  const byDay = new Map<string, string[]>();
  for (const r of base) {
    const d = r.dimensionValues;
    const k = `${str(d[0])}|${str(d[1])}|${str(d[2])}`;
    let x = agg.get(k);
    if (!x) { x = { site: d[1], country: d[2], m: [0, 0, 0, 0, 0, 0] }; agg.set(k, x); byDay.set(str(d[0]), [...(byDay.get(str(d[0])) ?? []), k]); }
    const mv = r.metricValueGroups?.[0]?.primaryValues ?? [];
    for (let i = 0; i < 6; i++) x.m[i] += num(mv[i]);
  }
  const out: ReportRows = [];
  for (const r of rows) {
    const d = r.dimensionValues;
    const site = str(d[1]), country = str(d[2]);
    if (site !== ALL && country !== ALL) { out.push(r); continue; }
    const keys = (byDay.get(str(d[0])) ?? []).filter((k) => { const [, s2, c2] = k.split('|'); return (site === ALL || s2 === site) && (country === ALL || c2 === country); });
    if (!keys.length) continue;
    const mv = (r.metricValueGroups?.[0]?.primaryValues ?? []).map(num);
    const tot = [0, 1, 2, 3, 4, 5].map((i) => keys.reduce((a, k) => a + agg.get(k)!.m[i], 0));
    for (const k of keys) {
      const b = agg.get(k)!;
      const share = (i: number) => (tot[i] > 0 ? b.m[i] / tot[i] : tot[0] > 0 ? b.m[0] / tot[0] : 1 / keys.length);
      out.push({ dimensionValues: [d[0], b.site, b.country, ...d.slice(3)], metricValueGroups: [{ primaryValues: mv.map((v, i) => ({ doubleValue: v * share(i) }) as Val) }] });
    }
  }
  return out;
}

/**
 * 0.17.1 · Linhas de Key-values por bloco de anúncios (AD_UNIT_ID na posição do site) → linhas por site e país, pelo
 * mapa DATE × SITE × país × bloco (mesmo dia; mesmo país quando a linha tem país). Bloco usado por um site só (o normal)
 * = valor exato. Bloco sem par no mapa: a linha sai e é contada em `lost`.
 */
export function unitsToSites(rows: ReportRows, map: ReportRows, lost: { rows: number; revenue: number }): ReportRows {
  const by = new Map<string, { site: Val; country: Val; m: number[] }[]>();
  for (const r of map) {
    const d = r.dimensionValues;
    const k = `${str(d[0])}|${str(d[3])}`;
    const mv = (r.metricValueGroups?.[0]?.primaryValues ?? []).map(num);
    const list = by.get(k) ?? [];
    const hit = list.find((x) => str(x.site) === str(d[1]) && str(x.country) === str(d[2]));
    if (hit) for (let i = 0; i < 6; i++) hit.m[i] += mv[i] ?? 0; else list.push({ site: d[1], country: d[2], m: [0, 1, 2, 3, 4, 5].map((i) => mv[i] ?? 0) });
    by.set(k, list);
  }
  const out: ReportRows = [];
  for (const r of rows) {
    const d = r.dimensionValues;
    const country = str(d[2]);
    const cands = (by.get(`${str(d[0])}|${str(d[1])}`) ?? []).filter((x) => country === ALL || str(x.country) === country);
    const mv = (r.metricValueGroups?.[0]?.primaryValues ?? []).map(num);
    if (!cands.length) { lost.rows++; lost.revenue += mv[0] ?? 0; continue; }
    const tot = [0, 1, 2, 3, 4, 5].map((i) => cands.reduce((a, x) => a + x.m[i], 0));
    for (const x of cands) {
      const share = (i: number) => (tot[i] > 0 ? x.m[i] / tot[i] : tot[0] > 0 ? x.m[0] / tot[0] : 1 / cands.length);
      out.push({ dimensionValues: [d[0], x.site, country === ALL ? x.country : d[2], ...d.slice(3)], metricValueGroups: [{ primaryValues: mv.map((v, i) => ({ doubleValue: v * share(i) }) as Val) }] });
    }
  }
  return out;
}

/** 0.17.1 · Mapa bloco de anúncios → site (DATE × SITE × país × AD_UNIT_ID, sem key-values). Vazio se a rede recusar. */
export async function fetchUnitMap(network: string, token: string, from: string, to: string): Promise<ReportRows> {
  for (const lay of [{ site: true, unit: true, country: true, core: true, filter: false }, { site: true, unit: true, country: true, core: true, filter: false, adx: true }] as Layout[]) {
    try { return (await runReport(network, token, from, to, [], 'pluto-sync-units', [], undefined, lay)).rows; } catch (e) {
      if (e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code)) throw e;
    }
  }
  return [];
}

/** Sites com receita em cada dia do relatório-base. */
const sitesByDay = (base: ReportRows) => {
  const m = new Map<string, Set<string>>();
  for (const r of base) { const d = r.dimensionValues; const s = m.get(str(d[0])) ?? new Set(); s.add(str(d[1])); m.set(str(d[0]), s); }
  return m;
};

async function runReportOnce(network: string, token: string, from: string, to: string, keys: KeyInfo[], label: string, extra: string[], kvKey?: string, layout: Layout = FULL) {
  const auth = { Authorization: `Bearer ${token}` };
  // dimensão personalizada (CUSTOM_DIMENSION_n) ou Key-values aprimorada (EKV_DIMENSION_n), na ordem de keys
  let ci = 0, ei = 0;
  const keyDims = keys.map((k) => (k.ekv ? `EKV_DIMENSION_${ei++}_VALUE` : `CUSTOM_DIMENSION_${ci++}_VALUE`));
  const cdIds = keys.filter((k) => !k.ekv).map((k) => k.id), ekvIds = keys.filter((k) => k.ekv).map((k) => k.id);
  const dims = ['DATE', ...(layout.site ? ['SITE'] : []), ...(layout.unit ? ['AD_UNIT_ID'] : []), ...(layout.country ? ['COUNTRY_CODE'] : []), ...extra, ...keyDims, ...(kvKey ? ['KEY_VALUES_NAME'] : [])];
  const metrics = layout.adx ? ['AD_EXCHANGE_REVENUE', 'AD_EXCHANGE_IMPRESSIONS', 'AD_EXCHANGE_CLICKS']
    : layout.core ? ['REVENUE', 'IMPRESSIONS', 'CLICKS'] : ['REVENUE', 'IMPRESSIONS', 'AD_REQUESTS', 'RESPONSES_SERVED', 'CLICKS', 'ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'];
  // etapa em que falhou vai na mensagem: "criar relatório", "rodar relatório", "aguardar relatório", "baixar linhas"
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      const se = e instanceof SyncError ? e : null;
      throw new SyncError(se?.code ?? 'api', `Ad Manager (${label}, ${name}, ${from === to ? from : `${from} a ${to}`}): ${(e as Error).message}`, se?.http, se?.body);
    }
  };
  const report = await step('criar relatório', () => requestJson<{ name: string }>(`${config.api.gam}/v1/networks/${network}/reports`, {
    method: 'POST', headers: auth,
    body: {
      displayName: `${label} ${from}..${to} ${new Date().toISOString()}`,
      visibility: 'HIDDEN',
      reportDefinition: {
        dimensions: dims, metrics, reportType: 'HISTORICAL', currencyCode: 'USD',
        dateRange: { fixed: { startDate: date(from), endDate: date(to) } },
        ...(cdIds.length ? { customDimensionKeyIds: cdIds } : {}),
        ...(ekvIds.length ? { ekvDimensionKeyIds: ekvIds } : {}),
        // só as linhas do key pedido; o prefixo exato "key=" é conferido de novo em kvValue()
        ...(kvKey && layout.filter ? { filters: [{ fieldFilter: { field: { dimension: 'KEY_VALUES_NAME' }, operation: 'CONTAINS', values: [{ stringValue: `${kvKey}=` }] } }] } : {}),
      },
    },
  }));
  const op = await step('rodar relatório', () => requestJson<{ name: string }>(`${config.api.gam}/v1/${report.name}:run`, { method: 'POST', headers: auth, body: {} }));
  // espera: 5 s e vai aumentando (máx. ~10 min)
  let result: string | null = null;
  for (let i = 0, wait = 5_000; i < 40; i++, wait = Math.min(wait * 1.5, 30_000)) {
    const o = await step('aguardar relatório', () => requestJson<{ done?: boolean; error?: { message?: string; code?: number }; response?: { reportResult?: string } }>(`${config.api.gam}/v1/${op.name}`, { headers: auth }));
    if (o.error) throw new SyncError('api', `Ad Manager (${label}, relatório recusado, ${from} a ${to}): ${o.error.message ?? 'sem mensagem'}${o.error.code != null ? ` (código ${o.error.code})` : ''}`, undefined, JSON.stringify(o.error).slice(0, 1500));
    if (o.done) { result = o.response?.reportResult ?? null; break; }
    await sleep(wait);
  }
  if (!result) throw new SyncError('api', `Ad Manager (${label}): o relatório demorou demais. Nova tentativa no próximo ciclo.`);
  const rows: ReportRows = [];
  let pageToken: string | undefined;
  let pageSize = 10000;
  do {
    let j: { rows?: ReportRows; nextPageToken?: string };
    try {
      j = await step('baixar linhas', () => requestJson<{ rows?: ReportRows; nextPageToken?: string }>(`${config.api.gam}/v1/${result}:fetchRows?${new URLSearchParams({ pageSize: String(pageSize), ...(pageToken ? { pageToken } : {}) })}`, { headers: auth, timeoutMs: 120_000 }));
    } catch (e) {
      if (pageSize <= 1000) throw e;
      pageSize = 1000;   // página grande demais: tenta de novo a mesma página, menor
      continue;
    }
    rows.push(...(j.rows ?? []));
    pageToken = j.nextPageToken || undefined;
  } while (pageToken);
  // formato reduzido → volta ao padrão DATE, SITE, COUNTRY_CODE, … e 6 métricas (as que faltam = 0)
  if (layout !== FULL) {
    for (const r of rows) {
      const d = r.dimensionValues;
      // unit sem site: o bloco ocupa a posição do site · site + unit (mapa bloco → site): o bloco vai logo depois do país
      const nLead = (layout.site ? 1 : 0) + (layout.unit ? 1 : 0);
      const rest = d.slice(1 + nLead + (layout.country ? 1 : 0));
      const unitVal = layout.unit ? d[layout.site ? 2 : 1] : null;
      const countryVal = layout.country ? d[1 + nLead] : { stringValue: ALL };
      r.dimensionValues = layout.site && layout.unit ? [d[0], d[1], countryVal, unitVal!, ...rest]
        : [d[0], layout.site ? d[1] : layout.unit ? unitVal! : { stringValue: ALL }, countryVal, ...rest];
      if (layout.core) { const m = r.metricValueGroups?.[0]?.primaryValues ?? []; r.metricValueGroups = [{ primaryValues: [m[0], m[1], { intValue: '0' }, { intValue: '0' }, m[2], { intValue: '0' }] as Val[] }]; }
    }
  }
  return { rows, dims };
}

/** Índices de campanha/grupo/anúncio por id externo (Google e Meta). */
export async function attributionIndex() {
  const camps = await q<{ id: string; ext: string; platform: 'google' | 'meta'; domain_id: string | null }>('SELECT id::text, external_id AS ext, platform, domain_id::text FROM campaigns');
  const groups = await q<{ id: string; ext: string; cid: string }>('SELECT id::text, external_id AS ext, campaign_id::text AS cid FROM ad_groups');
  const ads = await q<{ id: string; ext: string; gid: string }>('SELECT id::text, external_id AS ext, ad_group_id::text AS gid FROM ads');
  // formato do dash antigo: o ID do anúncio sozinho → anúncio, grupo e campanha.
  //   Google Ads: utm_campaign={creative}   · 0.16.1 Meta: utm_campaign={{ad.id}} (utm_content={{ad.id}}_{{placement}})
  // Só entra ID que aparece uma vez (se o mesmo ID existir em dois lugares, não adivinha).
  const gAds = await q<{ id: string; ext: string; gid: string; cid: string; platform: 'google' | 'meta' }>(`
    SELECT a.id::text, a.external_id AS ext, a.ad_group_id::text AS gid, g.campaign_id::text AS cid, c.platform
      FROM ads a JOIN ad_groups g ON g.id = a.ad_group_id JOIN campaigns c ON c.id = g.campaign_id`);
  const seen = new Map<string, number>();
  for (const a of gAds) seen.set(a.ext, (seen.get(a.ext) ?? 0) + 1);
  // modo keyvalues (só utm_content): {adgroupid} / {{adset.id}} sozinho → grupo e campanha (também só ID único)
  const campById = new Map(camps.map((c) => [c.id, c]));
  const gSeen = new Map<string, number>();
  for (const g of groups) gSeen.set(g.ext, (gSeen.get(g.ext) ?? 0) + 1);
  return {
    camp: new Map(camps.map((c) => [c.ext, c])),
    group: new Map(groups.map((g) => [`${g.cid}|${g.ext}`, g.id])),
    ad: new Map(ads.map((a) => [`${a.gid}|${a.ext}`, a.id])),
    creative: new Map(gAds.filter((a) => seen.get(a.ext) === 1).map((a) => [a.ext, a])),
    groupExt: new Map(groups.filter((g) => gSeen.get(g.ext) === 1 && campById.has(g.cid)).map((g) => [g.ext, { id: g.id, cid: g.cid, platform: campById.get(g.cid)!.platform }])),
  };
}

type Resolver = Awaited<ReturnType<typeof domainResolver>>;
type Index = Awaited<ReturnType<typeof attributionIndex>>;

/** Formato do dash antigo (Google Ads): utm_campaign={creative} e utm_content={creative}_{placement}. */
export const isLegacyUtm = (campVal: string, content: string) => !!campVal && (content === campVal || content.startsWith(`${campVal}_`));

/**
 * Campanha, grupo e anúncio de uma linha do Ad Manager, nos dois formatos de UTM:
 *   padrão do dash ........ utm_campaign={campaignid}   utm_content={adgroupid}_{creative}   (Meta: {{campaign.id}} / {{adset.id}}_{{ad.id}})
 *   formato do dash antigo  utm_campaign={creative}     utm_content={creative}_{placement}   (Meta: {{ad.id}} / {{ad.id}}_{{placement}})
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
  if (cr) return { platform: cr.platform, campaignId: cr.cid, adGroupId: cr.gid, adId: cr.id };
  if (legacy) return { reason: source && /^(fb|facebook|ig|instagram|an|msg|meta)$/.test(source) ? 'meta_ad_not_found' : 'gads_creative_not_found' };
  return { reason: source && /^(fb|facebook|ig|instagram|an|msg|meta)$/.test(source) ? 'meta_ad_not_found' : 'campaign_not_found' };
}

/**
 * Atribuição só pelo utm_content (modo keyvalues: um key por linha do relatório, sem o utm_campaign junto).
 *   formato do dash antigo  {creative}_{placement}      → o {creative} é o anúncio do Google Ads → grupo → campanha
 *   padrão do dash          {adgroupid}_{creative}       → grupo → campanha (anúncio pelo 2º pedaço)
 *   Meta                    {{adset.id}}_{{ad.id}}       → conjunto → campanha
 * Valor cortado pelo Ad Manager continua funcionando: só o 1º pedaço (antes do "_") é usado para achar a campanha.
 */
export function attributeContent(idx: Index, content: string):
  { platform: 'google' | 'meta'; campaignId: string; adGroupId: string | null; adId: string | null; placement: string } | { reason: string } {
  const i = content.indexOf('_');
  const head = (i < 0 ? content : content.slice(0, i)).trim();
  const tail = i < 0 ? '' : content.slice(i + 1).trim();
  if (!head || EMPTY.test(head)) return { reason: 'missing_campaign_id' };
  const cr = idx.creative.get(head);
  if (cr) return { platform: cr.platform, campaignId: cr.cid, adGroupId: cr.gid, adId: cr.id, placement: tail };
  const g = idx.groupExt.get(head);
  if (g) return { platform: g.platform, campaignId: g.cid, adGroupId: g.id, adId: tail && !EMPTY.test(tail) ? idx.ad.get(`${g.id}|${tail}`) ?? null : null, placement: '' };
  return { reason: 'gads_creative_not_found' };
}

/** "utm_content=123_site.com" → "123_site.com" (só se o key bater; o filtro CONTAINS do relatório pode trazer outro key parecido). */
export function kvValue(raw: string, key: string): string | null {
  const s = raw.trim();
  return s.toLowerCase().startsWith(`${key.toLowerCase()}=`) ? s.slice(key.length + 1).trim() : null;
}

/**
 * Como ler os key-values nesta rede (GAM_ATTRIBUTION = auto | keyvalues | dimension; padrão auto):
 *   auto: utm_campaign e utm_content como dimensão personalizada → dimension; senão, utm_content com
 *         "Incluir valores nos relatórios" (ou dimensão) → keyvalues; senão → dimension (vira gam_kv_not_configured).
 */
export function attributionMode(all: KeyInfo[]): 'dimension' | 'keyvalues' {
  const camp = all.find((k) => k.role === 'campaign'), cont = all.find((k) => k.role === 'content');
  if (config.gamAttribution === 'dimension') return 'dimension';
  if (config.gamAttribution === 'keyvalues') return cont?.id ? 'keyvalues' : 'dimension';
  if (camp?.usable && cont?.usable) return 'dimension';
  return cont?.reportable === 'ON' || cont?.reportable === 'CUSTOM_DIMENSION' ? 'keyvalues' : 'dimension';
}

/** Uma rede do Ad Manager: relatório → fatos → grava só os domínios desta rede. */
async function runNetwork(net: { id: string; external_id: string; name: string }, token: string, w: { from: string; to: string }, isFinal: boolean,
  dom: Resolver, idx: Index, url: ReturnType<typeof urlCache>) {
  const all = await resolveKeys(net.external_id, token);
  let mode = attributionMode(all);
  const contentKey = all.find((k) => k.role === 'content')!;
  // modo keyvalues: o relatório-base não leva utm_campaign/utm_content/utm_source (senão o total do site sairia picado
  // por eles); só o caminho da página, se ele estiver como dimensão personalizada.
  let keys = all.filter((k) => k.usable && (mode === 'dimension' || k.role === 'path'));
  const missingOf = () => (mode === 'keyvalues' ? [] : all.filter((k) => !k.usable && !ekvUsed.some((e) => e.role === k.role) && (k.role === 'campaign' || k.role === 'content')));   // source e path são opcionais
  /*
   * URL da página (slug) para a tela URLs, nesta ordem:
   *  1. key-value do caminho (GAM_KEY_PATH, padrão page_path) como dimensão personalizada: o caminho exato;
   *  2. sem ele, a dimensão nativa URL_NAME do Ad Manager (Inventário → URL). A API REST ainda recusa essa dimensão
   *     em parte das redes: na 1ª recusa a rede é marcada e o relatório segue sem URL (sem quebrar o sync);
   *  3. sem nenhum dos dois, a receita fica em "(sem URL)" e a rede mostra o aviso de como configurar.
   */
  const pathKey = keys.find((k) => k.role === 'path');
  // page_path e utm_source sem dimensão personalizada (só "Incluir valores nos relatórios"), cada um num relatório
  // de Key-values. 0.15.1: vale nos DOIS modos (antes só no keyvalues: com utm_campaign/utm_content como dimensão
  // personalizada o utm_source era ignorado e a retenção nunca aparecia).
  const reportsValues = (k?: KeyInfo) => !!k?.id && (k.reportable === 'ON' || k.reportable === 'CUSTOM_DIMENSION');
  const pathAll = all.find((k) => k.role === 'path'), srcAll = all.find((k) => k.role === 'source');
  let pathKv = !pathKey && reportsValues(pathAll) ? pathAll! : null;
  let srcKv = reportsValues(srcAll) && !keys.some((k) => k.role === 'source') ? srcAll! : null;
  /*
   * 0.16 · Key-values aprimorados (Enhanced key-values, EKV): até 200 keys e 100.000 valores por key (a dimensão
   * personalizada para em 5.000) e entram no mesmo relatório do total, como dimensão → valores exatos por site,
   * país e campanha, sem a dimensão "Key-values" (recusada pela API nessas redes). No Ad Manager: key → "Adicionar
   * key como dimensão de Key-values aprimorados". A API não diz quais keys estão marcados; então tentamos: se o
   * Ad Manager recusar, a rede fica 12 h sem tentar EKV e segue como antes.
   */
  const ekvKeys = EKV_REFUSED_UNTIL(net.external_id) ? [] : all.filter((k) => k.id && !k.usable && ['campaign', 'content', 'source', 'path'].includes(k.role)).map((k) => ({ ...k, ekv: true }));
  let ekvUsed: KeyInfo[] = [];
  // relatórios de Key-values: só o caminho como dimensão personalizada (se houver), para casar com o balde do total
  let auxKeys = keys.filter((k) => k.role === 'path');
  // URL_NAME: a API REST recusou em todas as redes ("Invalid value … URL_NAME"); só tenta com GAM_URL_DIM=on
  const tryUrlDim = process.env.GAM_URL_DIM === 'on' && !pathKey && !pathKv && !URL_DIM_UNSUPPORTED.has(net.external_id);
  type Rows = Awaited<ReturnType<typeof runReport>>['rows'];
  const auxFail: string[] = [];
  const auxEst = new Set<string>();   // relatórios de Key-values aceitos só sem site/país (distribuídos pelo total)
  const auxUnit = new Set<string>();  // 0.17.1: aceitos com bloco de anúncios (convertido para site pelo mapa bloco → site)
  const unitLost = { rows: 0, revenue: 0 };
  const srcNoSite = { rows: 0, revenue: 0 };   // utm_source sem site em dia com mais de um site: não é repartido
  let unitMapRows: Rows | null = null;
  const unitMap = async (): Promise<Rows> => {
    if (unitMapRows) return unitMapRows;
    unitMapRows = await fetchUnitMap(net.external_id, token, w.from, w.to);
    return unitMapRows;
  };
  const both = async (extra: string[]) => {
    const run = (label: string, kv?: string) => kv
      ? runKvReport(net.external_id, token, w.from, w.to, auxKeys, label, extra, kv).then(async (r) => {
        if (r.layout.site && r.layout.country) return r.rows;
        // 0.17.1: bloco de anúncios → site (exato quando o bloco é de um site só; o país vem do mapa se faltar)
        if (r.layout.unit) { auxUnit.add(label); return unitsToSites(r.rows, await unitMap(), unitLost); }
        // 0.17.1: utm_source sem site NÃO é repartido entre os sites da rede (o push de um site aparecia como
        // WhatsApp de outro). Só entra em dia com um site só na rede (aí o site é certo).
        if (!r.layout.site && srcKv && kv === srcKv.adTagName) {
          const one = sitesByDay(base ?? []);
          r.rows = r.rows.filter((row) => {
            if ((one.get(str(row.dimensionValues[0]))?.size ?? 0) === 1) return true;
            const sv = normSource(kvValue(str(row.dimensionValues[row.dimensionValues.length - 1]), kv) ?? '');
            if (sv && retentionChannel(sv)) { srcNoSite.rows++; srcNoSite.revenue += num(row.metricValueGroups?.[0]?.primaryValues?.[0]); }
            return false;
          });
          return spreadByBase(r.rows, base ?? []);
        }
        auxEst.add(label);
        // utm_content sem SITE: a campanha já diz o site (domínio da campanha) → só o país é estimado
        if (!r.layout.site && kv === contentKey.adTagName) {
          const campHost = new Map((await q<{ id: string; host: string }>('SELECT c.id::text, d.hostname AS host FROM campaigns c JOIN domains d ON d.id = c.domain_id WHERE d.gam_account_id = $1', [net.id])).map((x) => [x.id, x.host]));
          for (const row of r.rows) {
            const content = kvValue(str(row.dimensionValues[row.dimensionValues.length - 1]), kv);
            const a = content ? attributeContent(idx, content) : null;
            const host = a && !('reason' in a) ? campHost.get(a.campaignId) : undefined;
            if (host) row.dimensionValues[1] = { stringValue: host };
          }
        }
        return spreadByBase(r.rows, base ?? []);
      })
      : runReport(net.external_id, token, w.from, w.to, keys, label, extra).then((r) => r.rows);
    // 0.15.2: se o relatório-base falhar com as dimensões personalizadas, tenta só com utm_campaign/utm_content e,
    // por fim, sem nenhuma (o total do site entra; a atribuição cai para o relatório de Key-values ou fica "sem campanha")
    let base: Rows | null = null;
    const withEkv = (ks: KeyInfo[]) => [...keys.filter((k) => !(mode === 'keyvalues' && k.role !== 'path')), ...ks];
    const fatal = (e: unknown) => e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code);
    const tryBase = async (ks: KeyInfo[]) => {
      const saved = keys; keys = withEkv(ks);
      try { base = await run('pluto-sync'); ekvUsed = ks; return true; } catch (e) { keys = saved; if (fatal(e)) throw e; return e as Error; }
    };
    if (ekvKeys.length) {
      // 0.17.1: antes era tudo ou nada (um key sem a marcação EKV derrubava os outros). Agora: todos; se recusar,
      // testa cada key num relatório de 1 dia e roda o relatório-base com os que passaram.
      const partial = EKV_PARTIAL.get(net.external_id);
      const first = partial && Date.now() - partial.at < KV_RETRY_MS ? ekvKeys.filter((k) => partial.roles.includes(k.role)) : ekvKeys;
      let r = first.length ? await tryBase(first) : new Error('nenhum key');
      if (r !== true && first.length === ekvKeys.length && ekvKeys.length > 1) {
        const ok: KeyInfo[] = [];
        for (const k of ekvKeys) {
          try { await runReportOnce(net.external_id, token, w.to, w.to, withEkv([k]), 'pluto-ekv-teste', []); ok.push(k); } catch (e) { if (fatal(e)) throw e; }
        }
        if (ok.length) { EKV_PARTIAL.set(net.external_id, { roles: ok.map((k) => k.role), at: Date.now() }); r = await tryBase(ok); }
      }
      if (r === true) {
        // com utm_campaign/utm_content no relatório-base, o processamento é o de dimensão (exato); os relatórios
        // de Key-values desses keys não são mais necessários
        if (ekvUsed.some((k) => k.role === 'campaign') || ekvUsed.some((k) => k.role === 'content')) mode = 'dimension';
        if (ekvUsed.some((k) => k.role === 'source')) srcKv = null;
        if (ekvUsed.some((k) => k.role === 'path')) pathKv = null;
        const refused = ekvKeys.filter((k) => !ekvUsed.includes(k));
        if (refused.length) auxFail.push(`Key-values aprimorados: ${refused.map((k) => k.adTagName).join(', ')} ainda não marcado(s) como EKV nesta rede (os outros já funcionam)`);
        logGam({ network: net.external_id, report: 'pluto-sync', ekvAccepted: ekvUsed.map((k) => k.adTagName), ekvRefused: refused.map((k) => k.adTagName) });
      } else {
        EKV_REFUSED.set(net.external_id, Date.now());
        EKV_PARTIAL.delete(net.external_id);
        logGam({ network: net.external_id, report: 'pluto-sync', ekvRefused: ekvKeys.map((k) => k.adTagName), message: r.message.slice(0, 300), nextTry: new Date(Date.now() + KV_RETRY_MS).toISOString() });
      }
    }
    const tries = base ? [] : [keys, keys.filter((k) => k.role === 'campaign' || k.role === 'content'), []].filter((ks, i, arr) => i === 0 || ks.length < arr[i - 1].length);
    for (let i = 0; i < tries.length && !base; i++) {
      try { keys = tries[i]; base = await run('pluto-sync'); } catch (e) {
        if (i === tries.length - 1 || (e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code))) throw e;
        auxFail.push(`relatório com ${tries[i].map((k) => k.adTagName).join(', ')} como dimensão falhou; usando ${tries[i + 1].map((k) => k.adTagName).join(', ') || 'só o total do site'}`);
      }
    }
    auxKeys = keys.filter((k) => k.role === 'path');
    // 0.15.2: relatório de Key-values que falhar não derruba a rede: o total do site entra igual e a parte dele fica
    // "sem campanha / sem URL / sem retenção" neste sync, com aviso na tela e o erro no log da api
    const aux = async (label: string, key: string, what: string) => {
      try { return await run(label, key); } catch (e) {
        if (e instanceof SyncError && ['token', 'permission', 'not_connected'].includes(e.code)) throw e;
        auxFail.push(e instanceof KvUnsupported
          ? `${what}: esta rede não aceita relatório pelo key ${key} só com "Incluir valores nos relatórios". No Ad Manager desta rede, marque ${key} como "Key-values aprimorados" (até 100.000 valores; sem o limite de 5.000 da dimensão personalizada)`
          : `${what} (${key}) indisponível neste sync: ${(e as Error).message.slice(0, 160)}`);
        return [];
      }
    };
    const kv = mode === 'keyvalues' ? await aux('pluto-sync-kv', contentKey.adTagName, 'campanhas') : [];
    const path = pathKv ? await aux('pluto-sync-path', pathKv.adTagName, 'URLs') : [];
    const src = srcKv ? await aux('pluto-sync-source', srcKv.adTagName, 'retenção') : [];
    return { base: base!, kv, path, src };
  };
  let rows: Rows, kvRows: Rows, pathRows: Rows, srcRows: Rows;
  let urlDim = false;
  try {
    ({ base: rows, kv: kvRows, path: pathRows, src: srcRows } = await both(tryUrlDim ? ['URL_NAME'] : []));
    urlDim = tryUrlDim;
  } catch (e) {
    // 0.15.2: sem a URL, tenta de novo com QUALQUER erro de API (o Ad Manager às vezes recusa URL_NAME só com "An error has occurred.")
    if (!tryUrlDim || !(e instanceof SyncError) || ['token', 'permission', 'not_connected'].includes(e.code)) throw e;
    URL_DIM_UNSUPPORTED.add(net.external_id);
    auxFail.length = 0;
    keys = all.filter((k) => k.usable && (mode === 'dimension' || k.role === 'path'));
    ({ base: rows, kv: kvRows, path: pathRows, src: srcRows } = await both([]));
  }
  const base = 3 + (urlDim ? 1 : 0);
  const ki = (role: KeyInfo['role']) => { const i = keys.findIndex((k) => k.role === role); return i < 0 ? -1 : base + i; };
  const iCamp = ki('campaign'), iContent = ki('content'), iSource = ki('source'), iPath = ki('path'), iUrl = urlDim ? 3 : -1;
  const iKvAux = base + auxKeys.length;              // KEY_VALUES_NAME, a última dimensão dos relatórios de Key-values
  const iPathAux = auxKeys.length ? base : -1;        // caminho (dimensão personalizada) nesses relatórios
  const facts: Fact[] = [];
  // descartes, agrupados para o aviso final da rede (setAccountStatus): linhas e receita (USD) de cada caso
  const noSite = { rows: 0, revenue: 0 };                                       // SITE vazio/inválido na API
  const unlinked = new Map<string, { rows: number; revenue: number }>();        // domínio sem rede do Ad Manager (gam_account_id nulo)
  const otherNet = new Map<string, { rows: number; revenue: number }>();        // domínio ligado a OUTRA rede
  const bump = (m: Map<string, { rows: number; revenue: number }>, host: string, rev: number) => { const x = m.get(host) ?? { rows: 0, revenue: 0 }; x.rows++; x.revenue += rev; m.set(host, x); };
  /** Data, domínio (só desta rede), país, caminho e métricas de uma linha; null = descartada (count = entra no aviso). */
  const read = async (r: Rows[number], count: boolean, iPath: number) => {
    const d = r.dimensionValues;
    const day = isoDate(d[0]);
    const site = str(d[1]);
    const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
    const v = { revenueUsd: num(m[0]), impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]) };
    if (!day || (!v.revenueUsd && !v.impressions && !v.adRequests)) return null;
    // Linha sem SITE (ou valor inválido): impossível atribuir a um domínio → ignora, mas conta para o aviso
    const domain = site && !EMPTY.test(site) ? await dom.ensure(site) : null;
    if (!domain) { if (count) { noSite.rows++; noSite.revenue += v.revenueUsd; } return null; }
    // VALIDAÇÃO ESTRITA da rede (fim do claimGam): o domínio só recebe receita da rede ligada a ele manualmente
    // em Domínios (domains.gam_account_id). Nada de UPDATE automático aqui.
    if (domain.gam !== net.id) { if (count) bump(domain.gam ? otherNet : unlinked, domain.hostname, v.revenueUsd); return null; }
    const path = iPath >= 0 ? str(d[iPath]) : iUrl >= 0 ? urlPath(str(d[iUrl])) : '';
    const country = str(d[2]).toUpperCase() || 'ZZ';
    return { d, day, domain, path, country, v, bucket: `${day}|${domain.id}|${country}|${path}` };
  };
  const urlOf = async (domainId: string, path: string) => (path && !EMPTY.test(path) ? await url(domainId, path) : null);

  /*
   * Cada linha vira um "pre-fato" (campanha ou sem campanha) no balde dia × site × país × caminho; depois, em comum:
   *   a) utm_source de retenção (push, whatsapp…) vindo da dimensão Key-values sai da receita SEM campanha do balde;
   *   b) page_path vindo da dimensão Key-values divide cada pre-fato entre as páginas do balde (proporção da página).
   * Dimensão personalizada (mode dimension) ou só "Incluir valores nos relatórios" (keyvalues): a e b valem nos dois,
   * então utm_source/page_path funcionam mesmo se utm_campaign/utm_content estiverem como dimensão personalizada.
   */
  type Pre = { x: NonNullable<Awaited<ReturnType<typeof read>>>; v: typeof zeroM; platform: 'google' | 'meta' | 'none'; campaignId: string | null; adGroupId: string | null; adId: string | null; reason: string | null; utmSource: string | null };
  const pre: Pre[] = [];
  const baseBy = new Map<string, typeof zeroM>();
  const addTo = (m: Map<string, typeof zeroM>, b: string, v: typeof zeroM) => { const u = m.get(b) ?? { ...zeroM }; for (const k of M_KEYS) u[k] += v[k]; m.set(b, u); };

  if (mode === 'dimension') {
    for (const r of rows) {
      const x = await read(r, true, iPath);
      if (!x) continue;
      const { d, domain } = x;
      addTo(baseBy, x.bucket, x.v);
      const campVal = iCamp >= 0 ? str(d[iCamp]) : '';
      const content = iContent >= 0 ? str(d[iContent]) : '';
      const source = iSource >= 0 ? str(d[iSource]).toLowerCase() : '';
      let platform: 'google' | 'meta' | 'none' = 'none', reason: string | null = null;
      let campaignId: string | null = null, adGroupId: string | null = null, adId: string | null = null;
      if (iCamp < 0 && iContent >= 0 && !domain.pending && !EMPTY.test(content) && !/[{}]/.test(content)) {
        // só utm_content no relatório (ex.: só ele marcado como EKV): a campanha sai do próprio utm_content
        const a = attributeContent(idx, content);
        if ('reason' in a) reason = a.reason; else ({ platform, campaignId, adGroupId, adId } = a);
      } else if (iCamp < 0) reason = 'gam_kv_not_configured';
      else if (domain.pending) reason = 'unknown_domain';
      else if (EMPTY.test(campVal)) reason = 'missing_campaign_id';
      else if (/[{}]/.test(campVal) || /[{}]/.test(content)) reason = 'invalid_utm';
      else {
        const a = attribute(idx, campVal, content, source);
        if ('reason' in a) reason = a.reason;
        else ({ platform, campaignId, adGroupId, adId } = a);
      }
      pre.push({ x, v: x.v, platform, campaignId, adGroupId, adId, reason, utmSource: normSource(source) });
    }
  } else {
    // 1) linhas com utm_content (dimensão "Key-values") → campanha · 2) total do site − (1) = sem campanha
    const used = new Map<string, typeof zeroM>();
    for (const r of kvRows) {
      const x = await read(r, false, iPathAux);
      if (!x) continue;
      const content = kvValue(str(x.d[iKvAux]), contentKey.adTagName);
      if (content == null) continue;
      addTo(used, x.bucket, x.v);
      let platform: 'google' | 'meta' | 'none' = 'none', reason: string | null = null;
      let campaignId: string | null = null, adGroupId: string | null = null, adId: string | null = null;
      if (x.domain.pending) reason = 'unknown_domain';
      else if (EMPTY.test(content)) reason = 'missing_campaign_id';
      else if (/[{}]/.test(content)) reason = 'invalid_utm';
      else {
        const a = attributeContent(idx, content);
        if ('reason' in a) reason = a.reason;
        else ({ platform, campaignId, adGroupId, adId } = a);
      }
      pre.push({ x, v: x.v, platform, campaignId, adGroupId, adId, reason, utmSource: null });
    }
    // 0.17.1: com utm_source como EKV no relatório-base, o balde pode ter várias linhas (uma por utm_source). A receita
    // das campanhas (utm_content) sai primeiro das linhas SEM utm_source de retenção, e cada linha guarda o seu utm_source.
    const baseRows: { x: NonNullable<Awaited<ReturnType<typeof read>>>; src: string | null }[] = [];
    for (const r of rows) {
      const x = await read(r, true, iPath);
      if (!x) continue;
      addTo(baseBy, x.bucket, x.v);
      baseRows.push({ x, src: iSource >= 0 ? normSource(str(x.d[iSource]).toLowerCase()) : null });
    }
    const isRet = (s: string | null) => !!s && !!retentionChannel(s);
    baseRows.sort((a, z) => Number(isRet(a.src)) - Number(isRet(z.src)));
    const left = new Map([...used].map(([b, u]) => [b, { ...u }]));
    for (const { x, src } of baseRows) {
      const u = left.get(x.bucket);
      const rest = { ...x.v };
      if (u) for (const k of M_KEYS) { const t = Math.min(rest[k], u[k]); rest[k] -= t; u[k] -= t; }
      if (rest.revenueUsd < 0.00005 && rest.impressions < 1 && rest.adRequests < 1) continue;
      pre.push({ x, v: rest, platform: 'none', campaignId: null, adGroupId: null, adId: null, reason: x.domain.pending ? 'unknown_domain' : 'missing_campaign_id', utmSource: src });
    }
  }

  // a) retenção por utm_source (os de anúncio — google, fb… — ficam nas campanhas)
  let retentionRows = 0;
  if (srcKv) {
    const srcBy = new Map<string, { s: string; v: typeof zeroM }[]>();
    for (const r of srcRows) {
      const x = await read(r, false, iPathAux);
      if (!x) continue;
      const src = normSource(kvValue(str(x.d[iKvAux]), srcKv.adTagName) ?? '');
      if (!src || !retentionChannel(src)) continue;
      retentionRows++;
      srcBy.set(x.bucket, [...(srcBy.get(x.bucket) ?? []), { s: src, v: x.v }]);
    }
    const carved: Pre[] = [];
    for (const [b, list] of srcBy) {
      const pool = pre.filter((f) => f.x.bucket === b && f.platform === 'none' && !f.utmSource && f.reason !== 'unknown_domain');
      for (const sv of list.sort((a, z) => z.v.revenueUsd - a.v.revenueUsd)) {
        const want = { ...sv.v };
        for (const f of pool) {
          const take = { ...zeroM };
          for (const k of M_KEYS) { take[k] = Math.min(want[k], f.v[k]); f.v[k] -= take[k]; want[k] -= take[k]; }
          if (take.revenueUsd > 0.00005 || take.impressions >= 1 || take.adRequests >= 1) carved.push({ ...f, v: take, utmSource: sv.s });
        }
      }
    }
    pre.push(...carved);
  }

  // b) páginas por balde (até 100 por balde; o resto fica com o caminho que a linha já tinha, ou sem URL)
  const pathBy = new Map<string, { path: string; v: typeof zeroM }[]>();
  if (pathKv) {
    for (const r of pathRows) {
      const x = await read(r, false, iPathAux);
      if (!x) continue;
      const path = kvPath(kvValue(str(x.d[iKvAux]), pathKv.adTagName) ?? '');
      if (!path) continue;
      const list = pathBy.get(x.bucket) ?? [];
      const hit = list.find((p) => p.path === path);
      if (hit) for (const k of M_KEYS) hit.v[k] += x.v[k]; else list.push({ path, v: { ...x.v } });
      pathBy.set(x.bucket, list);
    }
    for (const [b, list] of pathBy) pathBy.set(b, list.sort((a, z) => z.v.revenueUsd - a.v.revenueUsd).slice(0, 100));
  }
  for (const f of pre) {
    const pages = pathBy.get(f.x.bucket);
    const tot = baseBy.get(f.x.bucket);
    const push = async (path: string, v: typeof zeroM) => {
      if (v.revenueUsd < 0.0000005 && v.impressions < 0.0005 && v.adRequests < 0.0005) return;
      facts.push(emptyFact({ date: f.x.day, domainId: f.x.domain.id, urlId: await urlOf(f.x.domain.id, path), platform: f.platform, campaignId: f.campaignId, adGroupId: f.adGroupId, adId: f.adId,
        country: f.x.country, reason: f.reason, utmSource: f.utmSource, ...v }));
    };
    if (!pages?.length || !tot) { await push(f.x.path, f.v); continue; }
    const left = { ...f.v };
    for (const pg of pages) {
      const part = { ...zeroM };
      for (const k of M_KEYS) {
        const sum = pages.reduce((a, q2) => a + q2.v[k], 0);
        const den = Math.max(tot[k], sum);
        part[k] = den > 0 ? f.v[k] * (pg.v[k] / den) : 0;
        left[k] -= part[k];
      }
      await push(pg.path, part);
    }
    for (const k of M_KEYS) left[k] = Math.max(0, left[k]);
    await push(f.x.path, left);
  }
  const mine = (await q<{ id: string }>('SELECT id::text FROM domains WHERE gam_account_id = $1', [net.id])).map((x) => x.id);
  const n = await replaceFacts('gam', w.from, w.to, { domains: mine }, facts, isFinal);
  const noKv = mode === 'keyvalues' && !kvRows.length && rows.length
    ? `nenhuma linha com o key-value "${contentKey.adTagName}" no relatório: confira no Ad Manager (Inventário → Key-values → ${contentKey.adTagName}) se "Incluir valores nos relatórios" está ligado e se o site manda o key no GPT`
    : '';
  const warn = [
    ...auxFail,
    srcNoSite.rows ? `retenção (utm_source) sem site: esta rede só entrega ${srcKv?.adTagName ?? 'utm_source'} somado de todos os sites, então ${usd(srcNoSite.revenue)} de retenção ficaram fora (não dá para saber de qual site). Para ter por site: no Ad Manager, marque ${srcKv?.adTagName ?? 'utm_source'} como "Key-values aprimorados"` : '',
    unitLost.rows ? `${unitLost.rows} linhas de Key-values com bloco de anúncios sem site no dia ignoradas (${usd(unitLost.revenue)})` : '',
    auxEst.size ? `o Ad Manager só aceitou ${[...auxEst].map((l) => l.replace('pluto-sync-', '').replace('kv', 'utm_content').replace('source', 'utm_source').replace('path', 'page_path')).join(', ')} sem site/país: valores distribuídos pela receita de cada site e país do dia (estimativa)` : '',
    missingOf().length ? `key-values fora dos relatórios no Ad Manager: ${missingOf().map((k) => k.adTagName).join(', ')} (Inventário → Key-values → ${contentKey.adTagName} → "Incluir valores nos relatórios")` : '',
    noKv,
    noSite.rows ? `${noSite.rows} linhas sem site ignoradas (${usd(noSite.revenue)})` : '',
    unlinked.size ? `${sum(unlinked)} linhas de sites sem rede ligada ignoradas (${usd(rev(unlinked))}): ${sites(unlinked)}. Ligue cada site a esta rede em Domínios` : '',
    otherNet.size ? `${sum(otherNet)} linhas de sites ligados a outra rede ignoradas (${usd(rev(otherNet))}): ${sites(otherNet)}. Se o site é desta rede, troque a rede em Domínios` : '',
  ].filter(Boolean).join(' · ');
  // URL é informativo (não deixa a rede amarela): sem caminho, a tela URLs mostra "(sem URL)"
  const urlNote = !keys.some((k) => k.role === 'path') && !pathKv && !urlDim && config.gamKeys.path
    ? `URLs: sem o key-value "${config.gamKeys.path}" nos relatórios a receita fica em "(sem URL)". O site manda googletag.pubads().setTargeting('${config.gamKeys.path}', location.pathname) e o key fica marcado como Key-values aprimorados`
    : '';
  const modeNote = [
    ekvUsed.length ? `Key-values aprimorados (EKV): ${ekvUsed.map((k) => k.adTagName).join(', ')}`
      : mode === 'keyvalues' ? `atribuição pelo key-value ${contentKey.adTagName} (sem dimensão personalizada)` : 'atribuição por dimensão personalizada',
    pathKv ? `URLs por ${pathKv.adTagName}` : '',
    auxUnit.size ? `${[...auxUnit].map((l) => l.replace('pluto-sync-', '').replace('kv', 'utm_content').replace('source', 'utm_source').replace('path', 'page_path')).join(', ')} por bloco de anúncios → site` : '',
    srcKv ? `retenção por ${srcKv.adTagName} (${retentionRows} linhas de push/whatsapp/outros)`
      : keys.some((k) => k.role === 'source') ? `retenção por ${config.gamKeys.source} (${ekvUsed.some((k) => k.role === 'source') ? 'EKV' : 'dimensão'})`
      : config.gamKeys.source ? `retenção: key "${config.gamKeys.source}" não encontrado nos relatórios do Ad Manager` : '',
  ].filter(Boolean).join(' · ');
  await setAccountStatus(net.id, warn ? 'warn' : 'ok', [warn, modeNote, urlNote].filter(Boolean).join(' · ') || null);
  return { rows: rows.length + kvRows.length + pathRows.length + srcRows.length, n, warn };
}

const zeroM = { revenueUsd: 0, impressions: 0, adRequests: 0, responsesServed: 0, adClicks: 0, viewable: 0 };
const M_KEYS = Object.keys(zeroM) as (keyof typeof zeroM)[];

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
      logGam({ network: net.external_id, name: net.name, fatal: true, code: e instanceof SyncError ? e.code : 'erro', http: e instanceof SyncError ? e.http ?? null : null, message: (e as Error).message, body: e instanceof SyncError ? e.body ?? null : null, stack: (e as Error).stack?.split('\n').slice(0, 6).join(' | ') });
      await setAccountStatus(net.id, statusFromError(e), (e as Error).message.slice(0, 500)).catch(() => {});
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

/** Valor do key page_path → caminho ("/artigo/"), sem query; aceita também URL completa. */
export function kvPath(v: string): string {
  const s = v.trim();
  if (!s || EMPTY.test(s) || /[{}]/.test(s)) return '';
  return s.startsWith('/') ? s.split(/[?#]/)[0] : urlPath(s);
}

/** utm_source gravado na linha (origem da receita na tela URLs): minúsculo, só [a-z0-9_.-], até 40. Vazio/macro → null. */
export function normSource(v: string): string | null {
  const x = v.trim().toLowerCase();
  if (!x || EMPTY.test(x) || /[{}]/.test(x)) return null;
  const c = x.replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return c || null;
}
