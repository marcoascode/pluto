/**
 * 0.18 · Etapa 3 — Orquestrador de publicação na Meta: Campanha → Conjunto de Anúncios → (Criativo → Anúncio) × N.
 *
 * - Usa o System User Token do Perfil escolhido (o token chega já decifrado; nunca é gravado nem logado).
 * - Cada etapa vira uma linha em meta_campaign_run_steps (status, id Meta, tentativas, rate limit, erro), atualizada em tempo real.
 * - Rate limit: chamada recusada por limite de uso é repetida com espera (withRateLimit); se esgotar, a etapa falha e o resto é pulado.
 * - Falha de rede/5xx numa criação NÃO é repetida (poderia duplicar objetos); fica registrada na etapa.
 * - Campanha/Conjunto falharam → nada útil foi criado: desfaz a campanha (DELETE) se rollback estiver ligado.
 *   Um anúncio falhar não derruba os demais: a execução fica "partial" com o detalhe de cada falha.
 * - Dataset (pixel) → promoted_object do Conjunto · Evento de Conversão → tracking_specs dos Anúncios (quando ativado).
 *   O evento pode ser padrão (custom_event_type), conversão personalizada (custom_conversion_id) ou evento personalizado
 *   do Pixel (custom_event_type OTHER + custom_event_str).
 */
import { one, q } from '../db.js';
import { HttpError } from '../lib/http.js';
import { graphDelete, graphPost, withRateLimit, type CallInfo } from './metaGraph.js';
import { sleep, SyncError } from './sync/http.js';

export const OBJECTIVES = ['OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT'] as const;
export const OPTIMIZATION_GOALS = ['LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'REACH'] as const;
/** Valores de custom_event_type aceitos pela Graph API para eventos padrão do Pixel (InitiateCheckout = INITIATED_CHECKOUT). */
export const CONVERSION_EVENTS = ['PURCHASE', 'LEAD', 'COMPLETE_REGISTRATION', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'ADD_PAYMENT_INFO', 'ADD_TO_WISHLIST', 'CONTENT_VIEW',
  'SEARCH', 'CONTACT', 'SCHEDULE', 'START_TRIAL', 'SUBMIT_APPLICATION', 'SUBSCRIBE', 'OTHER'] as const;
export const PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'] as const;

export interface AdSpec { name: string; imageHash: string; headline: string; primaryText: string; description: string; cta: string }

export interface PublishPlan {
  userId: string;
  profileId: string;
  token: string;
  accountId: string;
  site: string;
  source: 'manual' | 'ai';
  pageId: string;
  link: string;
  urlTags: string;
  rollbackOnFailure: boolean;
  campaign: { name: string; objective: string; status: 'PAUSED' | 'ACTIVE'; specialAdCategories: string[] };
  adset: {
    name: string; dailyBudgetMinor: number; optimizationGoal: string; countries: string[]; ageMin: number; ageMax: number;
    genders: number[] | null; publisherPlatforms: string[] | null; startTime: string | null; endTime: string | null;
  };
  /** Dataset (pixel) já conferido contra a conta. */
  tracking: {
    datasetId: string | null; linkToAdSet: boolean; linkToAds: boolean;
    /** Evento padrão (custom_event_type) — ou o tipo da conversão personalizada. */
    conversionEvent: string | null;
    customConversionId: string | null;
    /** Nome do evento personalizado do Pixel (fbq('trackCustom', nome)). */
    customEventName: string | null;
  };
  ads: AdSpec[];
}

type Kind = 'campaign' | 'adset' | 'creative' | 'ad' | 'rollback';
interface StepRow { id: string; seq: number; kind: Kind; label: string; status: string; metaId: string | null; attempts: number; rateLimited: boolean; errorHttp: number | null; errorMessage: string | null; startedAt: string | null; finishedAt: string | null }

const STEP_COLS = `id::text, seq, kind, label, status, meta_id AS "metaId", attempts, rate_limited AS "rateLimited", error_http AS "errorHttp", error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"`;
const RUN_COLS = `id::text, profile_id::text AS "profileId", ad_account_id AS "adAccountId", site, source, name, status, meta_campaign_id AS "metaCampaignId", meta_adset_id AS "metaAdsetId", error_message AS "error", created_at AS "createdAt", finished_at AS "finishedAt"`;

export async function loadRun(userId: string, runId: string) {
  const run = await one(`SELECT ${RUN_COLS} FROM meta_campaign_runs WHERE id = $1 AND user_id = $2`, [runId, userId]);
  if (!run) return null;
  return { ...run, steps: await q<StepRow>(`SELECT ${STEP_COLS} FROM meta_campaign_run_steps WHERE run_id = $1 ORDER BY seq`, [runId]) };
}
export const listRuns = (userId: string, limit = 30) => q(`SELECT ${RUN_COLS} FROM meta_campaign_runs WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [userId, limit]);

/** promoted_object do Conjunto: Pixel + evento padrão, conversão personalizada ou evento personalizado. */
export function promotedObject(t: PublishPlan['tracking']): Record<string, string> {
  const o: Record<string, string> = { pixel_id: t.datasetId! };
  if (t.customConversionId) { o.custom_conversion_id = t.customConversionId; if (t.conversionEvent) o.custom_event_type = t.conversionEvent; }
  else if (t.customEventName) { o.custom_event_type = 'OTHER'; o.custom_event_str = t.customEventName; }
  else if (t.conversionEvent) o.custom_event_type = t.conversionEvent;
  return o;
}

/** Uma publicação por Perfil por vez (evita duplicar a cascata com duplo clique e respeita o limite de uso do token). */
const running = new Set<string>();

const errText = (e: unknown) => (e instanceof SyncError ? e.message : (e as Error)?.message ?? 'Erro desconhecido.').slice(0, 500);
const pace = () => sleep(400);   // intervalo entre chamadas de escrita

export async function publishCampaign(plan: PublishPlan) {
  if (running.has(plan.profileId)) throw new HttpError(409, 'publish_in_progress', 'Já existe uma publicação em andamento neste Perfil. Aguarde terminar.');
  running.add(plan.profileId);
  try { return await run(plan); } finally { running.delete(plan.profileId); }
}

async function run(plan: PublishPlan) {
  const { token, accountId } = plan;
  const act = `act_${accountId}`;
  const { token: _t, ...safe } = plan;   // o payload gravado nunca leva o token
  const runRow = await one<{ id: string }>(
    `INSERT INTO meta_campaign_runs (user_id, profile_id, ad_account_id, site, source, name, payload) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
    [plan.userId, plan.profileId, accountId, plan.site, plan.source, plan.campaign.name, JSON.stringify(safe)]);
  const runId = runRow!.id;

  // plano de etapas visível desde o início (tudo "pending")
  const planned: { kind: Kind; label: string }[] = [{ kind: 'campaign', label: plan.campaign.name }, { kind: 'adset', label: plan.adset.name }];
  plan.ads.forEach((a) => { planned.push({ kind: 'creative', label: `Criativo · ${a.name}` }, { kind: 'ad', label: a.name }); });
  const ids: string[] = [];
  for (const [i, s] of planned.entries()) ids.push((await one<{ id: string }>(`INSERT INTO meta_campaign_run_steps (run_id, seq, kind, label) VALUES ($1, $2, $3, $4) RETURNING id::text`, [runId, i + 1, s.kind, s.label]))!.id);

  let aborted = false;   // limite de uso esgotado ou falha estrutural: o resto é pulado
  const skipRest = async (from: number) => { await q(`UPDATE meta_campaign_run_steps SET status = 'skipped' WHERE run_id = $1 AND seq >= $2 AND status = 'pending'`, [runId, from + 1]); };

  /** Executa uma etapa, registrando tentativas/rate limit/erro. Devolve o id Meta ou null se falhou. */
  async function step<T extends { id?: string }>(idx: number, call: () => Promise<T>): Promise<T | null> {
    const info: CallInfo = { attempts: 0, rateLimited: false };
    await q(`UPDATE meta_campaign_run_steps SET status = 'running', started_at = now() WHERE id = $1`, [ids[idx]]);
    try {
      const r = await withRateLimit(call, info, () => { void q(`UPDATE meta_campaign_run_steps SET rate_limited = true, attempts = $2 WHERE id = $1`, [ids[idx], info.attempts]).catch(() => {}); });
      await q(`UPDATE meta_campaign_run_steps SET status = 'ok', meta_id = $2, attempts = $3, rate_limited = $4, finished_at = now() WHERE id = $1`, [ids[idx], r.id ?? null, info.attempts, info.rateLimited]);
      return r;
    } catch (e) {
      const limitedOut = info.rateLimited && e instanceof SyncError;
      if (limitedOut) aborted = true;
      await q(`UPDATE meta_campaign_run_steps SET status = 'failed', attempts = $2, rate_limited = $3, error_http = $4, error_message = $5, finished_at = now() WHERE id = $1`,
        [ids[idx], info.attempts, info.rateLimited, e instanceof SyncError ? (e.http ?? null) : null, errText(e)]);
      console.error(`[meta-publish] run ${runId} etapa ${planned[idx].kind} falhou:`, errText(e));
      return null;
    } finally { await pace(); }
  }

  let campaignId: string | null = null, adsetId: string | null = null, okAds = 0;
  const failMsg: string[] = [];

  /* 1 · Campanha (orçamento no Conjunto) */
  const camp = await step(0, () => graphPost<{ id: string }>(token, `${act}/campaigns`, {
    name: plan.campaign.name, objective: plan.campaign.objective, status: plan.campaign.status, buying_type: 'AUCTION',
    special_ad_categories: plan.campaign.specialAdCategories, is_adset_budget_sharing_enabled: false,
  }));
  campaignId = camp?.id ?? null;

  /* 2 · Conjunto de anúncios (+ Dataset quando ativado) */
  if (campaignId) {
    const a = plan.adset, t = plan.tracking;
    const targeting: Record<string, unknown> = { geo_locations: { countries: a.countries }, age_min: a.ageMin, age_max: a.ageMax };
    if (a.genders) targeting.genders = a.genders;
    if (a.publisherPlatforms) targeting.publisher_platforms = a.publisherPlatforms;
    const body: Record<string, unknown> = {
      name: a.name, campaign_id: campaignId, daily_budget: a.dailyBudgetMinor, billing_event: 'IMPRESSIONS', optimization_goal: a.optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting, status: plan.campaign.status,
    };
    if (a.startTime) body.start_time = a.startTime;
    if (a.endTime) body.end_time = a.endTime;
    if (t.linkToAdSet && t.datasetId) body.promoted_object = promotedObject(t);
    const set = await step(1, () => graphPost<{ id: string }>(token, `${act}/adsets`, body));
    adsetId = set?.id ?? null;
    if (adsetId) await q(`UPDATE meta_campaign_runs SET meta_campaign_id = $2, meta_adset_id = $3 WHERE id = $1`, [runId, campaignId, adsetId]);
  } else { await skipRest(1); }

  /* 3 · Criativos + Anúncios (+ Evento de Conversão quando ativado) */
  if (campaignId && adsetId) {
    await q(`UPDATE meta_campaign_runs SET meta_campaign_id = $2 WHERE id = $1`, [runId, campaignId]);
    for (const [n, ad] of plan.ads.entries()) {
      const ci = 2 + n * 2, ai = ci + 1;
      if (aborted) { await skipRest(ci); break; }
      const creative = await step(ci, () => graphPost<{ id: string }>(token, `${act}/adcreatives`, {
        name: ad.name,
        object_story_spec: {
          page_id: plan.pageId,
          link_data: { image_hash: ad.imageHash, link: plan.link, message: ad.primaryText, name: ad.headline, description: ad.description, call_to_action: { type: ad.cta, value: { link: plan.link } } },
        },
        url_tags: plan.urlTags,
      }));
      if (!creative) { await q(`UPDATE meta_campaign_run_steps SET status = 'skipped' WHERE id = $1`, [ids[ai]]); continue; }
      const body: Record<string, unknown> = { name: ad.name, adset_id: adsetId, creative: { creative_id: creative.id }, status: plan.campaign.status };
      if (plan.tracking.linkToAds && plan.tracking.datasetId) body.tracking_specs = [{ 'action.type': ['offsite_conversion'], fb_pixel: [plan.tracking.datasetId] }];
      if ((await step(ai, () => graphPost<{ id: string }>(token, `${act}/ads`, body)))) okAds++;
    }
  } else if (campaignId) { await skipRest(2); }

  /* Resultado */
  const steps = await q<StepRow>(`SELECT ${STEP_COLS} FROM meta_campaign_run_steps WHERE run_id = $1 ORDER BY seq`, [runId]);
  for (const s of steps) if (s.status === 'failed') failMsg.push(`${s.label}: ${s.errorMessage}`);
  const status: 'success' | 'partial' | 'failed' = !campaignId || !adsetId || okAds === 0 ? 'failed' : failMsg.length || steps.some((s) => s.status === 'skipped') ? 'partial' : 'success';

  /* Sem nada utilizável → desfaz a campanha órfã (DELETE na campanha remove Conjunto/Anúncios filhos) */
  if (status === 'failed' && campaignId && plan.rollbackOnFailure) {
    const seq = steps.length + 1;
    const rid = (await one<{ id: string }>(`INSERT INTO meta_campaign_run_steps (run_id, seq, kind, label, status, started_at) VALUES ($1, $2, 'rollback', $3, 'running', now()) RETURNING id::text`, [runId, seq, `Desfazer campanha ${campaignId}`]))!.id;
    const info: CallInfo = { attempts: 0, rateLimited: false };
    try {
      await withRateLimit(() => graphDelete(token, campaignId!), info);
      await q(`UPDATE meta_campaign_run_steps SET status = 'ok', meta_id = $2, attempts = $3, rate_limited = $4, finished_at = now() WHERE id = $1`, [rid, campaignId, info.attempts, info.rateLimited]);
      campaignId = null; adsetId = null;
    } catch (e) {
      await q(`UPDATE meta_campaign_run_steps SET status = 'failed', attempts = $2, rate_limited = $3, error_message = $4, finished_at = now() WHERE id = $1`, [rid, info.attempts, info.rateLimited, errText(e)]);
      failMsg.push(`Não foi possível desfazer a campanha ${campaignId} (remova manualmente no Gerenciador): ${errText(e)}`);
    }
  }

  await q(`UPDATE meta_campaign_runs SET status = $2, error_message = $3, meta_campaign_id = $4, meta_adset_id = $5, finished_at = now() WHERE id = $1`,
    [runId, status, failMsg.length ? failMsg.join(' | ').slice(0, 1500) : null, campaignId, adsetId]);
  return (await loadRun(plan.userId, runId))!;
}
