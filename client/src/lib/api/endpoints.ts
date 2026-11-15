/**
 * Um lugar só com TODAS as rotas que o servidor Node.js precisa expor.
 * A documentação completa (parâmetros e respostas) está em docs/API.md.
 */
import { api } from './client';
import type * as T from '@/types/api';

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
  unmappedCampaigns: (platform: T.Platform = 'meta', days = 30) => api.get<T.UnmappedCampaignsResponse>('/admin/campaigns/unmapped', { platform, days }),
  setCampaignDomain: (a: { id: string; platform: T.Platform; domain: string | null }) => api.patch<T.SetCampaignDomainResponse>(`/admin/campaigns/${encodeURIComponent(a.id)}`, { platform: a.platform, domain: a.domain }),
  createDomain: (hostname: string) => api.post<T.Domain>('/admin/domains', { hostname }),
  updateDomain: (hostname: string, patch: T.DomainInput) => api.patch<T.Domain>(`/admin/domains/${encodeURIComponent(hostname)}`, patch),
  /** 0.17: mostra a senha do WordPress (cada leitura fica registrada no servidor) */
  revealWpPassword: (hostname: string) => api.post<{ user: string | null; password: string }>(`/admin/domains/${encodeURIComponent(hostname)}/wp-password`, {}),
  deleteDomain: (hostname: string) => api.del<void>(`/admin/domains/${encodeURIComponent(hostname)}`),
  squads: () => api.get<{ squads: T.Squad[] }>('/admin/squads'),
  saveSquad: (s: { id?: string; name: string; domains: string[]; companyId?: string | null }) => (s.id ? api.put<T.Squad>(`/admin/squads/${s.id}`, s) : api.post<T.Squad>('/admin/squads', s)),
  deleteSquad: (id: string) => api.del<void>(`/admin/squads/${id}`),
  users: () => api.get<{ users: T.User[] }>('/admin/users'),
  createUser: (b: T.CreateUserRequest) => api.post<T.CreateUserResponse>('/admin/users', b),
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
};

export const financeApi = {
  overview: (q: { company?: string; from?: string; to?: string; currency: T.Currency }) => api.get<T.FinanceOverview>('/finance/overview', q),
  costs: (q: { company?: string; month: string; currency: T.Currency }) => api.get<T.FinanceCostsResponse>('/finance/costs', q),
  saveCost: (c: T.FinanceCostInput & { id?: string }) => (c.id ? api.put<T.FinanceCost>(`/finance/costs/${c.id}`, c) : api.post<T.FinanceCost>('/finance/costs', c)),
  deleteCost: (id: string) => api.del<void>(`/finance/costs/${id}`),
  addCash: (c: T.CashInput) => api.post<{ id: string }>('/finance/cash', c),
  deleteCash: (id: string) => api.del<void>(`/finance/cash/${id}`),
};
