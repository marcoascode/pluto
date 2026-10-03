/**
 * Workers de sincronização. Cada job recebe a janela e grava em daily_metrics/campaigns/ad_groups/ads/urls.
 *
 * O que falta plugar (precisa das credenciais reais de cada API):
 *  - google-ads.*: Google Ads API (GAQL) com developer token + refresh token da MCC
 *      SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id, segments.geo_target_country(*), metrics.cost_micros, metrics.clicks, metrics.impressions FROM ad_group_ad …
 *      (*) país via geographic_view / user_location_view
 *  - meta.*: Marketing API /act_{id}/insights?level=ad&breakdowns=country&time_increment=1&fields=spend,clicks,impressions
 *  - gam.*:  Ad Manager API v1 (REST) networks/{code}/reports — dimensões DATE, AD_UNIT, COUNTRY_CODE, CUSTOM_KEY_VALUES (utm_campaign/adgroup/creative), métricas
 *            AD_SERVER_IMPRESSIONS…/TOTAL_IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, REVENUE, CLICKS, ACTIVE_VIEW_*
 * Regras: converter custo da moeda da conta para USD pela taxa do dia antes de gravar; receita sem key-values válidos → platform='none' + unattributed_reason.
 */
import { one, q } from '../../db.js';
import { addDays, today } from '../../lib/dates.js';
import { refreshRates } from '../fx.js';

export type JobResult = { status: 'success' | 'skipped' | 'failed'; message?: string };
type Runner = (window: { from: string; to: string }) => Promise<JobResult>;

async function connected(provider: string) {
  const c = await one<{ status: string; has: boolean }>('SELECT status, refresh_token_enc IS NOT NULL OR access_token_enc IS NOT NULL AS has FROM integration_connections WHERE provider = $1', [provider]);
  return !!c?.has;
}
const notConnected = (p: string): JobResult => ({ status: 'skipped', message: `${p} ainda não conectado via OAuth` });
const todo = (p: string): JobResult => ({ status: 'skipped', message: `worker de ${p} ainda não implementado (ver services/sync/index.ts)` });

const RUNNERS: Record<string, Runner> = {
  'fx.rates': async () => { const r = await refreshRates(); return { status: 'success', message: `${r.count} taxas · ${r.source}` }; },
  'google-ads.metrics': async () => ((await connected('google-ads')) ? todo('Google Ads') : notConnected('Google Ads')),
  'google-ads.structure': async () => ((await connected('google-ads')) ? todo('Google Ads') : notConnected('Google Ads')),
  'meta.metrics': async () => ((await connected('meta')) ? todo('Meta') : notConnected('Meta')),
  'meta.structure': async () => ((await connected('meta')) ? todo('Meta') : notConnected('Meta')),
  'gam.revenue': async () => ((await connected('gam')) ? todo('Ad Manager') : notConnected('Ad Manager')),
  'gam.close': async () => ((await connected('gam')) ? todo('Ad Manager') : notConnected('Ad Manager')),
};

/** Janela de cada job: incremental D-3 → hoje; fechamento D-7 → D-4. */
function windowFor(id: string) {
  const t = today();
  if (id === 'gam.close') return { from: addDays(t, -7), to: addDays(t, -4) };
  return { from: addDays(t, -3), to: t };
}

/** Executa um job agora, registrando em sync_jobs e atualizando sync_settings. */
export async function runJob(settingId: string): Promise<JobResult> {
  const runner = RUNNERS[settingId];
  if (!runner) return { status: 'failed', message: 'job desconhecido' };
  const w = windowFor(settingId);
  const job = await one<{ id: string }>(`INSERT INTO sync_jobs (setting_id, provider, window_from, window_to, status, attempts) VALUES ($1, split_part($1, '.', 1), $2, $3, 'running', 1) RETURNING id::text`, [settingId, w.from, w.to]);
  await q(`UPDATE sync_settings SET last_status = 'running' WHERE id = $1`, [settingId]);
  let res: JobResult;
  try { res = await runner(w); } catch (e) { res = { status: 'failed', message: (e as Error).message.slice(0, 500) }; }
  await q(`UPDATE sync_jobs SET status = $2, message = $3, finished_at = now() WHERE id = $1`, [job!.id, res.status, res.message ?? null]);
  await q(`UPDATE sync_settings SET last_run_at = now(), next_run_at = now() + make_interval(mins => every_minutes), last_status = $2 WHERE id = $1`,
    [settingId, res.status === 'failed' ? 'failed' : 'success']);
  if (res.status === 'success' && !settingId.startsWith('fx')) await q(`UPDATE integration_connections SET last_sync_at = now() WHERE provider = split_part($1, '.', 1)`, [settingId]);
  return res;
}

/** Roda os jobs de um provedor (botão "Sincronizar agora"). */
export async function runProvider(provider: string) {
  const ids = await q<{ id: string }>('SELECT id FROM sync_settings WHERE provider = $1 AND enabled ORDER BY id', [provider]);
  for (const { id } of ids) await runJob(id);
}
