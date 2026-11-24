/**
 * Mapeamento manual campanha → domínio (Admin/SuperAdmin).
 *
 *  GET   /admin/campaigns/unmapped?platform=meta&days=30
 *        Campanhas sem domínio: as que têm custo gravado no domínio técnico "Sem domínio" nos últimos N dias
 *        (são as do aviso "linhas sem domínio" da conta) e as ativas que ainda não têm domínio.
 *  PATCH /admin/campaigns/:id   { domain: "site.com" | null, platform?: "meta" | "google", resync?: true }
 *        :id = id da campanha na plataforma (o mesmo que /campaigns devolve). domain: null volta para o automático.
 *
 * Ao salvar:
 *  1. campaigns.domain_id = domínio escolhido, domain_manual = true (o sync não troca mais; vale sobre o link dos anúncios)
 *  2. reprocessamento do passado: as linhas já gravadas dessa campanha (inclusive as que estavam em "Sem domínio")
 *     mudam de domínio na hora, numa transação (somadas se caírem no mesmo grão)
 *  3. ressincroniza a janela do job de métricas da plataforma em segundo plano (meta.metrics / google-ads.metrics),
 *     para trazer o que ficou de fora antes da 0.9 (linhas descartadas nunca foram gravadas)
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { adminScope, assertAdminDomain } from '../../auth/scope.js';
import { addDays, today } from '../../lib/dates.js';
import { GRAIN_CONFLICT, METRIC_SUMS } from '../../services/sync/common.js';
import { requestRun } from '../../services/sync/index.js';
import { loadTimeline, siteForDay, type Timeline } from '../../services/accountLinks.js';

export const campaignsAdminRouter = Router();

const platform = z.enum(['meta', 'google']);
const SOURCE = { meta: 'meta', google: 'google-ads' } as const;
const JOB = { meta: 'meta.metrics', google: 'google-ads.metrics' } as const;

/** 0.18.11: Admin só nas contas ligadas aos domínios das Empresas em que é sócio (SuperAdmin: todas). */
async function adminAccounts(req: Request): Promise<string[] | null> {
  const sc = await adminScope(req);
  if (!sc) return null;
  return (await q<{ id: string }>('SELECT DISTINCT account_id::text AS id FROM domain_accounts WHERE domain_id = ANY($1::bigint[])', [sc.domainIds])).map((r) => r.id);
}

campaignsAdminRouter.get('/campaigns/unmapped', async (req, res) => {
  const p = parse(platform.default('meta'), req.query.platform ?? undefined);
  const accs = await adminAccounts(req);
  const days = Math.min(400, Math.max(1, Number(req.query.days) || 30));
  const from = addDays(today(), -days);
  const rows = await q<{ id: string; name: string; platform: string; status: string; accountId: string; accountName: string; spend: number; clicks: number; rows: number; firstDate: string | null; lastDate: string | null }>(`
    WITH tech AS (SELECT id FROM domains WHERE is_technical LIMIT 1),
    lost AS (
      SELECT m.campaign_id, sum(m.spend_brl + m.iva_brl)::float AS spend, sum(m.traffic_clicks)::bigint AS clicks,
             count(*)::int AS rows, min(m.date)::text AS "firstDate", max(m.date)::text AS "lastDate"
        FROM daily_metrics m WHERE m.domain_id = (SELECT id FROM tech) AND m.source = $2 AND m.date >= $3 GROUP BY m.campaign_id)
    SELECT c.external_id AS id, c.name, c.platform, c.status, a.id::text AS "accountId", a.name AS "accountName",
           COALESCE(l.spend, 0) AS spend, COALESCE(l.clicks, 0)::int AS clicks, COALESCE(l.rows, 0) AS rows, l."firstDate", l."lastDate"
      FROM campaigns c JOIN integration_accounts a ON a.id = c.account_id
      LEFT JOIN lost l ON l.campaign_id = c.id
     WHERE c.platform = $1 AND c.domain_id IS NULL AND c.status <> 'REMOVED' AND (l.campaign_id IS NOT NULL OR c.status = 'ENABLED')
       ${accs ? 'AND c.account_id = ANY($4::bigint[])' : ''}
     ORDER BY COALESCE(l.spend, 0) DESC, c.name`, accs ? [p, SOURCE[p], from, accs] : [p, SOURCE[p], from]);
  const totals = rows.reduce((acc, r) => ({ spend: acc.spend + r.spend, rows: acc.rows + r.rows }), { spend: 0, rows: 0 });
  res.json({ platform: p, days, campaigns: rows, totals });
});

const patchBody = z.object({
  platform: platform.default('meta'),
  domain: z.string().trim().toLowerCase().max(190).nullable().optional(),
  domainId: z.string().regex(/^\d+$/).nullable().optional(),
  resync: z.boolean().default(true),
}).refine((b) => b.domain !== undefined || b.domainId !== undefined, { message: 'informe domain (hostname) ou domainId' });

/** Períodos [de, até) em que o vínculo com data da conta manda a despesa para outro site que não `target`. */
function lockedRanges(tl: Timeline, accountId: string, target: string): [string, string | null][] {
  const list = tl.get(accountId) ?? [];
  return list.map((p, i): [string, string | null, boolean] => [p.from, list[i + 1]?.from ?? null, siteForDay(tl, accountId, p.from, target) !== target])
    .filter((x) => x[2]).map(([a, z]) => [a, z]);
}

campaignsAdminRouter.patch('/campaigns/:id', async (req, res) => {
  const ext = parse(z.string().trim().min(1).max(40), req.params.id);
  const b = parse(patchBody, req.body);
  const camp = await one<{ id: string; name: string; account_id: string }>('SELECT id::text, name, account_id::text FROM campaigns WHERE platform = $1 AND external_id = $2', [b.platform, ext]);
  if (!camp) throw notFound('Campanha não encontrada.');
  const accs = await adminAccounts(req);
  if (accs && !accs.includes(camp.account_id)) throw new HttpError(403, 'forbidden', 'Esta campanha é de uma conta fora das Empresas em que você é sócio.');
  // domínio de destino (null = volta para o automático)
  let target: { id: string; hostname: string; is_technical: boolean; active: boolean } | null = null;
  const wanted = b.domainId ?? b.domain;
  if (wanted) {
    target = await one<{ id: string; hostname: string; is_technical: boolean; active: boolean }>(
      `SELECT id::text, hostname, is_technical, active FROM domains WHERE ${b.domainId ? 'id = $1' : 'hostname = $1'}`, [wanted]);
    if (!target) throw notFound('Domínio não encontrado.');
    if (target.is_technical) throw conflict('technical_domain', 'Escolha um site: "Sem domínio" é o destino automático de quem não tem domínio.');
    if (!target.active) throw conflict('domain_inactive', 'Este domínio está inativo. Ative em Domínios antes de usar.');
    await assertAdminDomain(req, target.id);
  }
  const moved = await tx(async (c) => {
    await c.query(`UPDATE campaigns SET domain_id = $2, domain_manual = $3, domain_set_by = $4, domain_set_at = now(), updated_at = now() WHERE id = $1`,
      [camp.id, target?.id ?? null, !!target, req.user!.id]);
    if (!target) return 0;
    // Reprocessamento do passado: move as linhas dessa campanha (desta origem) que estão em outro domínio.
    // url_id zera (a URL era do domínio antigo). Linhas que caem no mesmo grão são somadas.
    const sums = METRIC_SUMS.map((x) => `SUM(${x})`).join(', ');
    // 0.17: dias em que a conta estava vinculada a OUTRO site (vínculo com data) não mudam: aquela despesa é do site
    // daquela época (ex.: site penalizado, conta trocada de site em uma data)
    const keep = lockedRanges(await loadTimeline([camp.account_id], c), camp.account_id, target.id);
    const notIn = keep.map(([a, z]) => `AND NOT (date >= '${a}'::date${z ? ` AND date < '${z}'::date` : ''})`).join(' ');
    const r = await c.query(`
      WITH moved AS (
        DELETE FROM daily_metrics WHERE campaign_id = $1 AND source = $2 AND domain_id <> $3 ${notIn} RETURNING *)
      INSERT INTO daily_metrics (source, date, domain_id, url_id, platform, campaign_id, ad_group_id, ad_id, country, unattributed_reason, utm_source, ${METRIC_SUMS.join(', ')}, sessions, is_final, updated_at)
      SELECT source, date, $3::bigint, NULL::bigint, platform, campaign_id, ad_group_id, ad_id, country, unattributed_reason, utm_source, ${sums}, SUM(sessions)::int, bool_and(is_final), now()
        FROM moved GROUP BY source, date, platform, campaign_id, ad_group_id, ad_id, country, unattributed_reason, utm_source
      ON CONFLICT ${GRAIN_CONFLICT} DO UPDATE SET ${[...METRIC_SUMS, 'sessions'].map((x) => `${x} = daily_metrics.${x} + EXCLUDED.${x}`).join(', ')}, updated_at = now()`,
      [camp.id, SOURCE[b.platform], target.id]);
    return r.rowCount ?? 0;
  });
  const resync = target && b.resync ? requestRun(JOB[b.platform]) : null;
  if (target && b.resync && b.platform === 'google') requestRun('google-ads.placements');   // placements do Google usam o domínio da campanha
  res.json({
    campaign: { id: ext, platform: b.platform, name: camp.name, domain: target?.hostname ?? null, domainManual: !!target },
    movedRows: moved,
    resync,   // 'started' | 'queued' (o job já rodava: roda de novo ao terminar) | null
  });
});
