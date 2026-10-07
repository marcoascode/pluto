/**
 * Peças comuns dos workers: câmbio por dia, domínio/URL a partir de um link, estrutura (campanha → grupo → anúncio)
 * e gravação idempotente em daily_metrics (apaga a janela da origem e regrava, numa transação).
 */
import type { PoolClient } from 'pg';
import { config } from '../../config.js';
import { one, pool, q, tx } from '../../db.js';
import { addDays, today } from '../../lib/dates.js';
import { SyncError } from './http.js';

export type Source = 'google-ads' | 'meta' | 'gam';
export type Platform = 'google' | 'meta' | 'none';

/* ---------------- janela ---------------- */
/** Janela do job. Na primeira importação da origem, volta SYNC_BACKFILL_DAYS dias. */
/**
 * Janela de datas do job (editável em Integrações → Sincronização, só SuperAdmin):
 *  - window_mode 'days':        D-X → hoje  (gam.close: D-X → D-4)
 *  - window_mode 'incremental': do dia da última execução com sucesso (−1 dia de folga) até hoje
 * Primeira importação da origem (tabela ainda vazia): volta SYNC_BACKFILL_DAYS dias.
 */
export async function windowFor(source: Source, kind: 'recent' | 'close', table: 'daily_metrics' | 'placement_metrics' = 'daily_metrics', settingId?: string): Promise<{ from: string; to: string; backfill: boolean }> {
  const t = today();
  const st = settingId ? await one<{ mode: string; days: number | null }>('SELECT window_mode AS mode, window_days AS days FROM sync_settings WHERE id = $1', [settingId]) : null;
  const clamp = (d: number) => Math.max(0, Math.min(400, d));
  if (kind === 'close') { const x = Math.max(4, clamp(st?.days ?? 7)); return { from: addDays(t, -x), to: addDays(t, -4), backfill: false }; }
  const has = await one(`SELECT 1 FROM ${table} WHERE source = $1 LIMIT 1`, [source]);
  if (!has) return { from: addDays(t, -config.sync.backfillDays), to: t, backfill: true };
  if (st?.mode === 'incremental' && settingId) {
    const last = await one<{ d: string | null }>(`SELECT (max(finished_at) AT TIME ZONE '${config.appTz.replace(/[^A-Za-z0-9_/+-]/g, '')}')::date::text AS d FROM sync_jobs WHERE setting_id = $1 AND status = 'success'`, [settingId]);
    if (last?.d) { const from = addDays(last.d, -1); return { from: from < addDays(t, -400) ? addDays(t, -400) : from > t ? t : from, to: t, backfill: false }; }
    return { from: addDays(t, -3), to: t, backfill: false };
  }
  return { from: addDays(t, -clamp(st?.days ?? 3)), to: t, backfill: false };
}

/* ---------------- câmbio: valor na moeda da conta → USD pela taxa do dia ---------------- */
export async function fxToUsd(from: string, to: string) {
  const rows = await q<{ date: string; currency: string; rate_per_usd: number }>(
    `SELECT date::text, currency, rate_per_usd FROM currency_rates WHERE date BETWEEN ($1::date - 10) AND $2::date ORDER BY date`, [from, to]);
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) { if (!by.has(r.currency)) by.set(r.currency, new Map()); by.get(r.currency)!.set(r.date, r.rate_per_usd); }
  return (amount: number, currency: string, date: string): number => {
    const cur = currency.toUpperCase();
    if (cur === 'USD' || !amount) return amount;
    const m = by.get(cur);
    if (!m) throw new SyncError('fx_missing', `Sem cotação USD/${cur} no banco para converter o custo. Rode a atualização de câmbio.`);
    for (let d = date, i = 0; i < 11; d = addDays(d, -1), i++) { const r = m.get(d); if (r) return amount / r; }
    throw new SyncError('fx_missing', `Sem cotação USD/${cur} perto de ${date}.`);
  };
}

/** Alíquota do IVA sobre o gasto da Meta (app_settings.meta_iva_rate, padrão 13,83%). */
export async function metaIvaRate(): Promise<number> {
  const r = await one<{ value: { rate: number } }>(`SELECT value FROM app_settings WHERE key = 'meta_iva_rate'`);
  const v = Number(r?.value?.rate);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.1383;
}

/* ---------------- domínios e URLs ---------------- */
export const normHost = (h: string) => h.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

export async function domainResolver() {
  const rows = await q<{ id: string; hostname: string; active: boolean; pending: boolean; gam: string | null }>('SELECT id::text, hostname, active, created_by_sync AS pending, gam_account_id::text AS gam FROM domains');
  const map = new Map(rows.map((r) => [r.hostname, r]));
  /** Hostname exato ou domínio pai cadastrado (blog.site.com → site.com). */
  const byHost = (host: string | null | undefined) => {
    if (!host) return null;
    let h = normHost(host);
    while (h.includes('.')) { const d = map.get(h); if (d) return d; h = h.slice(h.indexOf('.') + 1); }
    return null;
  };
  const byUrl = (url: string | null | undefined) => { const u = parseUrl(url); return u ? byHost(u.hostname) : null; };
  /** Site que o Ad Manager mostrou e não está cadastrado: cria inativo (aparece em Domínios para o admin ativar). */
  const ensure = async (host: string) => {
    const h = normHost(host);
    const found = byHost(h);
    if (found) return found;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
    const r = await one<{ id: string; hostname: string; active: boolean; pending: boolean; gam: string | null }>(
      `INSERT INTO domains (hostname, active, created_by_sync) VALUES ($1, false, true)
       ON CONFLICT (hostname) DO UPDATE SET hostname = EXCLUDED.hostname RETURNING id::text, hostname, active, created_by_sync AS pending, gam_account_id::text AS gam`, [h]);
    map.set(h, r!);
    return r!;
  };
  /** Um domínio = uma rede do Ad Manager. Sem rede ainda: fica com a primeira que mostrar o site. Outra rede → false. */
  const claimGam = async (d: { id: string; gam: string | null }, networkId: string) => {
    if (d.gam === networkId) return true;
    if (d.gam) return false;
    await q('UPDATE domains SET gam_account_id = $2 WHERE id = $1 AND gam_account_id IS NULL', [d.id, networkId]);
    d.gam = networkId;
    return true;
  };
  return { byHost, byUrl, ensure, claimGam };
}

export function parseUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
}
/** Caminho sem query/hash, com / no começo. */
export const normPath = (p: string) => { const s = (p.split(/[?#]/)[0] || '/').slice(0, 300); return s.startsWith('/') ? s : '/' + s; };

export function urlCache() {
  const cache = new Map<string, string>();
  return async (domainId: string, path: string | null | undefined, c?: PoolClient): Promise<string | null> => {
    if (!path) return null;
    const p = normPath(path);
    const k = domainId + '|' + p;
    const hit = cache.get(k);
    if (hit) return hit;
    const r = await one<{ id: string }>(`INSERT INTO urls (domain_id, path) VALUES ($1, $2) ON CONFLICT (domain_id, path) DO UPDATE SET path = EXCLUDED.path RETURNING id::text`, [domainId, p], c);
    cache.set(k, r!.id);
    return r!.id;
  };
}

/** Domínios ligados à conta (Domínios → contas). Se for um só, é o destino padrão das campanhas. */
export async function accountDomains(accountId: string): Promise<string[]> {
  return (await q<{ id: string }>('SELECT domain_id::text AS id FROM domain_accounts WHERE account_id = $1', [accountId])).map((r) => r.id);
}

/* ---------------- estrutura ---------------- */
/** Cria/atualiza a campanha. Mantém o domínio já salvo quando o link não resolve. Devolve id e domínio final. */
export async function upsertCampaign(accountId: string, platform: 'google' | 'meta', extId: string, name: string, status: string, domainId: string | null): Promise<{ id: string; domainId: string | null }> {
  const st = /PAUSED|INACTIVE|ADSET_PAUSED|CAMPAIGN_PAUSED/i.test(status) ? 'PAUSED' : /REMOVED|DELETED|ARCHIVED/i.test(status) ? 'REMOVED' : 'ENABLED';
  const r = await one<{ id: string; domainId: string | null }>(`
    INSERT INTO campaigns (account_id, platform, external_id, name, status, domain_id) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (platform, external_id) DO UPDATE SET account_id = EXCLUDED.account_id, name = EXCLUDED.name, status = EXCLUDED.status,
      domain_id = COALESCE(EXCLUDED.domain_id, campaigns.domain_id), updated_at = now()
    RETURNING id::text, domain_id::text AS "domainId"`, [accountId, platform, extId, name.slice(0, 255) || extId, st, domainId]);
  return r!;
}
export async function upsertAdGroup(campaignId: string, extId: string, name: string, status?: string): Promise<string> {
  const r = await one<{ id: string }>(`
    INSERT INTO ad_groups (campaign_id, external_id, name, status) VALUES ($1, $2, $3, $4)
    ON CONFLICT (campaign_id, external_id) DO UPDATE SET name = EXCLUDED.name, status = COALESCE(EXCLUDED.status, ad_groups.status), last_seen_at = now()
    RETURNING id::text`, [campaignId, extId, name.slice(0, 255) || extId, status ?? null]);
  return r!.id;
}
export async function upsertAd(adGroupId: string, extId: string, name: string, finalUrl?: string | null, status?: string): Promise<string> {
  const r = await one<{ id: string }>(`
    INSERT INTO ads (ad_group_id, external_id, name, final_url, status) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (ad_group_id, external_id) DO UPDATE SET name = EXCLUDED.name, final_url = COALESCE(EXCLUDED.final_url, ads.final_url), status = COALESCE(EXCLUDED.status, ads.status), last_seen_at = now()
    RETURNING id::text`, [adGroupId, extId, name.slice(0, 255) || `Anúncio ${extId}`, finalUrl ?? null, status ?? null]);
  return r!.id;
}

/* ---------------- fatos ---------------- */
export interface Fact {
  date: string; domainId: string; urlId: string | null; platform: Platform;
  campaignId: string | null; adGroupId: string | null; adId: string | null; country: string; reason: string | null;
  spendUsd: number; ivaUsd: number; revenueUsd: number; sessions: number; impressions: number; adRequests: number;
  responsesServed: number; adClicks: number; viewable: number; trafficClicks: number; trafficImpressions: number;
}
export const emptyFact = (p: Partial<Fact> & Pick<Fact, 'date' | 'domainId' | 'platform'>): Fact => ({
  urlId: null, campaignId: null, adGroupId: null, adId: null, country: 'ZZ', reason: null,
  spendUsd: 0, ivaUsd: 0, revenueUsd: 0, sessions: 0, impressions: 0, adRequests: 0, responsesServed: 0, adClicks: 0, viewable: 0, trafficClicks: 0, trafficImpressions: 0, ...p,
});
const NUM: (keyof Fact)[] = ['spendUsd', 'ivaUsd', 'revenueUsd', 'sessions', 'impressions', 'adRequests', 'responsesServed', 'adClicks', 'viewable', 'trafficClicks', 'trafficImpressions'];

/** Soma linhas que caem no mesmo grão (a chave única da tabela). */
export function mergeFacts(rows: Fact[]): Fact[] {
  const m = new Map<string, Fact>();
  for (const f of rows) {
    const k = [f.date, f.domainId, f.urlId ?? 0, f.platform, f.campaignId ?? 0, f.adGroupId ?? 0, f.adId ?? 0, f.country, f.reason ?? ''].join('|');
    const e = m.get(k);
    if (!e) { m.set(k, { ...f }); continue; }
    for (const n of NUM) (e[n] as number) += f[n] as number;
  }
  return [...m.values()];
}

const ISO2 = /^[A-Z]{2}$/;
/**
 * Substitui as linhas da origem na janela por `rows` (transação).
 * scope: ids de campanhas cujas linhas são desta execução (Google/Meta, por conta) ou 'all' (Ad Manager).
 */
/** scope: ids de campanhas · 'all' (a origem inteira) · { domains } (Ad Manager: só os domínios daquela rede). */
export async function replaceFacts(source: Source, from: string, to: string, scope: string[] | 'all' | { domains: string[] }, rows: Fact[], isFinal = false) {
  const data = mergeFacts(rows.filter((f) => f.date >= from && f.date <= to));   // nunca grava fora da janela que apagou
  await tx(async (c) => {
    if (scope === 'all') await c.query('DELETE FROM daily_metrics WHERE source = $1 AND date BETWEEN $2 AND $3', [source, from, to]);
    else if (!Array.isArray(scope)) { if (scope.domains.length) await c.query('DELETE FROM daily_metrics WHERE source = $1 AND date BETWEEN $2 AND $3 AND domain_id = ANY($4::bigint[])', [source, from, to, scope.domains]); }
    else if (scope.length) await c.query('DELETE FROM daily_metrics WHERE source = $1 AND date BETWEEN $2 AND $3 AND campaign_id = ANY($4::bigint[])', [source, from, to, scope]);
    for (let i = 0; i < data.length; i += 2000) {
      const ch = data.slice(i, i + 2000);
      const col = <K extends keyof Fact>(k: K) => ch.map((f) => f[k]);
      await c.query(`
        INSERT INTO daily_metrics (source, date, domain_id, url_id, platform, campaign_id, ad_group_id, ad_id, country, unattributed_reason,
          spend_usd, iva_usd, revenue_usd, sessions, impressions, ad_requests, responses_served, ad_clicks, viewable, traffic_clicks, traffic_impressions, is_final, updated_at)
        SELECT $1, d, dom, u, p, c, g, a, co, re, sp, iv, rv, se, im, ar, rs, ac, vw, tc, ti, $22, now()
          FROM unnest($2::date[], $3::bigint[], $4::bigint[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[], $9::text[], $10::text[],
                      $11::numeric[], $12::numeric[], $13::numeric[], $14::int[], $15::bigint[], $16::bigint[], $17::bigint[], $18::bigint[], $19::bigint[], $20::bigint[], $21::bigint[])
            AS t(d, dom, u, p, c, g, a, co, re, sp, iv, rv, se, im, ar, rs, ac, vw, tc, ti)`,
        [source, col('date'), col('domainId'), col('urlId'), col('platform'), col('campaignId'), col('adGroupId'), col('adId'),
          ch.map((f) => (ISO2.test(f.country) ? f.country : 'ZZ')), col('reason'),
          ch.map((f) => round4(f.spendUsd)), ch.map((f) => round4(f.ivaUsd)), ch.map((f) => round4(f.revenueUsd)),
          ch.map((f) => Math.round(f.sessions)), ch.map((f) => Math.round(f.impressions)), ch.map((f) => Math.round(f.adRequests)), ch.map((f) => Math.round(f.responsesServed)),
          ch.map((f) => Math.round(f.adClicks)), ch.map((f) => Math.round(f.viewable)), ch.map((f) => Math.round(f.trafficClicks)), ch.map((f) => Math.round(f.trafficImpressions)), isFinal]);
    }
    const doms = [...new Set(data.map((f) => f.domainId))];
    if (doms.length) await c.query('UPDATE domains SET last_data_at = now() WHERE id = ANY($1::bigint[])', [doms]);
  });
  return data.length;
}
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Estado da conta depois do sync (aparece na tela Contas). */
export async function setAccountStatus(id: string, status: 'ok' | 'error' | 'permission' | 'token' | 'late', message: string | null) {
  await q(`UPDATE integration_accounts SET status = $2, message = $3, last_sync_at = CASE WHEN $2 = 'ok' THEN now() ELSE last_sync_at END WHERE id = $1`, [id, status, message]);
}
export function statusFromError(e: unknown): 'error' | 'permission' | 'token' {
  const code = (e as SyncError)?.code;
  return code === 'permission' ? 'permission' : code === 'token' ? 'token' : 'error';
}
export { pool };
