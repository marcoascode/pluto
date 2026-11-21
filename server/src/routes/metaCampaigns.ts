/**
 * 0.18 · Etapa 3 — Upload de criativos e publicação de campanhas na Meta.
 * Montado dentro do metaRouter, que já está atrás de requireMetaCampaigns (flag can_create_meta_campaigns,
 * atribuída só pelo SuperAdmin) — nenhuma rota daqui é alcançável sem a flag. Todo Perfil é filtrado por user_id.
 *
 * Criativos: multer.memoryStorage (nunca grava em disco). Cada arquivo vai do buffer direto para
 * /act_{id}/adimages; a resposta devolve só o image_hash e o buffer é descartado ao fim da requisição.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, q } from '../db.js';
import { decrypt } from '../lib/crypto.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { scope } from '../auth/scope.js';
import { CTAS, LIMITS } from '../services/metaCopies.js';
import { advertiseProblem, getAdAccountInfo, getCustomConversion, listCustomConversions, listPixelCustomEvents, PERMISSION_HINT, toHttpError, uploadAdImage, withRateLimit } from '../services/metaGraph.js';
import { hasSyncedAsset } from '../services/metaProfiles.js';
import { CONVERSION_EVENTS, OBJECTIVES, OPTIMIZATION_GOALS, PLATFORMS, listRuns, loadRun, publishCampaign, type AdSpec } from '../services/metaPublish.js';
import { buildMetaTrackedUrl } from '../services/utm.js';

export const metaCampaignsRouter = Router();

const ID = z.string().regex(/^\d+$/, 'id inválido');
const ACCOUNT = z.string().regex(/^(act_)?\d+$/, 'adAccountId inválido').transform((v) => v.replace(/^act_/, ''));
const HASH = z.string().regex(/^[a-f0-9]{32}$/i, 'image_hash inválido');

interface Owned { id: string; businessId: string | null; token: string }
/** Perfil do próprio usuário, com token utilizável (não recusado e não vencido). */
async function ownProfile(req: Request): Promise<Owned> {
  const r = await one<{ id: string; business_id: string | null; token_enc: Buffer; status: string; expired: boolean }>(
    `SELECT id::text, business_id, token_enc, status, (token_expires_at IS NOT NULL AND token_expires_at <= now()) AS expired
       FROM meta_profiles WHERE id = $1 AND user_id = $2`, [parse(ID, req.params.id), req.user!.id]);
  if (!r) throw notFound('Perfil não encontrado.');
  if (r.expired) throw new HttpError(422, 'profile_expired', 'O token deste Perfil venceu. Clique em "Reconectar / Renovar" em Perfis & BMs.');
  if (r.status === 'invalid') throw new HttpError(422, 'profile_invalid', 'O token deste Perfil foi recusado pela Meta ou está sem permissões. Reconecte o Perfil em Perfis & BMs.');
  return { id: r.id, businessId: r.business_id, token: decrypt(r.token_enc) };
}

/** A conta de anúncios precisa estar atribuída ao gestor (mesma regra das listagens da Etapa 1). */
async function assertAccount(req: Request, accountId: string) {
  const ok = await one(`SELECT 1 FROM manager_accounts ma JOIN integration_accounts a ON a.id = ma.account_id WHERE ma.user_id = $1 AND a.provider = 'meta' AND a.external_id = $2`, [req.user!.id, accountId]);
  if (!ok) throw notFound('Conta de anúncios não atribuída a você.');
}

/* ---------------- 1 · upload de criativos (memória → Meta) ---------------- */
const MAX_FILES = 20, MAX_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: MAX_FILES, fileSize: MAX_BYTES, fields: 5, parts: MAX_FILES + 5 } }).array('images', MAX_FILES);

/** Tipo real pelo conteúdo (não confia no mimetype/extensão enviados pelo cliente). */
function sniff(b: Buffer): 'jpg' | 'png' | 'gif' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return 'gif';
  return null;
}

function receive(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const m: Record<string, string> = { LIMIT_FILE_SIZE: `Cada imagem pode ter no máximo ${MAX_BYTES / 1024 / 1024} MB.`, LIMIT_FILE_COUNT: `Envie no máximo ${MAX_FILES} imagens por vez.`, LIMIT_UNEXPECTED_FILE: 'Envie as imagens no campo "images".' };
      return next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422, 'upload_invalid', m[err.code] ?? 'Upload inválido.'));
    }
    next(err);
  });
}

/**
 * multipart/form-data: campo "images" (1..20 arquivos jpg/png/gif) + ?adAccountId=. Sobe uma imagem por vez (isola falhas, respeita o
 * limite de uso) e devolve o image_hash de cada uma. Resposta 200 mesmo com falhas parciais: confira `failed`.
 */
metaCampaignsRouter.post('/profiles/:id/creatives', receive, async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const acc = parse(ACCOUNT, req.query.adAccountId);
    const p = await ownProfile(req);
    await assertAccount(req, acc);
    if (!files.length) throw new HttpError(422, 'no_files', 'Envie ao menos uma imagem no campo "images".');

    // pré-checagem: sem o acesso "Gerenciar campanhas" na conta a Meta só responde "(#200) Permissions error" a cada imagem
    const info = await getAdAccountInfo(p.token, acc).catch(() => null);
    if (info) {
      if (info.status === 2) throw new HttpError(422, 'ad_account_disabled', 'A conta de anúncios está desativada na Meta.');
      const problem = advertiseProblem(info, acc);
      if (problem) throw new HttpError(422, 'meta_no_advertise', problem);
    }

    const uploaded: { index: number; filename: string; imageHash: string; url: string | null; bytes: number }[] = [];
    const failed: { index: number; filename: string; code: string; message: string }[] = [];
    for (const [i, f] of files.entries()) {
      const filename = (f.originalname || `imagem-${i + 1}`).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
      const type = sniff(f.buffer);
      if (!type) { failed.push({ index: i, filename, code: 'invalid_type', message: 'Formato não suportado (use JPG, PNG ou GIF).' }); continue; }
      try {
        const r = await withRateLimit(() => uploadAdImage(p.token, acc, f.buffer, /\.(jpe?g|png|gif)$/i.test(filename) ? filename : `${filename}.${type}`), { attempts: 0, rateLimited: false });
        uploaded.push({ index: i, filename, imageHash: r.hash, url: r.url, bytes: f.size });
      } catch (e) {
        const he = toHttpError(e);
        failed.push({ index: i, filename, code: he.code, message: he.code === 'meta_permission' ? `${he.message} — ${PERMISSION_HINT}` : he.message });
      }
    }
    res.json({ adAccountId: acc, uploaded, failed });
  } finally {
    // descarta os buffers (nada foi gravado em disco; isto só libera a memória sem esperar o GC)
    for (const f of files) (f as { buffer?: Buffer }).buffer = undefined;
    req.files = undefined;
  }
});

/* ---------------- 1b · eventos de conversão do Pixel ---------------- */
/**
 * ?adAccountId=&datasetId= → eventos que podem ser escolhidos em "Evento do Pixel", como no campo "Evento de conversão" do
 * Gerenciador de Anúncios: conversões personalizadas da conta ligadas ao Pixel e eventos personalizados que o Pixel recebeu
 * nos últimos 60 dias (os eventos padrão são fixos e ficam no cliente). Cada leitura falha isolada (vira aviso).
 */
metaCampaignsRouter.get('/profiles/:id/conversion-events', async (req, res) => {
  const acc = parse(ACCOUNT, req.query.adAccountId);
  const datasetId = parse(ID, req.query.datasetId);
  const p = await ownProfile(req);
  await assertAccount(req, acc);
  const found = await hasSyncedAsset(p.id, 'dataset', datasetId);
  if (!found || !((found.data.businessIds ?? []).length > 0 || (found.data.adAccountIds ?? []).includes(acc))) throw notFound('Dataset não encontrado entre os ativos sincronizados deste Perfil.');

  const warnings: string[] = [];
  const [conversions, events] = await Promise.all([
    listCustomConversions(p.token, acc).catch((e) => { warnings.push(`Conversões personalizadas: ${toHttpError(e).message}`); return []; }),
    listPixelCustomEvents(p.token, datasetId).catch((e) => { warnings.push(`Eventos personalizados do Pixel: ${toHttpError(e).message}`); return []; }),
  ]);
  res.json({
    customConversions: conversions.filter((c) => !c.archived && (!c.pixelId || c.pixelId === datasetId)).map((c) => ({ id: c.id, name: c.name, eventType: c.eventType }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    customEvents: events,
    warnings,
  });
});

/* ---------------- 2 · publicação em cascata ---------------- */
const copySchema = z.object({
  angle: z.string().trim().max(80).optional(),   // vem das variações da IA; só informativo
  headline: z.string().trim().min(1).max(LIMITS.headline),
  primaryText: z.string().trim().min(1).max(LIMITS.primaryText),
  description: z.string().trim().max(LIMITS.description).default(''),
  cta: z.enum(CTAS).default('LEARN_MORE'),
});

/** Saída de GET /meta/campaign-suggestion (Etapa 2): campos usados como padrão quando source = "ai". */
const suggestionSchema = z.object({
  objective: z.object({ value: z.enum(OBJECTIVES), optimizationGoal: z.enum(OPTIMIZATION_GOALS) }),
  dailyBudget: z.object({ usd: z.number().positive().nullable(), brl: z.number().positive().nullable() }),
  audience: z.object({ countries: z.array(z.object({ code: z.string().regex(/^[A-Z]{2}$/) })).max(50), ageMin: z.number().int(), ageMax: z.number().int(), genders: z.enum(['all', 'male', 'female']).optional() }),
});

const publishBody = z.object({
  adAccountId: ACCOUNT,
  pageId: ID,
  site: z.string().trim().toLowerCase().min(3).max(253),
  url: z.string().max(2000),
  /** manual: parâmetros abaixo · ai: usa `suggestion` (Etapa 2) como padrão; o que vier em campaign/adset prevalece. */
  source: z.enum(['manual', 'ai']).default('manual'),
  suggestion: suggestionSchema.optional(),
  campaign: z.object({
    name: z.string().trim().min(2).max(200).optional(),
    objective: z.enum(OBJECTIVES).optional(),
    status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED'),
    specialAdCategories: z.array(z.enum(['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'])).max(4).default([]),
  }).default({ status: 'PAUSED', specialAdCategories: [] }),
  adset: z.object({
    name: z.string().trim().min(2).max(200).optional(),
    /** Em unidades da moeda da conta (ex.: 50 = R$ 50,00/dia). */
    dailyBudget: z.number().positive().max(1_000_000).optional(),
    optimizationGoal: z.enum(OPTIMIZATION_GOALS).optional(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(50).optional(),
    ageMin: z.number().int().min(18).max(65).optional(),
    ageMax: z.number().int().min(18).max(65).optional(),
    genders: z.enum(['all', 'male', 'female']).optional(),
    publisherPlatforms: z.array(z.enum(PLATFORMS)).min(1).optional(),   // omitido = posicionamentos automáticos
    startTime: z.string().datetime({ offset: true }).optional(),
    endTime: z.string().datetime({ offset: true }).optional(),
  }).default({}),
  tracking: z.object({
    /** Dataset (pixel) da Meta. */
    datasetId: ID.optional(),
    /** Vincula o Dataset ao Conjunto de Anúncios (promoted_object). */
    linkDatasetToAdSet: z.boolean().default(false),
    /** Evento de conversão a otimizar/rastrear (obrigatório em OFFSITE_CONVERSIONS): um evento padrão, OU uma conversão
     *  personalizada (customConversionId), OU um evento personalizado do Pixel (customEventName). */
    conversionEvent: z.enum(CONVERSION_EVENTS).optional(),
    customConversionId: ID.optional(),
    customEventName: z.string().trim().min(1).max(100).regex(/^[\w\- .:]+$/, 'customEventName: use letras, números, espaço, _ - . :').optional(),
    /** Vincula o Pixel/Evento de Conversão a cada Anúncio (tracking_specs). */
    linkPixelToAds: z.boolean().default(false),
  }).default({ linkDatasetToAdSet: false, linkPixelToAds: false })
    .refine((t) => [t.conversionEvent, t.customConversionId, t.customEventName].filter(Boolean).length <= 1, 'tracking: escolha só um evento (padrão, conversão personalizada ou evento personalizado).'),
  imageHashes: z.array(HASH).min(1).max(20),
  /** Copies manuais ou `variations` de POST /meta/copies/generate. */
  copies: z.array(copySchema).min(1).max(20),
  /** zip: copy i usa a imagem i (cicla) · cross: todas as combinações imagem × copy. */
  pairing: z.enum(['zip', 'cross']).default('zip'),
  rollbackOnFailure: z.boolean().default(true),
});

/** Moedas sem casas decimais na Graph API (valor já é a unidade mínima). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'PYG', 'UGX', 'XAF', 'XOF', 'XPF', 'KMF', 'DJF', 'GNF', 'RWF', 'VUV']);

metaCampaignsRouter.post('/profiles/:id/campaigns/publish', async (req, res) => {
  const b = parse(publishBody, req.body);
  const p = await ownProfile(req);
  await assertAccount(req, b.adAccountId);
  if (b.source === 'ai' && !b.suggestion) throw new HttpError(422, 'invalid_input', 'suggestion: obrigatório quando source = "ai" (use a resposta de /meta/campaign-suggestion).');

  // site no escopo do usuário + URL de destino do próprio site com o template de UTM do Pluto
  const sc = await scope(req, b.site);
  const hostname = sc.hosts[0];
  const tracked = await buildMetaTrackedUrl(b.url, hostname);

  // pré-checagens (falham antes de criar qualquer coisa): conta ativa na Meta + Página/Dataset entre os ativos sincronizados do Perfil
  const info = await getAdAccountInfo(p.token, b.adAccountId).catch((e) => { throw toHttpError(e); });
  if (info.status === 2) throw new HttpError(422, 'ad_account_disabled', 'A conta de anúncios está desativada na Meta.');
  const problem = advertiseProblem(info, b.adAccountId);
  if (problem) throw new HttpError(422, 'meta_no_advertise', problem);
  if (!(await hasSyncedAsset(p.id, 'page', b.pageId))) throw new HttpError(422, 'page_not_found', 'A Página escolhida não está entre os ativos sincronizados deste Perfil. Clique em "Sincronizar Ativos".');

  const t = b.tracking;
  const wantsDataset = t.linkDatasetToAdSet || t.linkPixelToAds;
  if (wantsDataset && !t.datasetId) throw new HttpError(422, 'invalid_input', 'tracking.datasetId: obrigatório para vincular Dataset/Pixel.');
  if (t.datasetId && wantsDataset) {
    const found = await hasSyncedAsset(p.id, 'dataset', t.datasetId);
    const usable = found && ((found.data.businessIds ?? []).length > 0 || (found.data.adAccountIds ?? []).includes(b.adAccountId));
    if (!found || !usable) throw new HttpError(422, 'dataset_not_found', 'O Dataset escolhido não está disponível para esta conta de anúncios. Sincronize os ativos do Perfil.');
    if (found.data.unavailable) throw new HttpError(422, 'dataset_unavailable', 'O Dataset escolhido está indisponível na Meta.');
  }

  // parâmetros finais: manual > sugestão da IA > padrão
  const s = b.source === 'ai' ? b.suggestion : undefined;
  const objective = b.campaign.objective ?? s?.objective.value ?? 'OUTCOME_TRAFFIC';
  const optimizationGoal = b.adset.optimizationGoal ?? s?.objective.optimizationGoal ?? 'LANDING_PAGE_VIEWS';
  const hasEvent = !!(t.conversionEvent || t.customConversionId || t.customEventName);
  if (optimizationGoal === 'OFFSITE_CONVERSIONS' && (!t.linkDatasetToAdSet || !t.datasetId || !hasEvent))
    throw new HttpError(422, 'invalid_input', 'adset.optimizationGoal OFFSITE_CONVERSIONS exige tracking.datasetId, tracking.linkDatasetToAdSet = true e o evento de conversão.');
  if ((t.customConversionId || t.customEventName) && !t.datasetId) throw new HttpError(422, 'invalid_input', 'tracking.datasetId: obrigatório para usar um evento personalizado.');

  // conversão personalizada: precisa existir, estar ativa e pertencer ao Pixel escolhido; o tipo dela vai no promoted_object
  let conversionEvent: string | null = t.conversionEvent ?? null;
  if (t.customConversionId) {
    const cc = await getCustomConversion(p.token, t.customConversionId).catch((e) => { throw toHttpError(e); });
    if (cc.archived) throw new HttpError(422, 'custom_conversion_archived', `A conversão personalizada "${cc.name}" está arquivada na Meta.`);
    if (cc.pixelId && cc.pixelId !== t.datasetId) throw new HttpError(422, 'custom_conversion_pixel', `A conversão personalizada "${cc.name}" pertence a outro Pixel (${cc.pixelId}). Escolha o Dataset dela.`);
    conversionEvent = cc.eventType;
  }

  let budget = b.adset.dailyBudget;
  if (budget === undefined && s) budget = (info.currency === 'BRL' ? s.dailyBudget.brl : info.currency === 'USD' ? s.dailyBudget.usd : null) ?? undefined;
  if (budget === undefined) throw new HttpError(422, 'invalid_input', `adset.dailyBudget: informe o orçamento diário${s ? ` (a sugestão da IA só cobre BRL/USD; a conta usa ${info.currency ?? 'moeda desconhecida'})` : ''}.`);
  const dailyBudgetMinor = Math.round(budget * (info.currency && ZERO_DECIMAL.has(info.currency) ? 1 : 100));

  const countries = [...new Set(b.adset.countries ?? s?.audience.countries.map((c) => c.code) ?? [])];
  if (!countries.length) throw new HttpError(422, 'invalid_input', 'adset.countries: informe ao menos um país.');
  const ageMin = b.adset.ageMin ?? s?.audience.ageMin ?? 18, ageMax = b.adset.ageMax ?? s?.audience.ageMax ?? 65;
  if (ageMin > ageMax) throw new HttpError(422, 'invalid_input', 'adset.ageMin não pode ser maior que ageMax.');
  const g = b.adset.genders ?? s?.audience.genders ?? 'all';
  if (b.adset.startTime && b.adset.endTime && Date.parse(b.adset.endTime) <= Date.parse(b.adset.startTime)) throw new HttpError(422, 'invalid_input', 'adset.endTime precisa ser depois de startTime.');

  const stamp = new Date().toISOString().slice(0, 10);
  const name = b.campaign.name ?? `${hostname} · ${objective.replace('OUTCOME_', '')} · ${stamp}`;

  // Nomenclatura: "(Cj.N) <nome>" no Conjunto e "(Cj.N / Ad.M) <nome>" nos anúncios.
  // A numeração dos anúncios (Ad.M) é contínua entre conjuntos — não reinicia em cada Cj. — para facilitar a contagem do gestor.
  // Hoje cada publicação cria um único Conjunto (Cj.1).
  const adsetNo = 1;
  const adsetName = `(Cj.${adsetNo}) ${b.adset.name ?? name}`;

  // anúncios = imagens × copies
  const ads: AdSpec[] = [];
  const mk = (img: string, c: z.infer<typeof copySchema>) => ads.push({ name: `(Cj.${adsetNo} / Ad.${ads.length + 1}) ${name}`, imageHash: img.toLowerCase(), headline: c.headline, primaryText: c.primaryText, description: c.description, cta: c.cta });
  if (b.pairing === 'cross') for (const img of b.imageHashes) for (const c of b.copies) mk(img, c);
  else for (let i = 0; i < Math.max(b.imageHashes.length, b.copies.length); i++) mk(b.imageHashes[i % b.imageHashes.length], b.copies[i % b.copies.length]);
  if (ads.length > 50) throw new HttpError(422, 'too_many_ads', 'No máximo 50 anúncios por publicação.');

  const run = await publishCampaign({
    userId: req.user!.id, profileId: p.id, token: p.token, accountId: b.adAccountId, site: hostname, source: b.source,
    pageId: b.pageId, link: tracked.link, urlTags: tracked.urlTags, rollbackOnFailure: b.rollbackOnFailure,
    campaign: { name, objective, status: b.campaign.status, specialAdCategories: b.campaign.specialAdCategories },
    adset: {
      name: adsetName, dailyBudgetMinor, optimizationGoal, countries, ageMin, ageMax,
      genders: g === 'male' ? [1] : g === 'female' ? [2] : null, publisherPlatforms: b.adset.publisherPlatforms ?? null,
      startTime: b.adset.startTime ?? null, endTime: b.adset.endTime ?? null,
    },
    tracking: {
      datasetId: t.datasetId ?? null, linkToAdSet: t.linkDatasetToAdSet, linkToAds: t.linkPixelToAds,
      conversionEvent, customConversionId: t.customConversionId ?? null, customEventName: t.customEventName ?? null,
    },
    ads,
  });
  if (run.status === 'failed') return void res.status(502).json({ error: { code: 'publish_failed', message: run.error ?? 'A publicação falhou.' }, run });
  res.status(201).json({ run });
});

/* ---------------- 3 · histórico de publicações (só do próprio usuário) ---------------- */
metaCampaignsRouter.get('/campaigns/runs', async (req, res) => {
  res.json({ runs: await listRuns(req.user!.id, parse(z.coerce.number().int().min(1).max(100).default(30), req.query.limit)) });
});
metaCampaignsRouter.get('/campaigns/runs/:runId', async (req, res) => {
  const run = await loadRun(req.user!.id, parse(ID, req.params.runId));
  if (!run) throw notFound('Publicação não encontrada.');
  res.json({ run });
});

/* ---------------- 4 · campanhas pendentes de envio (rascunhos) ---------------- */
/**
 * Estado do assistente salvo antes do envio. Fica listado como pendente até a campanha ser criada na Meta (o cliente exclui
 * o rascunho) — se o envio falhar ou a página for fechada no meio, ele continua aqui para editar, reenviar ou excluir.
 * Imagens nunca são guardadas: o estado só leva o image_hash/URL das que já subiram para a biblioteca da conta na Meta.
 */
const DRAFT_COLS = `id::text, profile_id::text AS "profileId", ad_account_id AS "adAccountId", site, name, status, last_error AS "lastError",
  last_run_id::text AS "lastRunId", created_at AS "createdAt", updated_at AS "updatedAt",
  COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(state->'copies') = 'array' THEN state->'copies' END), 0) AS "copies",
  COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(state->'images') = 'array' THEN state->'images' END), 0) AS "images"`;
const MAX_STATE_BYTES = 256 * 1024;

const draftBody = z.object({
  name: z.string().trim().min(1).max(200),
  profileId: ID.nullish(),
  adAccountId: ACCOUNT.nullish(),
  site: z.string().trim().toLowerCase().max(253).nullish(),
  status: z.enum(['draft', 'pending', 'failed']).default('draft'),
  lastError: z.string().max(2000).nullish(),
  lastRunId: ID.nullish(),
  state: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= MAX_STATE_BYTES, 'state: grande demais.'),
});

async function draftValues(req: Request) {
  const b = parse(draftBody, req.body);
  if (b.profileId && !(await one('SELECT 1 FROM meta_profiles WHERE id = $1 AND user_id = $2', [b.profileId, req.user!.id]))) throw notFound('Perfil não encontrado.');
  if (b.lastRunId && !(await one('SELECT 1 FROM meta_campaign_runs WHERE id = $1 AND user_id = $2', [b.lastRunId, req.user!.id]))) throw notFound('Publicação não encontrada.');
  return [b.profileId ?? null, b.adAccountId ?? null, b.site || null, b.name, b.status, b.lastError ?? null, b.lastRunId ?? null, JSON.stringify(b.state)];
}

metaCampaignsRouter.get('/campaigns/drafts', async (req, res) => {
  res.json({ drafts: await q(`SELECT ${DRAFT_COLS} FROM meta_campaign_drafts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [req.user!.id]) });
});
metaCampaignsRouter.get('/campaigns/drafts/:draftId', async (req, res) => {
  const d = await one(`SELECT ${DRAFT_COLS}, state FROM meta_campaign_drafts WHERE id = $1 AND user_id = $2`, [parse(ID, req.params.draftId), req.user!.id]);
  if (!d) throw notFound('Campanha pendente não encontrada.');
  res.json({ draft: d });
});
metaCampaignsRouter.post('/campaigns/drafts', async (req, res) => {
  const v = await draftValues(req);
  const d = await one(`INSERT INTO meta_campaign_drafts (user_id, profile_id, ad_account_id, site, name, status, last_error, last_run_id, state)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${DRAFT_COLS}`, [req.user!.id, ...v]);
  res.status(201).json({ draft: d });
});
metaCampaignsRouter.put('/campaigns/drafts/:draftId', async (req, res) => {
  const id = parse(ID, req.params.draftId);
  const v = await draftValues(req);
  const d = await one(`UPDATE meta_campaign_drafts SET profile_id = $3, ad_account_id = $4, site = $5, name = $6, status = $7, last_error = $8, last_run_id = $9, state = $10, updated_at = now()
                        WHERE id = $1 AND user_id = $2 RETURNING ${DRAFT_COLS}`, [id, req.user!.id, ...v]);
  if (!d) throw notFound('Campanha pendente não encontrada.');
  res.json({ draft: d });
});
metaCampaignsRouter.delete('/campaigns/drafts/:draftId', async (req, res) => {
  const d = await one('DELETE FROM meta_campaign_drafts WHERE id = $1 AND user_id = $2 RETURNING id', [parse(ID, req.params.draftId), req.user!.id]);
  if (!d) throw notFound('Campanha pendente não encontrada.');
  res.status(204).end();
});
