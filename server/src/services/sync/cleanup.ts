/**
 * Limpeza de estrutura antiga (jobs google-ads.cleanup e meta.cleanup).
 * "Exclua dados com mais de X dias" (sync_settings.retention_days, editável em Integrações → Sincronização):
 *   remove de ads e ad_groups o que o sync não vê há mais de X dias (removido/arquivado na plataforma)
 *   e que não teve métrica nesses X dias.
 * As métricas antigas desses anúncios/grupos NÃO somem: antes de excluir, as linhas de daily_metrics são somadas
 * no nível de cima (anúncio → grupo, grupo → campanha). Totais por dia, domínio, campanha e país continuam iguais.
 */
import { one, tx } from '../../db.js';
import type { JobResult } from './index.js';

const SUMS = ['spend_usd', 'iva_usd', 'revenue_usd', 'impressions', 'ad_requests', 'responses_served', 'ad_clicks', 'viewable', 'traffic_clicks', 'traffic_impressions'];
const GRAIN_CONFLICT = `(source, date, domain_id, (COALESCE(url_id, 0)), platform, (COALESCE(campaign_id, 0)), (COALESCE(ad_group_id, 0)), (COALESCE(ad_id, 0)), country, (COALESCE(unattributed_reason, '')))`;

/** Soma as linhas de daily_metrics que apontam para os ids da tabela temporária no nível de cima e apaga as originais. */
function rollupSql(level: 'ad' | 'group', tmp: string) {
  const col = level === 'ad' ? 'ad_id' : 'ad_group_id';
  const keep = level === 'ad' ? 'ad_group_id, NULL::bigint' : 'NULL::bigint, NULL::bigint';
  const groupCols = `source, date, domain_id, url_id, platform, campaign_id, ${level === 'ad' ? 'ad_group_id, ' : ''}country, unattributed_reason`;
  return [
    `INSERT INTO daily_metrics (source, date, domain_id, url_id, platform, campaign_id, ad_group_id, ad_id, country, unattributed_reason, ${SUMS.join(', ')}, sessions, is_final, updated_at)
     SELECT source, date, domain_id, url_id, platform, campaign_id, ${keep}, country, unattributed_reason, ${SUMS.map((c) => `SUM(${c})`).join(', ')}, SUM(sessions)::int, bool_and(is_final), now()
       FROM daily_metrics WHERE ${col} IN (SELECT id FROM ${tmp})
      GROUP BY ${groupCols}
     ON CONFLICT ${GRAIN_CONFLICT} DO UPDATE SET ${[...SUMS, 'sessions'].map((c) => `${c} = daily_metrics.${c} + EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
    `DELETE FROM daily_metrics WHERE ${col} IN (SELECT id FROM ${tmp})`,
  ];
}

export async function runCleanup(settingId: string, platform: 'google' | 'meta'): Promise<JobResult> {
  const st = await one<{ days: number | null }>('SELECT retention_days AS days FROM sync_settings WHERE id = $1', [settingId]);
  const days = st?.days;
  if (!days) return { status: 'skipped', message: 'Limpeza desligada (defina "Excluir dados com mais de X dias")' };
  const r = await tx(async (c) => {
    await c.query(`CREATE TEMP TABLE old_ads ON COMMIT DROP AS
      SELECT a.id FROM ads a JOIN ad_groups g ON g.id = a.ad_group_id JOIN campaigns cp ON cp.id = g.campaign_id
       WHERE cp.platform = $1 AND a.last_seen_at < now() - make_interval(days => $2)
         AND NOT EXISTS (SELECT 1 FROM daily_metrics m WHERE m.ad_id = a.id AND m.date >= CURRENT_DATE - $2::int)`, [platform, days]);
    for (const sql of rollupSql('ad', 'old_ads')) await c.query(sql);
    const ads = (await c.query('DELETE FROM ads WHERE id IN (SELECT id FROM old_ads)')).rowCount ?? 0;
    await c.query(`CREATE TEMP TABLE old_groups ON COMMIT DROP AS
      SELECT g.id FROM ad_groups g JOIN campaigns cp ON cp.id = g.campaign_id
       WHERE cp.platform = $1 AND g.last_seen_at < now() - make_interval(days => $2)
         AND NOT EXISTS (SELECT 1 FROM ads a WHERE a.ad_group_id = g.id)
         AND NOT EXISTS (SELECT 1 FROM daily_metrics m WHERE m.ad_group_id = g.id AND m.date >= CURRENT_DATE - $2::int)`, [platform, days]);
    for (const sql of rollupSql('group', 'old_groups')) await c.query(sql);
    const groups = (await c.query('DELETE FROM ad_groups WHERE id IN (SELECT id FROM old_groups)')).rowCount ?? 0;
    return { ads, groups };
  });
  return { status: 'success', message: `${r.ads} anúncio(s) e ${r.groups} ${platform === 'google' ? 'grupo(s)' : 'conjunto(s)'} sem atividade há mais de ${days} dias removidos (métricas somadas no nível de cima)` };
}
