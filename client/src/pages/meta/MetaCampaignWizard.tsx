import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Collapse, FormControlLabel, Grid, IconButton, LinearProgress, ListSubheader, MenuItem, Radio, RadioGroup, Step, StepLabel, Stepper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMetaAdAccounts, useMetaConversionEvents, useMetaDatasets, useMetaDrafts, useMetaPages, useMetaProfiles, useMetaSuggestion, useMetaTrackedUrl, useMyDomains } from '@/hooks/queries';
import { qk } from '@/lib/api/keys';
import { metaCampaignsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { TECH_DOMAIN } from '@/lib/format';
import { META_COPY_LIMITS, META_CONVERSION_EVENTS, META_CTAS, META_OBJECTIVES, META_OPT_GOALS } from '@/types/api';
import type { MetaCopy, MetaDraft, MetaDraftStatus, MetaPublishRequest, MetaRun, MetaSuggestion } from '@/types/api';
import { getDefaultPage, profileLabel, profileUsable } from './shared';

const STEPS = ['Site e conta', 'Criativos e copies', 'Configuração', 'Revisão e disparo'];
const MAX_FILES = 20, MAX_BYTES = 10 * 1024 * 1024, MAX_ADS = 50;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const OBJ_LABEL: Record<string, string> = { OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_SALES: 'Vendas', OUTCOME_LEADS: 'Cadastros', OUTCOME_ENGAGEMENT: 'Engajamento' };
const GOAL_LABEL: Record<string, string> = { LANDING_PAGE_VIEWS: 'Visualizações da página de destino', LINK_CLICKS: 'Cliques no link', OFFSITE_CONVERSIONS: 'Conversões (pixel)', IMPRESSIONS: 'Impressões', REACH: 'Alcance' };
const CTA_LABEL: Record<string, string> = { LEARN_MORE: 'Saiba mais', SHOP_NOW: 'Comprar', SIGN_UP: 'Cadastre-se', DOWNLOAD: 'Baixar', WATCH_MORE: 'Assistir mais', GET_OFFER: 'Ver oferta', APPLY_NOW: 'Candidate-se', SUBSCRIBE: 'Assinar' };
const EVENT_LABEL: Record<string, string> = {
  PURCHASE: 'Compra', LEAD: 'Lead', COMPLETE_REGISTRATION: 'Cadastro completo', ADD_TO_CART: 'Adicionar ao carrinho', INITIATED_CHECKOUT: 'Iniciar finalização da compra',
  ADD_PAYMENT_INFO: 'Adicionar dados de pagamento', ADD_TO_WISHLIST: 'Adicionar à lista de desejos', CONTENT_VIEW: 'Visualização de conteúdo', SEARCH: 'Pesquisa',
  CONTACT: 'Contato', SCHEDULE: 'Agendamento', START_TRIAL: 'Iniciar avaliação', SUBMIT_APPLICATION: 'Enviar inscrição', SUBSCRIBE: 'Assinatura', OTHER: 'Outro',
};
/** Valor do campo "Evento do Pixel": std:EVENTO · cc:ID (conversão personalizada) · ce:NOME (evento personalizado) · ce* (digitar o nome). */
const EV_TYPED = 'ce*';
const CUSTOM_EVENT_RE = /^[\w\- .:]{1,100}$/;
const DRAFT_STATUS: Record<MetaDraftStatus, { label: string; tone: 'na' | 'warn' | 'neg' }> = { draft: { label: 'Rascunho', tone: 'na' }, pending: { label: 'Envio interrompido', tone: 'warn' }, failed: { label: 'Falhou', tone: 'neg' } };
type SavedImage = { hash: string; url: string | null; filename: string };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

type Creative = { id: string; file: File; preview: string };
type JobStatus = 'pending' | 'running' | 'done' | 'error';
interface Job { key: number; label: string; copies: MetaCopy[]; status: JobStatus; message?: string; run?: MetaRun }
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function MetaCampaignWizardPage() {
  const [step, setStep] = useState(0);
  /* --- passo 1 --- */
  const [site, setSite] = useState('');
  const [profileId, setProfileId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pageId, setPageId] = useState('');
  /* --- passo 2 --- */
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [dropErr, setDropErr] = useState('');
  const [offer, setOffer] = useState('');
  const [language, setLanguage] = useState<'pt-BR' | 'en-US' | 'es-ES'>('pt-BR');
  const [tone, setTone] = useState('');
  const [count, setCount] = useState('5');
  /* --- passo 3 --- */
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [url, setUrl] = useState('');
  const [campName, setCampName] = useState('');
  const [objective, setObjective] = useState<(typeof META_OBJECTIVES)[number]>('OUTCOME_TRAFFIC');
  const [goal, setGoal] = useState<(typeof META_OPT_GOALS)[number]>('LANDING_PAGE_VIEWS');
  const [budget, setBudget] = useState('');
  const [countries, setCountries] = useState('');
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('65');
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [active, setActive] = useState(false);
  const [datasetId, setDatasetId] = useState('');
  const [linkDataset, setLinkDataset] = useState(false);
  const [linkPixel, setLinkPixel] = useState(false);
  const [event, setEvent] = useState('');
  const [typedEvent, setTypedEvent] = useState('');
  /* --- passo 4 --- */
  const [copies, setCopies] = useState<MetaCopy[]>([]);
  const [layout, setLayout] = useState<'single' | 'per-copy'>('single');
  const [pairing, setPairing] = useState<'zip' | 'cross'>('zip');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState('');
  const hashes = useRef(new Map<string, SavedImage>());   // id do criativo → image_hash (evita reenviar no "tentar de novo")
  /* --- campanha pendente (rascunho) --- */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedImages, setSavedImages] = useState<SavedImage[]>([]);   // já na biblioteca da conta na Meta (vindas do rascunho)
  const [draftMsg, setDraftMsg] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const qc = useQueryClient();
  const creativesRef = useRef<Creative[]>([]);
  creativesRef.current = creatives;
  useEffect(() => () => creativesRef.current.forEach((c) => URL.revokeObjectURL(c.preview)), []);

  const profiles = useMetaProfiles();
  const myDomains = useMyDomains();
  const adAccounts = useMetaAdAccounts(profileId);
  const pages = useMetaPages(profileId);
  const profile = profiles.data?.profiles.find((p) => p.id === profileId);
  const sites = useMemo(() => (myDomains.data?.domains ?? []).filter((d) => d !== TECH_DOMAIN).sort(), [myDomains.data]);
  const accountsForSite = useMemo(() => (adAccounts.data?.adAccounts ?? []).filter((a) => !!site && a.sites.includes(site)), [adAccounts.data, site]);
  const account = accountsForSite.find((a) => a.id === accountId);
  const datasets = useMetaDatasets(profileId, accountId);
  const convEvents = useMetaConversionEvents(profileId, accountId, datasetId);
  const drafts = useMetaDrafts();
  const suggestion = useMetaSuggestion(site, mode === 'ai');
  const tracked = useMetaTrackedUrl(site, url.trim());

  /* Página padrão do Perfil (definida em Perfis & BMs) */
  useEffect(() => {
    if (pageId || !pages.data) return;
    const d = getDefaultPage(profileId);
    if (d && pages.data.pages.some((p) => p.id === d)) setPageId(d);
  }, [pages.data, pageId, profileId]);

  /* Otimização por IA: preenche os campos com a sugestão do histórico (continuam editáveis) */
  const applied = useRef('');
  useEffect(() => {
    const s = suggestion.data;
    if (mode !== 'ai' || !s) return;
    const sig = `${s.site}|${accountId}`;
    if (applied.current === sig) return;
    applied.current = sig;
    applySuggestion(s, account?.currency ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, suggestion.data, account?.currency, accountId]);
  function applySuggestion(s: MetaSuggestion, currency: string | null) {
    setObjective(s.objective.value); setGoal(s.objective.optimizationGoal);
    const b = currency === 'BRL' ? s.dailyBudget.brl : currency === 'USD' ? s.dailyBudget.usd : null;
    if (b != null) setBudget(String(b));
    if (s.audience.countries.length) setCountries(s.audience.countries.map((c) => c.code).join(', '));
    setAgeMin(String(s.audience.ageMin)); setAgeMax(String(s.audience.ageMax)); setGender(s.audience.genders);
  }

  const gen = useMutation({ mutationFn: metaCampaignsApi.generateCopies });
  const nCount = Math.trunc(num(count));
  const countryList = useMemo(() => [...new Set(countries.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))], [countries]);
  const offsite = goal === 'OFFSITE_CONVERSIONS';
  const nImages = creatives.length + savedImages.length;
  const adsPerCampaign = layout === 'per-copy' ? nImages : pairing === 'cross' ? nImages * copies.length : Math.max(nImages, copies.length);

  /* ---------------- validação por passo ---------------- */
  const err1 = !site ? 'Escolha o site.' : !profileId ? 'Escolha o Perfil do Facebook.' : profile && !profileUsable(profile) ? 'O token deste Perfil está vencido, recusado ou sem permissões. Reconecte o Perfil em Perfis & BMs.' : !accountId ? 'Escolha a conta de anúncios.' : !pageId ? 'Escolha a Página.' : '';
  const err2 = !nImages ? 'Envie ao menos um criativo.' : !(nCount >= 1 && nCount <= 20) ? 'A quantidade de copies vai de 1 a 20.' : offer.trim().length < 10 ? 'Descreva a oferta/site em pelo menos 10 caracteres para a IA gerar as copies.' : '';
  const budgetN = num(budget), minN = num(ageMin), maxN = num(ageMax);
  const err3 = !tracked.data ? (tracked.error ? errMsg(tracked.error, 'URL de destino inválida.') : 'Informe a URL de destino (https) do site.')
    : !(budgetN > 0) ? `Informe o orçamento diário${account?.currency ? ` (${account.currency})` : ''}.`
    : !countryList.length || countryList.some((c) => !/^[A-Z]{2}$/.test(c)) ? 'Informe países com o código de 2 letras (ex.: BR, PT).'
    : !(minN >= 18 && maxN <= 65 && minN <= maxN) ? 'Idade: de 18 a 65, com mínima ≤ máxima.'
    : (linkDataset || linkPixel || offsite) && !datasetId ? 'Escolha o Dataset para vincular ao conjunto/anúncios.'
    : offsite && !event ? 'Otimizar por conversões exige escolher o Evento do Pixel.'
    : event === EV_TYPED && !CUSTOM_EVENT_RE.test(typedEvent.trim()) ? 'Digite o nome do evento personalizado exatamente como no Pixel (letras, números, espaço, _ - . :).' : '';
  const copyBad = (c: MetaCopy) => !c.headline.trim() || !c.primaryText.trim() || c.headline.length > META_COPY_LIMITS.headline || c.primaryText.length > META_COPY_LIMITS.primaryText || c.description.length > META_COPY_LIMITS.description;
  const err4 = !copies.length ? 'Gere ou adicione ao menos uma copy.' : copies.some(copyBad) ? 'Há copies vazias ou acima do limite de caracteres da Meta.' : adsPerCampaign > MAX_ADS ? `Máximo de ${MAX_ADS} anúncios por campanha (hoje: ${adsPerCampaign}). Use o pareamento “1 a 1” ou menos copies.` : '';
  const stepErr = [err1, err2, err3, err4][step];

  /* ---------------- ações ---------------- */
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const errs: string[] = [], next: Creative[] = [];
    for (const f of Array.from(list)) {
      if (!OK_TYPES.includes(f.type)) errs.push(`${f.name}: use JPG, PNG ou GIF.`);
      else if (f.size > MAX_BYTES) errs.push(`${f.name}: acima de 10 MB.`);
      else if (creatives.length + savedImages.length + next.length >= MAX_FILES) { errs.push(`Máximo de ${MAX_FILES} imagens.`); break; }
      else next.push({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file: f, preview: URL.createObjectURL(f) });
    }
    setDropErr(errs.slice(0, 3).join(' '));
    if (next.length) setCreatives((c) => [...c, ...next]);
  };
  const removeFile = (id: string) => setCreatives((c) => { c.filter((x) => x.id === id).forEach((x) => URL.revokeObjectURL(x.preview)); return c.filter((x) => x.id !== id); });
  const generate = () => gen.mutate({ site, count: nCount, offer: offer.trim(), language, tone: tone.trim() || undefined }, { onSuccess: (r) => setCopies(r.variations.map((v) => ({ ...v }))) });
  const next = () => {
    if (stepErr) return;
    if (step === 2 && !copies.length && !gen.isPending) generate();
    setStep(step + 1);
  };

  /** Campo "Evento do Pixel" → evento padrão, conversão personalizada ou evento personalizado. */
  const eventFields = (): Pick<MetaPublishRequest['tracking'], 'conversionEvent' | 'customConversionId' | 'customEventName'> => {
    if (!datasetId || !event) return {};
    if (event === EV_TYPED) return { customEventName: typedEvent.trim() };
    const [kind, ...rest] = event.split(':'), v = rest.join(':');
    if (kind === 'std') return { conversionEvent: v as (typeof META_CONVERSION_EVENTS)[number] };
    if (kind === 'cc') return { customConversionId: v };
    if (kind === 'ce') return { customEventName: v };
    return {};
  };
  const eventLabel = (() => {
    const f = eventFields();
    if (f.conversionEvent) return EVENT_LABEL[f.conversionEvent];
    if (f.customConversionId) return `Conversão personalizada: ${convEvents.data?.customConversions.find((c) => c.id === f.customConversionId)?.name ?? f.customConversionId}`;
    if (f.customEventName) return `Evento personalizado: ${f.customEventName}`;
    return '';
  })();

  /* ---------------- campanhas pendentes (rascunhos) ---------------- */
  /** Estado do assistente que vai para o rascunho. Imagens: só as que já estão na Meta (hash/URL); arquivos locais não vão. */
  const snapshot = (copiesOverride?: MetaCopy[]) => ({
    v: 1, site, profileId, accountId, pageId, offer, language, tone, count, mode, url, campName, objective, goal, budget, countries, ageMin, ageMax, gender, active,
    datasetId, linkDataset, linkPixel, event, typedEvent, copies: copiesOverride ?? copies, layout, pairing,
    images: [...savedImages, ...creatives.map((c) => hashes.current.get(c.id)).filter((x): x is SavedImage => !!x)],
  });
  const draftName = () => campName.trim() || (site ? `${site} · ${copies.length} copy(ies) × ${nImages} imagem(ns)` : 'Campanha sem nome');
  /** Cria ou atualiza o rascunho; devolve o id (ou null se não conseguiu salvar). */
  const saveDraft = async (status: MetaDraftStatus, extra: { lastError?: string | null; lastRunId?: string | null; copies?: MetaCopy[] } = {}, id = draftId) => {
    const body = { name: draftName().slice(0, 200), profileId: profileId || null, adAccountId: accountId || null, site: site || null, status, lastError: extra.lastError?.slice(0, 2000) ?? null, lastRunId: extra.lastRunId ?? null, state: snapshot(extra.copies) };
    try {
      const r = id ? await metaCampaignsApi.updateDraft(id, body).catch((e) => { if (e instanceof ApiError && e.status === 404) return metaCampaignsApi.createDraft(body); throw e; }) : await metaCampaignsApi.createDraft(body);
      setDraftId(r.draft.id);
      void qc.invalidateQueries({ queryKey: qk.metaDrafts });
      return r.draft.id;
    } catch (e) { setDraftMsg(`Não foi possível salvar a campanha pendente: ${errMsg(e, 'erro desconhecido')}`); return null; }
  };
  const removeDraft = async (id: string) => {
    await metaCampaignsApi.deleteDraft(id).catch(() => {});
    void qc.invalidateQueries({ queryKey: qk.metaDrafts });
  };
  const resetAll = () => {
    setJobs([]); setStep(0); creatives.forEach((c) => URL.revokeObjectURL(c.preview)); setCreatives([]); setCopies([]); hashes.current.clear(); setLaunchErr('');
    setDraftId(null); setSavedImages([]); setDraftMsg('');
  };
  /** Carrega uma campanha pendente no assistente para editar/reenviar. */
  const openDraft = async (id: string) => {
    setLoadingDraft(true); setDraftMsg('');
    try {
      const { draft } = await metaCampaignsApi.draft(id);
      const st = draft.state as Record<string, any>;
      const str = (k: string, d = '') => (typeof st[k] === 'string' ? st[k] : d);
      resetAll();
      setSite(str('site')); setProfileId(str('profileId')); setAccountId(str('accountId')); setPageId(str('pageId'));
      setOffer(str('offer')); setLanguage((str('language', 'pt-BR')) as typeof language); setTone(str('tone')); setCount(str('count', '5'));
      setMode(st.mode === 'ai' ? 'ai' : 'manual'); setUrl(str('url')); setCampName(str('campName'));
      if ((META_OBJECTIVES as readonly string[]).includes(st.objective)) setObjective(st.objective);
      if ((META_OPT_GOALS as readonly string[]).includes(st.goal)) setGoal(st.goal);
      setBudget(str('budget')); setCountries(str('countries')); setAgeMin(str('ageMin', '18')); setAgeMax(str('ageMax', '65'));
      setGender(['all', 'male', 'female'].includes(st.gender) ? st.gender : 'all'); setActive(!!st.active);
      setDatasetId(str('datasetId')); setLinkDataset(!!st.linkDataset); setLinkPixel(!!st.linkPixel); setEvent(str('event')); setTypedEvent(str('typedEvent'));
      setCopies(Array.isArray(st.copies) ? st.copies : []); setLayout(st.layout === 'per-copy' ? 'per-copy' : 'single'); setPairing(st.pairing === 'cross' ? 'cross' : 'zip');
      setSavedImages(Array.isArray(st.images) ? st.images.filter((x: any) => x && typeof x.hash === 'string') : []);
      applied.current = `${str('site')}|${str('accountId')}`;   // não sobrescreve os campos com a sugestão da IA
      setDraftId(draft.id);
      setDraftMsg(draft.lastError ? `Último erro: ${draft.lastError}` : '');
    } catch (e) { setDraftMsg(errMsg(e, 'Não foi possível abrir a campanha pendente.')); }
    finally { setLoadingDraft(false); }
  };

  const buildBody = (cs: MetaCopy[], name: string | undefined, imageHashes: string[]): MetaPublishRequest => {
    const s = suggestion.data;
    return {
      adAccountId: accountId, pageId, site, url: url.trim(), source: mode,
      ...(mode === 'ai' && s ? { suggestion: { objective: { value: s.objective.value, optimizationGoal: s.objective.optimizationGoal }, dailyBudget: { usd: s.dailyBudget.usd, brl: s.dailyBudget.brl }, audience: { countries: s.audience.countries.slice(0, 50).map((c) => ({ code: c.code })), ageMin: s.audience.ageMin, ageMax: s.audience.ageMax, genders: s.audience.genders } } } : {}),
      campaign: { ...(name ? { name } : {}), objective, status: active ? 'ACTIVE' : 'PAUSED' },
      adset: { dailyBudget: budgetN, optimizationGoal: goal, countries: countryList, ageMin: minN, ageMax: maxN, genders: gender },
      tracking: { ...(datasetId ? { datasetId } : {}), linkDatasetToAdSet: linkDataset || offsite, ...eventFields(), linkPixelToAds: linkPixel },
      imageHashes, pairing: layout === 'single' ? pairing : 'zip', rollbackOnFailure: true,
      copies: cs.map((c) => ({ angle: c.angle?.slice(0, 80), headline: c.headline.trim(), primaryText: c.primaryText.trim(), description: c.description.trim(), cta: c.cta })),
    };
  };

  /** Sobe os criativos que ainda não têm hash (memória → API → Meta) e publica cada campanha em sequência. */
  const launch = async (only?: number[]) => {
    setLaunchErr(''); setLaunching(true);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = campName.trim();
    let list = jobs;
    if (!only) {
      list = layout === 'single'
        ? [{ key: 0, label: base || `${site} · ${copies.length} copy(ies) × ${creatives.length} imagem(ns)`, copies, status: 'pending' as JobStatus }]
        : copies.map((c, i) => ({ key: i, label: `${base || `${site} · ${stamp}`} · Copy ${String(i + 1).padStart(2, '0')}`, copies: [c], status: 'pending' as JobStatus }));
      setJobs(list);
    }
    const patch = (key: number, p: Partial<Job>) => { list = list.map((j) => (j.key === key ? { ...j, ...p } : j)); setJobs(list); };
    // fica listada como pendente desde já: se o envio falhar ou a página for fechada no meio, dá para editar/reenviar/excluir depois
    const dId = await saveDraft('pending');
    let fatal = '';
    try {
      const missing = creatives.filter((c) => !hashes.current.has(c.id));
      if (missing.length) {
        const r = await metaCampaignsApi.uploadCreatives(profileId, accountId, missing.map((m) => m.file));
        r.uploaded.forEach((u) => hashes.current.set(missing[u.index].id, { hash: u.imageHash, url: u.url, filename: u.filename }));
        if (r.failed.length) throw new Error(`Falha no envio de ${r.failed.length} imagem(ns): ${r.failed.slice(0, 3).map((f) => `${f.filename} (${f.message})`).join('; ')}`);
      }
      const imageHashes = [...savedImages.map((x) => x.hash), ...creatives.map((c) => hashes.current.get(c.id)?.hash).filter((x): x is string => !!x)];
      for (const j of list.filter((x) => (only ? only.includes(x.key) : true) && x.status !== 'done')) {
        patch(j.key, { status: 'running', message: undefined });
        try {
          const { run } = await metaCampaignsApi.publish(profileId, buildBody(j.copies, layout === 'single' ? base || undefined : j.label, imageHashes));
          patch(j.key, { status: 'done', run });
        } catch (e) { patch(j.key, { status: 'error', message: errMsg(e, 'Falha ao publicar.') }); }
      }
    } catch (e) {
      fatal = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Falha ao enviar os criativos.';
      setLaunchErr(fatal);
      list = list.map((j) => (j.status === 'running' ? { ...j, status: 'pending' as JobStatus } : j)); setJobs(list);
    } finally {
      // tudo criado → sai da lista de pendentes · senão fica como "Falhou", só com as copies que ainda não viraram campanha
      const left = list.filter((j) => j.status !== 'done');
      if (dId) {
        if (!left.length) { await removeDraft(dId); setDraftId(null); }
        else {
          const errs = fatal || left.map((j) => j.message).filter(Boolean).join(' | ') || 'Envio não concluído.';
          await saveDraft('failed', { lastError: errs, lastRunId: left.find((j) => j.run)?.run?.id ?? null, copies: layout === 'per-copy' ? left.flatMap((j) => j.copies) : undefined }, dId);
        }
      }
      setLaunching(false);
    }
  };

  /* ---------------- render ---------------- */
  if (profiles.error) return <ErrorBox error={profiles.error} retry={() => profiles.refetch()} />;
  if (!profiles.data || !myDomains.data) return <PageSkeleton />;
  const started = jobs.length > 0;
  const doneN = jobs.filter((j) => j.status === 'done').length, failN = jobs.filter((j) => j.status === 'error').length;

  return (
    <>
      <PageHead title="Criar campanhas Meta" sub="Assistente de criação automatizada: criativos, copies geradas por IA e publicação em cascata na Meta."
        right={<Button variant="outlined" component={RouterLink} to="/perfis-meta">Perfis & BMs</Button>} />
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 2.5 }}>{STEPS.map((l) => <Step key={l}><StepLabel>{l}</StepLabel></Step>)}</Stepper>

      {!profiles.data.profiles.length && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }} action={<Button color="inherit" size="small" component={RouterLink} to="/perfis-meta">Conectar</Button>}>Você ainda não conectou nenhum Perfil do Facebook. Conecte um em Perfis & BMs antes de começar.</Alert>
      )}

      {step === 0 && !started && <PendingDrafts drafts={drafts.data?.drafts} error={drafts.error} currentId={draftId} busy={loadingDraft} onOpen={openDraft} onDeleted={(id) => { if (id === draftId) setDraftId(null); void qc.invalidateQueries({ queryKey: qk.metaDrafts }); }} />}
      {draftId && !started && <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>Editando uma campanha pendente. Ao criar, ela sai da lista de pendentes; se o envio falhar, continua salva.{draftMsg ? ` ${draftMsg}` : ''}</Alert>}
      {!draftId && draftMsg && <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>{draftMsg}</Alert>}

      {/* ===== Passo 1 ===== */}
      {step === 0 && (
        <Card><CardContent><Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField select fullWidth label="Site" value={site} onChange={(e) => { setSite(e.target.value); setAccountId(''); setDatasetId(''); setEvent(''); hashes.current.clear(); setSavedImages([]); }} helperText={sites.length ? 'Só os sites atribuídos a você.' : 'Nenhum site atribuído a você.'}>
              {sites.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField select fullWidth label="Perfil do Facebook" value={profileId} onChange={(e) => { setProfileId(e.target.value); setAccountId(''); setPageId(''); setDatasetId(''); setEvent(''); hashes.current.clear(); setSavedImages([]); }}>
              {profiles.data.profiles.map((p) => <MenuItem key={p.id} value={p.id} disabled={!profileUsable(p)}>{p.name}{p.fbUserId ? ` · ${p.fbUserId}` : p.businessId ? ` · BM ${p.businessId}` : ''} · {p.counts.adAccounts} contas · {p.counts.pages} Páginas{p.status !== 'valid' ? ` · ${profileLabel(p.status)}` : ''}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField select fullWidth label="Conta de anúncios" value={accountId} disabled={!profileId || !site || adAccounts.isLoading} onChange={(e) => { setAccountId(e.target.value); setDatasetId(''); setEvent(''); hashes.current.clear(); setSavedImages([]); }}
              helperText={!profileId ? 'Escolha o Perfil primeiro.' : adAccounts.isLoading ? 'Carregando contas sincronizadas…' : adAccounts.error ? errMsg(adAccounts.error, 'Falha ao ler as contas.') : site && !accountsForSite.length ? `Nenhuma conta deste Perfil está ligada a ${site} para você. Peça ao Admin para vincular.` : ' '}
              error={!!adAccounts.error}>
              {accountsForSite.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} · {a.id}{a.currency ? ` · ${a.currency}` : ''}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField select fullWidth label="Página" value={pageId} disabled={!profileId || pages.isLoading} onChange={(e) => setPageId(e.target.value)}
              helperText={!profileId ? 'Escolha o Perfil primeiro.' : pages.isLoading ? 'Carregando Páginas sincronizadas…' : pages.error ? errMsg(pages.error, 'Falha ao ler as Páginas.') : !pages.data?.pages.length ? 'Nenhuma Página sincronizada neste Perfil. Use "Sincronizar Ativos" em Perfis & BMs.' : ' '} error={!!pages.error}>
              {(pages.data?.pages ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name} · {p.id}</MenuItem>)}
            </TextField>
          </Grid>
        </Grid></CardContent></Card>
      )}

      {/* ===== Passo 2 ===== */}
      {step === 1 && (
        <Stack spacing={2}>
          <Card><CardContent>
            <Typography variant="h2" sx={{ mb: 0.5 }}>Criativos</Typography>
            {draftId && <Typography variant="caption" component="p" sx={{ mb: 1, color: 'text.secondary' }}>Campanha pendente: as imagens marcadas “Já na Meta” estão na biblioteca da conta de anúncios. Imagens que não chegaram a subir precisam ser selecionadas de novo.</Typography>}
            <Typography variant="caption" component="p" sx={{ mb: 1.5 }}>JPG, PNG ou GIF, até 10 MB cada (máx. {MAX_FILES}). O preview é local; as imagens só vão à Meta quando você disparar, direto da memória (nada fica salvo no servidor).</Typography>
            <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateOutlinedIcon />} disabled={nImages >= MAX_FILES}>
              Selecionar imagens
              <input hidden type="file" multiple accept={OK_TYPES.join(',')} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </Button>
            {dropErr && <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>{dropErr}</Alert>}
            {!!(creatives.length || savedImages.length) && (
              <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                {savedImages.map((img) => (
                  <Grid key={img.hash} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                    <Box sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                      {img.url ? <Box component="img" src={img.url} alt={`Criativo já enviado: ${img.filename}`} sx={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                        : <Box sx={{ width: '100%', aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}><Typography variant="caption">Sem prévia</Typography></Box>}
                      <IconButton size="small" aria-label={`Remover ${img.filename}`} onClick={() => setSavedImages((l) => l.filter((x) => x.hash !== img.hash))} sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}><CloseRoundedIcon fontSize="small" /></IconButton>
                      <Box sx={{ px: 1, py: 0.5 }}><Typography variant="caption" noWrap component="div">{img.filename}</Typography><Typography variant="caption" color="success.main">Já na Meta</Typography></Box>
                    </Box>
                  </Grid>
                ))}
                {creatives.map((c, i) => (
                  <Grid key={c.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                    <Box sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                      <Box component="img" src={c.preview} alt={`Criativo ${i + 1}: ${c.file.name}`} sx={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                      <IconButton size="small" aria-label={`Remover ${c.file.name}`} onClick={() => removeFile(c.id)} sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}><CloseRoundedIcon fontSize="small" /></IconButton>
                      <Box sx={{ px: 1, py: 0.5 }}><Typography variant="caption" noWrap component="div">{c.file.name}</Typography><Typography variant="caption" color="text.secondary">{kb(c.file.size)}</Typography></Box>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            )}
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h2" sx={{ mb: 1.5 }}><AutoAwesomeOutlinedIcon sx={{ fontSize: 20, mr: 0.75, verticalAlign: 'text-bottom' }} />Copies com IA</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4, md: 3 }}><TextField label="Quantidade de copies (X)" type="number" fullWidth value={count} onChange={(e) => setCount(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 20 } }} helperText="De 1 a 20" /></Grid>
              <Grid size={{ xs: 12, sm: 4, md: 3 }}><TextField select label="Idioma" fullWidth value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}><MenuItem value="pt-BR">Português (BR)</MenuItem><MenuItem value="en-US">English (US)</MenuItem><MenuItem value="es-ES">Español</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, sm: 4, md: 6 }}><TextField label="Tom (opcional)" fullWidth value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Ex.: informativo, direto, curioso" slotProps={{ htmlInput: { maxLength: 200 } }} /></Grid>
              <Grid size={12}><TextField label="Sobre a oferta / o site" fullWidth multiline minRows={3} value={offer} onChange={(e) => setOffer(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} helperText="O que é, para quem é e qual o diferencial. Só este texto e o domínio vão à IA, nenhum dado seu ou de tokens." /></Grid>
            </Grid>
          </CardContent></Card>
        </Stack>
      )}

      {/* ===== Passo 3 ===== */}
      {step === 2 && (
        <Stack spacing={2}>
          <Card><CardContent>
            <ToggleButtonGroup exclusive value={mode} onChange={(_, v) => v && setMode(v)} size="small" color="primary" aria-label="Modo de configuração">
              <ToggleButton value="manual">Configuração manual</ToggleButton>
              <ToggleButton value="ai"><AutoAwesomeOutlinedIcon sx={{ fontSize: 16, mr: 0.75 }} />Otimização automática por IA (histórico)</ToggleButton>
            </ToggleButtonGroup>
            {mode === 'ai' && (
              <Box sx={{ mt: 1.5 }}>
                {suggestion.isLoading && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={16} /><Typography variant="caption">Analisando o histórico de {site}…</Typography></Stack>}
                {suggestion.error && <ErrorBox error={suggestion.error} retry={() => suggestion.refetch()} />}
                {suggestion.data && (
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                      <Tag tone={{ high: 'pos', medium: 'accent', low: 'warn', none: 'neg' }[suggestion.data.confidence] as 'pos'}>Confiança: {{ high: 'alta', medium: 'média', low: 'baixa', none: 'sem histórico' }[suggestion.data.confidence]}</Tag>
                      <Typography variant="caption">Janela de {suggestion.data.window.days} dias · {suggestion.data.evidence.length} campanha(s) de referência</Typography>
                    </Stack>
                    {suggestion.data.warnings.map((w) => <Alert key={w} severity="warning" variant="outlined">{w}</Alert>)}
                    <Typography variant="caption" component="p">{suggestion.data.dailyBudget.note} {suggestion.data.audience.note}</Typography>
                    {suggestion.data.audience.avoidCountries.length > 0 && <Typography variant="caption" component="p">Países com prejuízo no histórico (evitar): {suggestion.data.audience.avoidCountries.map((c) => c.code).join(', ')}.</Typography>}
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>Os campos abaixo foram preenchidos com a sugestão e continuam editáveis.</Typography>
                  </Stack>
                )}
              </Box>
            )}
          </CardContent></Card>

          <Card><CardContent><Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}><TextField label="Nome da campanha (opcional)" fullWidth value={campName} onChange={(e) => setCampName(e.target.value)} slotProps={{ htmlInput: { maxLength: 150 } }} helperText="Em branco = nome automático com o site e a data." /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select label="Objetivo" fullWidth value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)}>{META_OBJECTIVES.map((o) => <MenuItem key={o} value={o}>{OBJ_LABEL[o]}</MenuItem>)}</TextField></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select label="Otimização" fullWidth value={goal} onChange={(e) => setGoal(e.target.value as typeof goal)}>{META_OPT_GOALS.map((o) => <MenuItem key={o} value={o}>{GOAL_LABEL[o]}</MenuItem>)}</TextField></Grid>
            <Grid size={{ xs: 12, sm: 4, md: 3 }}><TextField label={`Orçamento diário${account?.currency ? ` (${account.currency})` : ''}`} fullWidth value={budget} onChange={(e) => setBudget(e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} /></Grid>
            <Grid size={{ xs: 12, sm: 8, md: 5 }}><TextField label="Países (código de 2 letras)" fullWidth value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="BR, PT, US" /></Grid>
            <Grid size={{ xs: 4, md: 1.5 }}><TextField label="Idade mín." fullWidth value={ageMin} onChange={(e) => setAgeMin(e.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }} /></Grid>
            <Grid size={{ xs: 4, md: 1.5 }}><TextField label="Idade máx." fullWidth value={ageMax} onChange={(e) => setAgeMax(e.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }} /></Grid>
            <Grid size={{ xs: 4, md: 1 }}><TextField select label="Gênero" fullWidth value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}><MenuItem value="all">Todos</MenuItem><MenuItem value="male">Homens</MenuItem><MenuItem value="female">Mulheres</MenuItem></TextField></Grid>
          </Grid></CardContent></Card>

          <Card><CardContent>
            <Typography variant="h2" sx={{ mb: 1.5 }}>Rastreamento (opcional)</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField select label="Conjunto de Dados (Dataset)" fullWidth value={datasetId} onChange={(e) => { setDatasetId(e.target.value); if (!event.startsWith('std:')) setEvent(''); }}
                  helperText={datasets.isLoading ? 'Carregando…' : datasets.error ? 'Não foi possível listar Datasets/Pixels desta conta.' : datasets.data && !datasets.data.datasets.length ? 'Nenhum Dataset disponível.' : 'Não vincular = nenhum Dataset.'} error={!!datasets.error}>
                  <MenuItem value=""><em>Nenhum</em></MenuItem>
                  {(datasets.data?.datasets ?? []).map((d) => <MenuItem key={d.id} value={d.id}>{d.name} · {d.id}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField select label="Evento do Pixel" fullWidth value={event} disabled={!datasetId} onChange={(e) => setEvent(e.target.value)}
                  helperText={!datasetId ? 'Escolha o Dataset primeiro.' : convEvents.isLoading ? 'Carregando eventos personalizados do Pixel…' : convEvents.error ? `Eventos personalizados indisponíveis: ${errMsg(convEvents.error, 'falha ao consultar a Meta')}` : offsite ? 'Obrigatório ao otimizar por conversões.' : 'Evento de conversão a rastrear (padrão ou personalizado).'}
                  error={!!convEvents.error}>
                  <MenuItem value=""><em>Nenhum</em></MenuItem>
                  <ListSubheader>Eventos padrão</ListSubheader>
                  {META_CONVERSION_EVENTS.map((ev) => <MenuItem key={ev} value={`std:${ev}`}>{EVENT_LABEL[ev]}</MenuItem>)}
                  {!!convEvents.data?.customConversions.length && <ListSubheader>Conversões personalizadas</ListSubheader>}
                  {(convEvents.data?.customConversions ?? []).map((c) => <MenuItem key={`cc:${c.id}`} value={`cc:${c.id}`}>{c.name}{c.eventType && c.eventType !== 'OTHER' ? ` · ${EVENT_LABEL[c.eventType] ?? c.eventType}` : ''}</MenuItem>)}
                  <ListSubheader>Eventos personalizados</ListSubheader>
                  {(convEvents.data?.customEvents ?? []).map((c) => <MenuItem key={`ce:${c.name}`} value={`ce:${c.name}`}>{c.name} · {c.count.toLocaleString('pt-BR')} nos últimos 60 dias</MenuItem>)}
                  {/* evento que veio de um rascunho e não aparece mais nas estatísticas do Pixel */}
                  {event.startsWith('ce:') && !convEvents.data?.customEvents.some((c) => `ce:${c.name}` === event) && <MenuItem value={event}>{event.slice(3)}</MenuItem>}
                  {event.startsWith('cc:') && !convEvents.data?.customConversions.some((c) => `cc:${c.id}` === event) && <MenuItem value={event}>Conversão personalizada {event.slice(3)}</MenuItem>}
                  <MenuItem value={EV_TYPED}><em>Digitar o nome de um evento personalizado…</em></MenuItem>
                </TextField>
                <Collapse in={event === EV_TYPED}>
                  <TextField size="small" fullWidth sx={{ mt: 1.5 }} label="Nome do evento personalizado" value={typedEvent} onChange={(e) => setTypedEvent(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }}
                    helperText="Exatamente como no código do Pixel: fbq('trackCustom', 'NomeDoEvento'). Diferencia maiúsculas de minúsculas." />
                </Collapse>
                {convEvents.data?.warnings.map((w) => <Typography key={w} variant="caption" component="p" sx={{ color: 'warning.main', mt: 0.5 }}>{w}</Typography>)}
              </Grid>
              <Grid size={12}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControlLabel control={<Checkbox checked={linkDataset || offsite} disabled={offsite || !datasetId} onChange={(e) => setLinkDataset(e.target.checked)} />} label="Vincular o Dataset ao Conjunto de Anúncios" />
                <FormControlLabel control={<Checkbox checked={linkPixel} disabled={!datasetId} onChange={(e) => setLinkPixel(e.target.checked)} />} label="Vincular o Pixel/Evento a cada Anúncio" />
              </Stack></Grid>
            </Grid>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="h2" sx={{ mb: 1.5 }}>URL de destino e UTMs</Typography>
            <TextField label="URL de destino" fullWidth value={url} onChange={(e) => setUrl(e.target.value)} placeholder={site ? `https://${site}/artigo` : 'https://'} error={!!tracked.error} helperText={tracked.error ? errMsg(tracked.error, 'URL inválida.') : 'Precisa ser https e do site escolhido. As UTMs do template do Pluto são aplicadas automaticamente.'} />
            {tracked.isFetching && !tracked.data && <LinearProgress sx={{ mt: 1 }} />}
            {tracked.data && !tracked.error && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="overline">Prévia da URL final</Typography>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5, overflowWrap: 'anywhere' }}>{tracked.data.preview}</Box>
                {!!tracked.data.replaced.length && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>Parâmetros substituídos pelo template: {tracked.data.replaced.join(', ')}.</Typography>}
                <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>As macros ({'{{ad.id}}'}, {'{{placement}}'}) são resolvidas pela Meta quando o anúncio roda.</Typography>
              </Box>
            )}
          </CardContent></Card>
        </Stack>
      )}

      {/* ===== Passo 4 ===== */}
      {step === 3 && (
        <Stack spacing={2}>
          {!started && (
            <>
              <Card><CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="h2">Copies ({copies.length})</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<AddRoundedIcon />} disabled={copies.length >= 20} onClick={() => setCopies([...copies, { headline: '', primaryText: '', description: '', cta: 'LEARN_MORE' }])}>Adicionar</Button>
                    <Button size="small" variant="outlined" startIcon={gen.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlinedIcon />} disabled={gen.isPending} onClick={generate}>{copies.length ? 'Gerar novamente' : 'Gerar com IA'}</Button>
                  </Stack>
                </Stack>
                {gen.isPending && <><LinearProgress sx={{ my: 1 }} /><Typography variant="caption">O Claude está escrevendo {nCount} variações…</Typography></>}
                {gen.error && <Alert severity="error" variant="outlined" sx={{ my: 1 }} action={<Button color="inherit" size="small" onClick={generate}>Tentar de novo</Button>}>{errMsg(gen.error, 'Não foi possível gerar as copies.')}</Alert>}
                {gen.data && gen.data.dropped > 0 && <Alert severity="info" variant="outlined" sx={{ my: 1 }}>{gen.data.dropped} variação(ões) fora dos limites da Meta foi(ram) descartada(s). Você pode gerar de novo ou adicionar manualmente.</Alert>}
                <Stack spacing={1.5} sx={{ mt: 1 }}>
                  {copies.map((c, i) => {
                    const set = (p: Partial<MetaCopy>) => setCopies(copies.map((x, j) => (j === i ? { ...x, ...p } : x)));
                    const cnt = (v: string, max: number) => ({ helperText: `${v.length}/${max}`, error: v.length > max });
                    return (
                      <Card key={i} variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography variant="overline">Copy {String(i + 1).padStart(2, '0')}</Typography>{c.angle && <Chip size="small" label={c.angle} />}</Stack>
                          <Tooltip title="Remover"><IconButton size="small" aria-label={`Remover copy ${i + 1}`} onClick={() => setCopies(copies.filter((_, j) => j !== i))}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
                        </Stack>
                        <Grid container spacing={1.5}>
                          <Grid size={{ xs: 12, md: 6 }}><TextField size="small" fullWidth label="Título" value={c.headline} onChange={(e) => set({ headline: e.target.value })} {...cnt(c.headline, META_COPY_LIMITS.headline)} /></Grid>
                          <Grid size={{ xs: 12, sm: 8, md: 4 }}><TextField size="small" fullWidth label="Descrição" value={c.description} onChange={(e) => set({ description: e.target.value })} {...cnt(c.description, META_COPY_LIMITS.description)} /></Grid>
                          <Grid size={{ xs: 12, sm: 4, md: 2 }}><TextField size="small" select fullWidth label="Botão" value={c.cta} onChange={(e) => set({ cta: e.target.value as MetaCopy['cta'] })}>{META_CTAS.map((x) => <MenuItem key={x} value={x}>{CTA_LABEL[x]}</MenuItem>)}</TextField></Grid>
                          <Grid size={12}><TextField size="small" fullWidth multiline minRows={2} label="Texto principal" value={c.primaryText} onChange={(e) => set({ primaryText: e.target.value })} {...cnt(c.primaryText, META_COPY_LIMITS.primaryText)} /></Grid>
                        </Grid>
                      </Card>
                    );
                  })}
                </Stack>
              </CardContent></Card>

              <Card><CardContent>
                <Typography variant="h2" sx={{ mb: 1 }}>Como criar</Typography>
                <RadioGroup value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
                  <FormControlLabel value="single" control={<Radio />} label="Uma campanha com todos os anúncios (imagens × copies)" />
                  <FormControlLabel value="per-copy" control={<Radio />} label={`Uma campanha por copy (${copies.length} campanha${copies.length === 1 ? '' : 's'}, cada uma com todas as imagens)`} />
                </RadioGroup>
                <Collapse in={layout === 'single'}>
                  <TextField select size="small" label="Pareamento" value={pairing} onChange={(e) => setPairing(e.target.value as typeof pairing)} sx={{ mt: 1.5, minWidth: 320 }}>
                    <MenuItem value="zip">1 a 1 (a imagem i usa a copy i)</MenuItem><MenuItem value="cross">Todas as combinações imagem × copy</MenuItem>
                  </TextField>
                </Collapse>
                <FormControlLabel sx={{ display: 'flex', mt: 1.5 }} control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Publicar já ativa (por padrão as campanhas são criadas PAUSADAS para revisão na Meta)" />
                <Typography variant="caption" component="p" sx={{ mt: 1 }}>
                  Resumo: {site} · {account?.name ?? accountId} · {nImages} imagem(ns) · {copies.length} copy(ies) · {layout === 'per-copy' ? `${copies.length} campanha(s) × ${nImages} anúncio(s)` : `${adsPerCampaign} anúncio(s)`} · {budget} {account?.currency}/dia · {countryList.join(', ')}{eventLabel ? ` · ${eventLabel}` : ''}
                </Typography>
              </CardContent></Card>
            </>
          )}

          {started && (
            <Card><CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h2">Publicação</Typography>
                <Typography variant="caption">{doneN} de {jobs.length} criada(s){failN ? ` · ${failN} com erro` : ''}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={jobs.length ? ((doneN + failN) / jobs.length) * 100 : 0} sx={{ mb: 1.5, height: 8, borderRadius: 4 }} />
              {launching && <Typography variant="caption" component="p" sx={{ mb: 1 }}>Enviando criativos e criando na Meta. Pode levar alguns minutos; não feche esta página.</Typography>}
              {launchErr && <Alert severity="error" variant="outlined" sx={{ mb: 1.5 }}>{launchErr}</Alert>}
              {!launching && draftId && jobs.some((j) => j.status !== 'done') && <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>Esta campanha ficou salva em “Campanhas pendentes de envio” (início do assistente): dá para editar e reenviar depois, ou excluir.</Alert>}
              <Stack spacing={1}>
                {jobs.map((j) => (
                  <Card key={j.key} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                      <Box sx={{ pt: 0.25 }}>{j.status === 'done' ? <CheckCircleOutlineRoundedIcon color="success" /> : j.status === 'error' ? <ErrorOutlineRoundedIcon color="error" /> : j.status === 'running' ? <CircularProgress size={22} /> : <ScheduleRoundedIcon color="disabled" />}</Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{j.run?.name ?? j.label}</Typography>
                        <Typography variant="caption" component="div">{j.copies.length} copy(ies) · {{ pending: 'Na fila', running: 'Criando…', done: 'Criada', error: 'Erro' }[j.status]}{j.status === 'done' && j.run?.metaCampaignId ? ` · ID ${j.run.metaCampaignId}` : ''}</Typography>
                        {j.message && <Typography variant="caption" component="div" sx={{ color: 'error.main' }}>{j.message}</Typography>}
                        {j.run && <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{j.run.steps.filter((s) => s.kind === 'ad' && s.status === 'ok').length} anúncio(s) · {j.run.steps.filter((s) => s.status === 'ok').length} de {j.run.steps.length} etapas concluídas na Meta{j.run.metaAdsetId ? ` · Conjunto ${j.run.metaAdsetId}` : ''}</Typography>}
                      </Box>
                      {j.status === 'error' && <Button size="small" disabled={launching} onClick={() => launch([j.key])}>Tentar de novo</Button>}
                    </Stack>
                  </Card>
                ))}
              </Stack>
              {!launching && doneN === jobs.length && <Alert severity="success" variant="outlined" sx={{ mt: 1.5 }}>Tudo criado. {active ? 'As campanhas estão ativas.' : 'As campanhas estão pausadas: revise e ative no Gerenciador de Anúncios.'}</Alert>}
              {!launching && (failN > 0 || launchErr) && doneN < jobs.length && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Button variant="contained" onClick={() => launch(jobs.filter((j) => j.status !== 'done').map((j) => j.key))}>Tentar as pendentes de novo</Button>
                </Stack>
              )}
            </CardContent></Card>
          )}
        </Stack>
      )}

      {/* ===== navegação ===== */}
      <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, alignItems: 'center' }}>
        <Button disabled={step === 0 || launching || started} onClick={() => setStep(step - 1)}>Voltar</Button>
        <Box sx={{ flex: 1 }} />
        {!started && !launching && (site || copies.length > 0) && (
          <Button startIcon={<SaveOutlinedIcon />} onClick={async () => { setDraftMsg(''); if (await saveDraft('draft')) setDraftMsg('Salva em campanhas pendentes.'); }}>{draftId ? 'Salvar alterações' : 'Salvar como pendente'}</Button>
        )}
        {stepErr && !started && <Typography variant="caption" sx={{ color: 'warning.main', textAlign: 'right' }}>{stepErr}</Typography>}
        {step < 3 && <Button variant="contained" disabled={!!stepErr} onClick={next}>Continuar</Button>}
        {step === 3 && !started && <Button variant="contained" startIcon={<RocketLaunchOutlinedIcon />} disabled={!!stepErr || gen.isPending || launching} onClick={() => launch()}>{layout === 'per-copy' ? `Criar ${copies.length} campanha(s)` : 'Criar campanha'}</Button>}
        {started && !launching && <Button variant="outlined" onClick={resetAll}>Nova campanha</Button>}
      </Stack>
    </>
  );
}

/** Campanhas criadas no assistente que ainda não foram enviadas à Meta (rascunho, envio interrompido ou com falha). */
function PendingDrafts({ drafts, error, currentId, busy, onOpen, onDeleted }: { drafts?: MetaDraft[]; error: unknown; currentId: string | null; busy: boolean; onOpen: (id: string) => void; onDeleted: (id: string) => void }) {
  const [del, setDel] = useState<MetaDraft | null>(null);
  const rm = useMutation({ mutationFn: (id: string) => metaCampaignsApi.deleteDraft(id), onSuccess: (_r, id) => { setDel(null); onDeleted(id); } });
  if (error) return <Box sx={{ mb: 2 }}><ErrorBox error={error} /></Box>;
  if (!drafts?.length) return null;
  return (
    <Card sx={{ mb: 2 }}><CardContent>
      <Typography variant="h2" sx={{ mb: 0.5 }}>Campanhas pendentes de envio ({drafts.length})</Typography>
      <Typography variant="caption" component="p" sx={{ mb: 1.5 }}>Ficam aqui até serem criadas na Meta. Abra para editar e reenviar, ou exclua.</Typography>
      <Stack spacing={1}>
        {drafts.map((d) => (
          <Card key={d.id} variant="outlined" sx={{ p: 1.5, borderColor: d.id === currentId ? 'primary.main' : undefined }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' } }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.name}</Typography>
                  <Tag tone={DRAFT_STATUS[d.status].tone}>{DRAFT_STATUS[d.status].label}</Tag>
                </Stack>
                <Typography variant="caption" component="div">{[d.site, d.adAccountId && `conta ${d.adAccountId}`, `${d.copies} copy(ies)`, `${d.images} imagem(ns) na Meta`, `atualizada ${fmtWhen(d.updatedAt)}`].filter(Boolean).join(' · ')}</Typography>
                {d.lastError && <Typography variant="caption" component="div" sx={{ color: 'error.main', overflowWrap: 'anywhere' }}>{d.lastError}</Typography>}
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} disabled={busy} onClick={() => onOpen(d.id)}>Editar</Button>
                <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setDel(d)}>Excluir</Button>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
      <ConfirmDialog open={!!del} title="Excluir campanha pendente?" busy={rm.isPending} onConfirm={() => del && rm.mutate(del.id)} onClose={() => { setDel(null); rm.reset(); }}>
        <Typography>“{del?.name}” sai da lista de pendentes. Nada é alterado na Meta (as imagens já enviadas continuam na biblioteca da conta).</Typography>
        {rm.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{errMsg(rm.error, 'Não foi possível excluir.')}</Alert>}
      </ConfirmDialog>
    </CardContent></Card>
  );
}
