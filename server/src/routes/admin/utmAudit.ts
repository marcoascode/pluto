/**
 * 0.18 · Auditoria do sufixo de UTM dos anúncios Meta (Admin → UTMs).
 *
 *  GET /admin/utm-audit/meta?days=7
 *      Anúncios Meta ativos (ou com custo nos últimos N dias) de contas importadas, comparados com o template Meta
 *      (app_settings.utm_templates.meta). Anúncio sem o sufixo não leva utm_campaign/utm_content ao site, e a receita
 *      dele no Ad Manager vira "sem campanha" (missing_campaign_id): não dá para recuperar depois.
 *      ads.url_tags vem do sync de estrutura da Meta (creative.url_tags); NULL = ainda não lido.
 *      Devolve só os anúncios fora do padrão (os ok entram apenas na contagem).
 */
import { Router } from 'express';
import { q } from '../../db.js';
import { addDays, today } from '../../lib/dates.js';
import { auditMetaTags, utmTemplates, type MetaTagStatus } from '../../services/utm.js';

export const utmAuditRouter = Router();

/** effective_status da Meta que ainda entregam (ou vão entregar) o anúncio. */
const LIVE = ['ACTIVE', 'PENDING_REVIEW', 'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES'];

utmAuditRouter.get('/utm-audit/meta', async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const from = addDays(today(), -days);
  const template = (await utmTemplates()).meta.trim();
  const rows = await q<{ id: string; name: string; status: string | null; link: string | null; urlTags: string | null; adset: string; campaignId: string; campaignName: string;
    accountId: string; accountName: string; managers: string | null; domain: string | null; spend: number }>(`
    WITH s AS (
      SELECT m.ad_id, sum(m.spend_usd + m.iva_usd)::float AS spend
        FROM daily_metrics m WHERE m.source = 'meta' AND m.date >= $2 AND m.ad_id IS NOT NULL GROUP BY m.ad_id),
    mg AS (
      SELECT ma.account_id, string_agg(DISTINCT u.name, ', ' ORDER BY u.name) AS names
        FROM manager_accounts ma JOIN users u ON u.id = ma.user_id GROUP BY ma.account_id)
    SELECT a.external_id AS id, a.name, a.status, a.final_url AS link, a.url_tags AS "urlTags", g.name AS adset,
           c.external_id AS "campaignId", c.name AS "campaignName", acc.id::text AS "accountId", acc.name AS "accountName",
           mg.names AS managers, CASE WHEN d.is_technical THEN NULL ELSE d.hostname END AS domain, COALESCE(s.spend, 0) AS spend
      FROM ads a
      JOIN ad_groups g ON g.id = a.ad_group_id
      JOIN campaigns c ON c.id = g.campaign_id
      JOIN integration_accounts acc ON acc.id = c.account_id
      LEFT JOIN domains d ON d.id = c.domain_id
      LEFT JOIN s ON s.ad_id = a.id
      LEFT JOIN mg ON mg.account_id = acc.id
     WHERE c.platform = 'meta' AND acc.imported
       AND (COALESCE(s.spend, 0) > 0 OR (a.status = ANY($1::text[]) AND c.status = 'ENABLED' AND a.last_seen_at >= now() - interval '7 days'))
     ORDER BY COALESCE(s.spend, 0) DESC, c.name, a.name`, [LIVE, from]);
  const totals: Record<MetaTagStatus, number> & { spendAtRisk: number } = { ok: 0, missing: 0, different: 0, unread: 0, spendAtRisk: 0 };
  const ads = [];
  for (const r of rows) {
    const a = auditMetaTags(r.link, r.urlTags, template);
    totals[a.status]++;
    if (a.status === 'ok') continue;
    if (a.status === 'missing' || (a.status === 'different' && !a.attributable)) totals.spendAtRisk += r.spend;
    const { link: _l, ...rest } = r;
    ads.push({ ...rest, status: a.status, params: a.params, attributable: a.attributable });
  }
  res.json({ template, days, totals, ads });
});
