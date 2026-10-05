/**
 * Jobs de sincronização (um por linha de sync_settings). O agendador chama runJob() quando vence;
 * "Sincronizar agora" chama runProvider().
 *
 *  google-ads.structure  contas da MCC + campanhas/grupos/anúncios           (googleAds.ts)
 *  google-ads.metrics    custo × país, D-3 → hoje                             (googleAds.ts)
 *  meta.structure        campanhas/conjuntos/anúncios + link do criativo      (meta.ts)
 *  meta.metrics          insights por anúncio × país + IVA, D-3 → hoje        (meta.ts)
 *  gam.revenue           receita e delivery por site × país × key-values      (gam.ts)
 *  gam.close             fechamento: reprocessa D-7 → D-4 e marca is_final     (gam.ts + placements)
 *  google-ads.placements custo por campanha × placement, D-3 → hoje          (placements.ts)
 *  gam.placements       receita por site × campanha × placement              (placements.ts)
 *  fx.rates              câmbio USD → BRL/EUR                                 (../fx.ts)
 *
 * Cada job grava só as linhas da própria origem (daily_metrics.source) e é idempotente:
 * rodar de novo a mesma janela substitui os valores, não duplica.
 * Primeira importação de uma origem: volta SYNC_BACKFILL_DAYS (padrão 30) dias.
 */
import { one, q } from '../../db.js';
import { refreshRates } from '../fx.js';
import { windowFor } from './common.js';
import { runGam } from './gam.js';
import { runGoogleAds } from './googleAds.js';
import { runMeta } from './meta.js';
import { runGamPlacements, runGoogleAdsPlacements } from './placements.js';

export type JobResult = { status: 'success' | 'skipped' | 'failed'; message?: string };
type Runner = () => Promise<JobResult>;

const RUNNERS: Record<string, Runner> = {
  'fx.rates': async () => { const r = await refreshRates(); return { status: 'success', message: `${r.count} taxas · ${r.source}` }; },
  'google-ads.structure': async () => runGoogleAds('structure', await windowFor('google-ads', 'recent')),
  'google-ads.metrics': async () => runGoogleAds('metrics', await windowFor('google-ads', 'recent')),
  'meta.structure': async () => runMeta('structure', await windowFor('meta', 'recent')),
  'meta.metrics': async () => runMeta('metrics', await windowFor('meta', 'recent')),
  'gam.revenue': async () => runGam(await windowFor('gam', 'recent')),
  'gam.close': async () => {
    const a = await runGam(await windowFor('gam', 'close'), true);
    const b = await runGamPlacements(await windowFor('gam', 'close', 'placement_metrics'), true);
    return { status: a.status, message: `${a.message ?? ''} · placements: ${b.message ?? b.status}`.slice(0, 500) };
  },
  'google-ads.placements': async () => runGoogleAdsPlacements(await windowFor('google-ads', 'recent', 'placement_metrics')),
  'gam.placements': async () => runGamPlacements(await windowFor('gam', 'recent', 'placement_metrics')),
};

/** Evita o mesmo job rodando duas vezes ao mesmo tempo neste processo. */
const running = new Set<string>();

/** Executa um job agora, registrando em sync_jobs e atualizando sync_settings. */
export async function runJob(settingId: string): Promise<JobResult> {
  const runner = RUNNERS[settingId];
  if (!runner) return { status: 'failed', message: 'job desconhecido' };
  if (running.has(settingId)) return { status: 'skipped', message: 'já está rodando' };
  running.add(settingId);
  const job = await one<{ id: string }>(`INSERT INTO sync_jobs (setting_id, provider, status, attempts) VALUES ($1, split_part($1, '.', 1), 'running', 1) RETURNING id::text`, [settingId]);
  await q(`UPDATE sync_settings SET last_status = 'running' WHERE id = $1`, [settingId]);
  let res: JobResult;
  try { res = await runner(); } catch (e) { res = { status: 'failed', message: (e as Error).message.slice(0, 500) }; } finally { running.delete(settingId); }
  await q(`UPDATE sync_jobs SET status = $2, message = $3, finished_at = now() WHERE id = $1`, [job!.id, res.status, res.message ?? null]);
  await q(`UPDATE sync_settings SET last_run_at = now(), next_run_at = now() + make_interval(mins => every_minutes), last_status = $2 WHERE id = $1`,
    [settingId, res.status === 'failed' ? 'failed' : 'success']);
  if (res.status === 'success' && !settingId.startsWith('fx')) await q(`UPDATE integration_connections SET last_sync_at = now() WHERE provider = split_part($1, '.', 1)`, [settingId]);
  return res;
}

/** "Sincronizar agora": estrutura antes das métricas (campanhas novas já entram com domínio). */
export async function runProvider(provider: string) {
  const ids = await q<{ id: string }>(`SELECT id FROM sync_settings WHERE provider = $1 AND enabled ORDER BY CASE WHEN id LIKE '%.structure' THEN 0 ELSE 1 END, id`, [provider]);
  for (const { id } of ids) await runJob(id);
}
