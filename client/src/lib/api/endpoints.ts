/**
 * Um lugar só com TODAS as rotas que o servidor Node.js precisa expor.
 * A documentação completa (parâmetros e respostas) está em docs/API.md.
 */
import { api } from './client';
import type * as T from '@/types/api';
import type { Payout, PayoutMethod } from '@/lib/financeOps';

type P = T.PeriodQuery;

export const authApi = {
  me: () => api.get<{ user: T.User }>('/auth/me'),
  login: (b: T.LoginRequest) => api.post<T.LoginResponse>('/auth/login', b),
  logout: () => api.post<void>('/auth/logout'),
  forgot: (email: string) => api.post<void>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => api.post<void>('/auth/reset-password', { token, newPassword }),
  changePassword: (currentPassword: string | null, newPassword: string) => api.post<void>('/auth/change-password', { currentPassword, newPassword }),
};

export const meApi = {
  /** Domínios que o usuário pode ver (todos para Admin/SuperAdmin; os do Squad para Gestor). */
  domains: (company?: string) => api.get<{ domains: string[] }>('/me/domains', { company }),
  /** Empresas que o usuário vê (seletor do topo). */
  companies: () => api.get<{ companies: T.MyCompany[] }>('/me/companies'),
  /** 0.18.13: meio de recebimento da comissão (o próprio usuário edita). */
  payout: () => api.get<Payout>('/me/payout'),
  savePayout: (b: { method: PayoutMethod | null; methodOther: string | null; key: string | null }) => api.put<Payout>('/me/payout', b),
};

export const companiesApi = {
  overview: (id: string, q: P) => api.get<T.CompanyOverviewResponse>(`/companies/${encodeURIComponent(id)}/overview`, { ...q, company: undefined }),
};

export const searchApi = {
  search: (q: string) => api.get<{ results: T.SearchResult[] }>('/search', { q }),
};

export const prefsApi = {
  get: () => api.get<T.Preferences>('/me/preferences'),
  save: (p: T.Preferences) => api.put<T.Preferences>('/me/preferences', p),
};

export const dashboardApi = {
  get: (q: P) => api.get<T.DashboardResponse>('/dashboard', { ...q }),
};

export const domainsApi = {
  summary: (q: P) => api.get<{ domains: T.DomainSummary[] }>('/domains/summary', { ...q }),
  detail: (domain: string, q: P) => api.get<T.DomainDetailResponse>(`/domains/${encodeURIComponent(domain)}`, { ...q }),
};

export const campaignsApi = {
  list: (q: P & { platform: T.Platform; accountId?: string; includePaused?: boolean }) => api.get<T.CampaignsResponse>('/campaigns', { ...q }),
  children: (platform: T.Platform, id: string, q: P) => api.get<T.CampaignChildrenResponse>(`/campaigns/${platform}/${id}/children`, { ...q }),
  countries: (platform: T.Platform, id: string, q: P) => api.get<T.CampaignCountriesResponse>(`/campaigns/${platform}/${id}/countries`, { ...q }),
};

export const placementsApi = {
  /** Contas e campanhas Google Ads do domínio (seletores da tela). */
  filters: (domain: string) => api.get<T.PlacementFiltersResponse>('/placements/filters', { domain }),
  list: (q: T.PlacementQuery) => api.get<T.PlacementsResponse>('/placements', { ...q }),
  /** Campanhas que gastaram no placement (level=root agrupa os subdomínios). */
  campaigns: (q: T.PlacementQuery & { placement: string; level: 'root' | 'host' }) => api.get<T.PlacementCampaignsResponse>('/placements/campaigns', { ...q }),
};

export const urlsApi = {
  list: (q: P & { origin?: string }) => api.get<T.UrlsResponse>('/urls', { ...q }),
};

export const reportsApi = {
  /** Um dia por linha do mês pedido (YYYY-MM). */
  daily: (q: T.ReportQuery & { month: string }) => api.get<T.DailyReportResponse>('/reports/daily', { ...q }),
  /** Um mês por linha, os últimos `months` meses (inclui o mês atual). */
  monthly: (q: T.ReportQuery & { months: number }) => api.get<T.MonthlyReportResponse>('/reports/monthly', { ...q }),
};

export const gamApi = {
  summary: (q: P) => api.get<T.GamSummaryResponse>('/gam/summary', { ...q }),
};

export const attributionApi = {
  health: (q: P) => api.get<T.AttributionHealthResponse>('/attribution/health', { ...q }),
  templates: () => api.get<T.UtmTemplates>('/utm/templates'),
  debug: (url: string) => api.post<T.UtmDebugResponse>('/utm/debug', { url }),
};

export const fxApi = {
  latest: () => api.get<T.FxLatest>('/fx/latest'),
  history: (days = 10) => api.get<{ rows: T.FxHistoryRow[] }>('/fx/history', { days }),
};

/* ----- somente Admin/SuperAdmin (o servidor devolve 403 para Gestor; conectar e frequência só SuperAdmin) ----- */
export const integrationsApi = {
  status: () => api.get<T.IntegrationsResponse>('/admin/integrations'),
  startOAuth: (provider: 'google-ads' | 'meta' | 'gam') => api.post<T.OAuthStartResponse>(`/admin/integrations/${provider}/oauth/start`),
  setGoogleImport: (accountId: string, imported: boolean) => api.patch<void>(`/admin/integrations/google-ads/accounts/${accountId}`, { imported }),
  syncNow: (provider: 'google-ads' | 'meta' | 'gam') => api.post<void>(`/admin/integrations/${provider}/sync`),
  /* CRUD das contas de cada integração */
  accounts: (p: T.Provider) => api.get<{ accounts: T.IntegrationAccount[] }>(`/admin/integrations/${p}/accounts`),
  createAccount: (p: T.Provider, b: T.IntegrationAccountInput) => api.post<T.IntegrationAccount>(`/admin/integrations/${p}/accounts`, b),
  updateAccount: (p: T.Provider, id: string, b: Partial<T.IntegrationAccountInput>) => api.patch<T.IntegrationAccount>(`/admin/integrations/${p}/accounts/${encodeURIComponent(id)}`, b),
  deleteAccount: (p: T.Provider, id: string) => api.del<void>(`/admin/integrations/${p}/accounts/${encodeURIComponent(id)}`),
  /* Frequência das sincronizações */
  syncSettings: () => api.get<{ settings: T.SyncSetting[] }>('/admin/sync-settings'),
  updateSyncSetting: (id: string, b: { everyMinutes?: number; enabled?: boolean; windowMode?: 'days' | 'incremental'; windowDays?: number; retentionDays?: number | null }) => api.patch<T.SyncSetting>(`/admin/sync-settings/${encodeURIComponent(id)}`, b),
};

export const adminApi = {
  domains: () => api.get<{ domains: T.Domain[] }>('/admin/domains'),
  metaTagAudit: (days = 7) => api.get<T.MetaTagAuditResponse>('/admin/utm-audit/meta', { days }),
  unmappedCampaigns: (platform: T.Platform = 'meta', days = 30) => api.get<T.UnmappedCampaignsResponse>('/admin/campaigns/unmapped', { platform, days }),
  setCampaignDomain: (a: { id: string; platform: T.Platform; domain: string | null }) => api.patch<T.SetCampaignDomainResponse>(`/admin/campaigns/${encodeURIComponent(a.id)}`, { platform: a.platform, domain: a.domain }),
  createDomain: (a: string | { hostname: string; squadId?: string | null }) => api.post<T.Domain>('/admin/domains', typeof a === 'string' ? { hostname: a } : a),
  updateDomain: (hostname: string, patch: T.DomainInput) => api.patch<T.Domain>(`/admin/domains/${encodeURIComponent(hostname)}`, patch),
  /** 0.17: mostra a senha do WordPress (cada leitura fica registrada no servidor) */
  revealWpPassword: (hostname: string) => api.post<{ user: string | null; password: string }>(`/admin/domains/${encodeURIComponent(hostname)}/wp-password`, {}),
  deleteDomain: (hostname: string) => api.del<void>(`/admin/domains/${encodeURIComponent(hostname)}`),
  squads: () => api.get<{ squads: T.Squad[] }>('/admin/squads'),
  saveSquad: (s: { id?: string; name: string; domains: string[]; companyId?: string | null }) => (s.id ? api.put<T.Squad>(`/admin/squads/${s.id}`, s) : api.post<T.Squad>('/admin/squads', s)),
  deleteSquad: (id: string) => api.del<void>(`/admin/squads/${id}`),
  users: () => api.get<{ users: T.User[] }>('/admin/users'),
  createUser: (b: T.CreateUserRequest) => api.post<T.CreateUserResponse>('/admin/users', b),
  /** 0.18: só SuperAdmin (Admin recebe 403). */
  setMetaCampaigns: (a: { id: string; enabled: boolean }) => api.put<T.User>(`/admin/users/${a.id}/meta-campaigns`, { enabled: a.enabled }),
  updateUser: (id: string, b: T.UpdateUserRequest) => api.patch<T.User>(`/admin/users/${id}`, b),
  deleteUser: (id: string) => api.del<void>(`/admin/users/${id}`),
  resendInvite: (id: string) => api.post<{ inviteSent: boolean }>(`/admin/users/${id}/resend-invite`),
  permissions: () => api.get<T.PermissionsResponse>('/admin/permissions'),
  savePermissions: (b: { gestor?: T.Capability[]; gerente?: T.Capability[] }) => api.put<T.PermissionsResponse>('/admin/permissions', b),
  companies: () => api.get<{ companies: T.Company[] }>('/admin/companies'),
  saveCompany: (c: T.CompanyInput & { id?: string }) => (c.id ? api.put<T.Company>(`/admin/companies/${c.id}`, c) : api.post<T.Company>('/admin/companies', c)),
  deleteCompany: (id: string) => api.del<void>(`/admin/companies/${id}`),
  fxDiscount: () => api.get<T.FxDiscountResponse>('/admin/fx-discount'),
  saveFxDiscount: (b: { amount: number; validFrom?: string }) => api.put<T.FxDiscountResponse>('/admin/fx-discount', b),
  /** Força buscar a cotação agora na API de câmbio (o servidor também faz isso sozinho). */
  refreshFx: () => api.post<T.FxLatest>('/admin/fx/refresh'),
  /** 0.18.6 · cotação travada por mês (YYYY-MM) para o ROI. */
  lockFx: (b: { month: string; rate: number; note?: string | null }) => api.put<{ locks: T.FxMonthLock[] }>(`/admin/fx-locks/${b.month}`, { rate: b.rate, note: b.note ?? null }),
  unlockFx: (month: string) => api.del<{ locks: T.FxMonthLock[] }>(`/admin/fx-locks/${month}`),
  /** 0.18.6 · Administração → Relatórios (Meta Ads, Google Ads, Ad Manager). */
  reportAccounts: (p: T.AdminReportPlatform) => api.get<T.AdminReportAccountsResponse>(`/admin/reports/${p}/accounts`),
  report: (p: T.AdminReportPlatform, q: { mode: 'account' | 'period'; from: string; to: string; accounts?: string }) => api.get<T.AdminReportResponse>(`/admin/reports/${p}`, { ...q }),
};

export const financeApi = {
  overview: (q: { company?: string; from?: string; to?: string; currency: T.Currency }) => api.get<T.FinanceOverview>('/finance/overview', q),
  costs: (q: { company?: string; month: string; currency: T.Currency }) => api.get<T.FinanceCostsResponse>('/finance/costs', q),
  saveCost: (c: T.FinanceCostInput & { id?: string }) => (c.id ? api.put<T.FinanceCost>(`/finance/costs/${c.id}`, c) : api.post<T.FinanceCost>('/finance/costs', c)),
  deleteCost: (id: string) => api.del<void>(`/finance/costs/${id}`),
  addCash: (c: T.CashInput) => api.post<{ id: string }>('/finance/cash', c),
  deleteCash: (id: string) => api.del<void>(`/finance/cash/${id}`),
};

/* ----- 0.18 · campanhas Meta automatizadas (só com a flag can_create_meta_campaigns; o servidor responde 403 sem ela) ----- */
const MIN = 60_000;
export const metaCampaignsApi = {
  profiles: () => api.get<{ profiles: T.MetaProfile[]; required: string[] }>('/meta/profiles'),
  /** URL do Facebook Login (OAuth). rerequest = conectar Perfil · reauthenticate = pede a senha do Perfil logado. */
  oauthUrl: (a: { mode?: 'rerequest' | 'reauthenticate'; profileId?: string } = {}) =>
    api.get<{ url: string }>('/meta/oauth/url', { mode: a.mode ?? 'rerequest', ...(a.profileId ? { profileId: a.profileId } : {}) }),
  deleteProfile: (id: string) => api.del<void>(`/meta/profiles/${id}`),
  /** Confere o token na Meta e re-sincroniza BMs, contas, Páginas e Pixels/Datasets. */
  syncProfile: (id: string) => api.post<T.MetaProfileSync>(`/meta/profiles/${id}/sync`, undefined, { timeoutMs: 3 * MIN }),
  adAccounts: (id: string) => api.get<{ adAccounts: T.MetaAdAccount[]; hiddenCount: number }>(`/meta/profiles/${id}/ad-accounts`),
  pages: (id: string) => api.get<{ pages: T.MetaPage[] }>(`/meta/profiles/${id}/pages`),
  /** Pixels/Datasets sincronizados: os dos BMs + os da conta de anúncios. */
  datasets: (id: string, adAccountId: string) => api.get<{ datasets: T.MetaDataset[] }>(`/meta/profiles/${id}/datasets`, { adAccountId }),
  pixels: (id: string, adAccountId: string) => api.get<{ pixels: T.MetaDataset[] }>(`/meta/profiles/${id}/pixels`, { adAccountId }),
  suggestion: (site: string) => api.get<T.MetaSuggestion>('/meta/campaign-suggestion', { site }),
  trackedUrl: (site: string, url: string) => api.post<T.MetaTrackedUrl>('/meta/tracked-url', { site, url }),
  generateCopies: (b: T.MetaCopyRequest) => api.post<T.MetaCopyResponse>('/meta/copies/generate', b, { timeoutMs: 2 * MIN }),
  /** Os arquivos vão do navegador (memória) direto para a API → Meta; nada é salvo em disco. */
  uploadCreatives: (profileId: string, adAccountId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('images', f, f.name);
    return api.post<T.MetaUploadResponse>(`/meta/profiles/${profileId}/creatives`, fd, { query: { adAccountId }, timeoutMs: 5 * MIN });
  },
  publish: (profileId: string, b: T.MetaPublishRequest) => api.post<{ run: T.MetaRun }>(`/meta/profiles/${profileId}/campaigns/publish`, b, { timeoutMs: 10 * MIN }),
  /** Conversões personalizadas da conta + eventos personalizados recebidos pelo Pixel (para "Evento do Pixel"). */
  conversionEvents: (profileId: string, adAccountId: string, datasetId: string) =>
    api.get<T.MetaConversionEvents>(`/meta/profiles/${profileId}/conversion-events`, { adAccountId, datasetId }),
  /* campanhas pendentes de envio */
  drafts: () => api.get<{ drafts: T.MetaDraft[] }>('/meta/campaigns/drafts'),
  draft: (id: string) => api.get<{ draft: T.MetaDraft & { state: Record<string, unknown> } }>(`/meta/campaigns/drafts/${id}`),
  createDraft: (b: T.MetaDraftSave) => api.post<{ draft: T.MetaDraft }>('/meta/campaigns/drafts', b),
  updateDraft: (id: string, b: T.MetaDraftSave) => api.put<{ draft: T.MetaDraft }>(`/meta/campaigns/drafts/${id}`, b),
  deleteDraft: (id: string) => api.del<void>(`/meta/campaigns/drafts/${id}`),
};
