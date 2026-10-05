/**
 * Contrato entre o front (React + Vite) e o servidor Node.js.
 * Todo valor monetário já vem CONVERTIDO para a moeda pedida em `currency`
 * (o servidor guarda original_value + exchange_rate no MySQL e converte na consulta).
 * Percentuais vêm em pontos (ex.: 38.7 = 38,7%). Campos sem dado vêm como null.
 * Datas no formato YYYY-MM-DD, já normalizadas para o timezone da organização.
 */

export type Currency = 'USD' | 'BRL' | 'EUR';
export type Platform = 'google' | 'meta';
/** gestor: só o Squad · admin: tudo menos conectar integrações/frequência do sync · superadmin: tudo */
export type Role = 'gestor' | 'admin' | 'superadmin';

/* ---------- filtros comuns ---------- */
export interface PeriodQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusive)
  domain?: string; // hostname; vazio = todos os domínios do usuário
  currency: Currency;
}

/* ---------- métricas ---------- */
export interface Metrics {
  revenue: number; // receita líquida = receita bruta do Ad Manager × (1 − revShare do domínio). É a que aparece nas telas.
  grossRevenue: number; // receita bruta do Ad Manager (uso interno; não aparece nos relatórios)
  spend: number; // despesa total = googleSpend + metaSpend + iva
  googleSpend: number;
  metaSpend: number; // sem IVA
  iva: number; // IVA sobre a Meta = metaSpend × 13,83%
  googleShare: number | null; // googleSpend / spend × 100
  metaShare: number | null; // metaSpend / spend × 100
  profit: number;
  roi: number | null; // Profit / Spend × 100
  margin: number | null; // Profit / Revenue × 100
  rps: number | null; // Revenue / Sessions × 1000
  ecpm: number | null;
  impressions: number; // impressões de anúncio (GAM)
  adRequests: number;
  responsesServed: number; // GAM "Responses served" (Total code served)
  dropOffRate: number | null; // (responsesServed − impressions) / responsesServed × 100
  fillRate: number | null;
  ctr: number | null; // CTR de anúncio (GAM)
  adClicks: number;
  viewability: number | null;
  sessions: number; // tracking próprio
  trafficClicks: number; // cliques de Google/Meta
  trafficImpressions: number;
  trafficCtr: number | null;
  cpc: number | null;
  attributedRevenue: number;
  unattributedRevenue: number;
  attributionRate: number | null;
}

export interface DailyPoint {
  date: string;
  partial: boolean; // true = dia em andamento
  metrics: Metrics;
}

export interface Comparison {
  from: string;
  to: string;
  metrics: Metrics;
}

/* ---------- auth ---------- */
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  squadId: string | null;
  status: 'active' | 'invited' | 'disabled';
  mustChangePassword: boolean;
  isMainAdmin?: boolean;
  /** Módulos que o usuário pode abrir (ver Capability). SuperAdmin recebe todos. */
  permissions?: Capability[];
}

/* ---------- permissões ---------- */
/** Módulos de visualização (podem ser ligados/desligados para Gestor) e de administração (Admin; conectar/frequência só SuperAdmin). */
export type Capability =
  | 'reports.view' | 'urls.view' | 'campaigns.google.view' | 'campaigns.meta.view' | 'gam.view' | 'attribution.view' | 'utm.debug'
  | 'admin.integrations' | 'admin.integrations.connect' | 'admin.users' | 'admin.domains' | 'admin.utms' | 'admin.currency';
export interface CapabilityDef {
  key: Capability;
  label: string;
  group: 'Visualização' | 'Administração';
  /** true = não pode ser dado ao Gestor (segurança) */
  adminOnly: boolean;
  /** true = só SuperAdmin (conectar integrações e mudar a frequência do sync) */
  superAdminOnly: boolean;
}
export interface PermissionsResponse {
  capabilities: CapabilityDef[];
  roles: Record<Role, Capability[]>; // superadmin sempre tem todas; admin todas menos superAdminOnly
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  user: User;
}

export interface Preferences {
  metrics?: Record<string, string[]>; // seletor de métricas por tela
  dailyMetric?: string;
  domainSort?: 'revenue' | 'roi' | 'spend' | 'profit';
  dense?: boolean;
  sideMini?: boolean;
  currency?: Currency;
}

/* ---------- dashboard / domínios ---------- */
export interface DomainSummary {
  domain: string;
  metrics: Metrics;
}
export interface DashboardResponse {
  period: { from: string; to: string };
  comparison: Comparison | null; // null quando o período é só o dia em andamento
  metrics: Metrics;
  daily: DailyPoint[];
  domains: DomainSummary[];
  lastSyncAt: string | null; // ISO · null = nunca sincronizou
}
export interface DomainDetailResponse {
  domain: string;
  comparison: Comparison | null;
  metrics: Metrics; // domínio inteiro, inclui receita não atribuída
  campaignTotals: Metrics; // soma só das campanhas
  campaignTotalsRoiDays: RoiDays;
  campaigns: CampaignRow[];
}

/* ---------- campanhas ---------- */
export interface RoiDays {
  today: number | null;
  d1: number | null;
  d2: number | null;
  d3: number | null;
}
export interface CampaignRow {
  id: string; // ID da plataforma
  platform: Platform;
  name: string;
  domain: string;
  accountId: string;
  accountName: string;
  status: 'ENABLED' | 'PAUSED';
  metrics: Metrics;
  roiDays: RoiDays;
}
export interface CampaignsResponse {
  comparison: Comparison | null;
  totals: Metrics;
  totalsRoiDays: RoiDays;
  campaigns: CampaignRow[];
  accounts: { id: string; name: string }[];
}
export interface ChildRow {
  id: string;
  name: string;
  metrics: Metrics;
  roiDays: RoiDays;
}
export interface CampaignChildrenResponse {
  groups: (ChildRow & { ads: ChildRow[] })[]; // Google: Ad Group → Ad | Meta: Ad Set → Ad
}
export interface CountryRow {
  country: string; // ISO-2
  name: string;
  metrics: Metrics;
}
export interface CampaignCountriesResponse {
  campaign: Pick<CampaignRow, 'id' | 'name' | 'platform' | 'domain'>;
  totals: Metrics;
  countries: CountryRow[];
}

/* ---------- placements (Google Ads × Ad Manager) ---------- */
/** website: site (host sem www) · app: mobileapp::… · youtube: vídeos/canais · google: produtos do Google (Gmail…) */
export type PlacementType = 'website' | 'app' | 'youtube' | 'google' | 'other';
export interface PlacementFiltersResponse {
  domain: string;
  accounts: { id: string; name: string; externalId: string; campaigns: number }[];
  campaigns: { id: string; name: string; accountId: string; status: 'ENABLED' | 'PAUSED' }[]; // só Google Ads do domínio
}
export interface PlacementQuery extends PeriodQuery {
  domain: string; // obrigatório
  accounts?: string; // ids separados por vírgula · vazio = todas as contas do domínio
  campaigns?: string; // IDs das campanhas separados por vírgula · vazio = todas
}
export interface PlacementRow {
  key: string; // host (lp.site.com), "youtube.com" ou "mobileapp::…"
  label: string;
  type: PlacementType;
  metrics: Metrics;
  roiDays: RoiDays;
  recent: [number, number][]; // [spend, revenue] de hoje, D-1, D-2, D-3 (soma do ROI D-x quando a lista é filtrada)
}
export interface PlacementGroup extends PlacementRow {
  children: PlacementRow[]; // subdomínios agrupados no domínio principal (inclui o próprio domínio)
}
export interface PlacementsResponse {
  domain: string;
  selection: { accounts: number; accountsTotal: number; campaigns: number; campaignsTotal: number }; // accounts 0 = todas
  comparison: Comparison | null;
  totals: Metrics;
  totalsRoiDays: RoiDays;
  groups: PlacementGroup[];
}
export interface PlacementCampaignsResponse {
  placement: string;
  level: 'root' | 'host';
  totals: Metrics;
  hosts: { key: string; metrics: Metrics }[]; // só no nível root
  campaigns: { id: string; name: string; accountName: string; status: 'ENABLED' | 'PAUSED'; metrics: Metrics }[];
}

/* ---------- URLs / Ad Manager ---------- */
export interface UrlRow {
  domain: string;
  path: string;
  metrics: Metrics;
}
export interface UrlsResponse {
  urls: UrlRow[];
}
export interface GamSummaryResponse {
  network: { name: string; code: string; currency: Currency };
  metrics: Metrics;
  domains: DomainSummary[];
}

/* ---------- relatórios (dia e mês) ---------- */
export interface ReportQuery {
  domain?: string;
  currency: Currency;
}
export interface ReportRow {
  key: string; // dia: YYYY-MM-DD · mês: YYYY-MM
  partial: boolean; // contém hoje ou D-1 a D-3 (ainda pode mudar)
  metrics: Metrics;
}
export interface DailyReportResponse {
  month: string; // YYYY-MM
  total: Metrics; // total do mês
  days: ReportRow[]; // mais recente primeiro
}
export interface MonthlyReportResponse {
  total: Metrics; // total de todos os meses devolvidos
  months: ReportRow[]; // mais recente primeiro
}

/* ---------- atribuição / UTM ---------- */
export type IssueType =
  | 'missing_campaign_id'
  | 'missing_adgroup_id'
  | 'missing_creative_id'
  | 'invalid_utm'
  | 'unknown_domain'
  | 'campaign_not_found'
  | 'meta_ad_not_found'
  | 'gads_creative_not_found';
export interface AttributionIssue {
  type: IssueType;
  title: string;
  sessions: number;
  revenue: number;
  domains: string[];
  cause: string;
  action: string;
}
export interface AttributionHealthResponse {
  metrics: Metrics;
  issues: AttributionIssue[];
  daily: { date: string; attributionRate: number | null }[];
  domains: { domain: string; registered: boolean; revenue: number; unattributed: number; attributionRate: number | null }[];
}
export interface UtmTemplates {
  google: string;
  meta: string;
}
export type CheckLevel = 'ok' | 'warn' | 'error';
export interface UtmDebugResponse {
  status: 'valid' | 'invalid';
  source: 'Google Ads' | 'Meta Ads' | null;
  domain: string;
  campaign: { id: string; name: string } | null;
  fields: Record<string, string | null>; // campaignId, adGroupId, creative, placement, keyword, network, device
  checks: { level: CheckLevel; message: string; detail?: string }[];
  preview: { google: string; meta: string };
}

/* ---------- integrações / contas ---------- */
export type ConnStatus = 'ok' | 'late' | 'error' | 'permission' | 'token' | 'disconnected' | 'not_imported';
export interface AccountStatus {
  id: string;
  name: string;
  externalId: string;
  currency: Currency;
  timezone: string;
  status: ConnStatus;
  imported?: boolean;
  lastSyncAt: string | null;
  message?: string;
}
export interface IntegrationsResponse {
  google: { connected: boolean; googleAccount: string; mccName: string; mccCustomerId: string; accountsFound: number; lastSyncAt: string | null; accounts: AccountStatus[] };
  meta: { connected: boolean; business: string; user: string; lastSyncAt: string | null; accounts: AccountStatus[] };
  gam: { connected: boolean; googleAccount: string; networkName: string; networkCode: string; currency: Currency; timezone: string; status: ConnStatus; lastSyncAt: string | null };
}
/* ---------- contas das integrações (CRUD) ---------- */
export type Provider = 'google-ads' | 'meta' | 'gam';
export interface IntegrationAccount {
  id: string;
  provider: Provider;
  name: string;
  externalId: string; // Google: 123-456-7890 · Meta: act_… · GAM: network code
  currency: Currency;
  timezone: string;
  imported: boolean; // entra no sync
  domains: string[]; // domínios ligados à conta
  status: ConnStatus;
  lastSyncAt: string | null;
  message?: string;
}
export type IntegrationAccountInput = Pick<IntegrationAccount, 'name' | 'externalId' | 'currency' | 'timezone' | 'imported' | 'domains'>;
export interface SyncSetting {
  id: string; // ex.: google-ads.metrics
  provider: Provider | 'fx';
  label: string;
  window: string; // descrição da janela baixada
  everyMinutes: number; // frequência
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'success' | 'failed' | 'running' | null;
}

export interface OAuthStartResponse {
  authorizeUrl: string; // o front redireciona o navegador para cá
}

/* ---------- admin ---------- */
export interface DomainInput {
  hostname?: string; // renomear
  revShare?: number; // % retido pela Network (ex.: 20 = 20%)
  revShareFrom?: string; // YYYY-MM-DD a partir de quando vale (padrão: hoje; o primeiro vale para todo o histórico)
  active?: boolean;
  squadId?: string | null;
  googleAccounts?: string[]; // ids de IntegrationAccount
  metaAccounts?: string[];
}
export interface Domain {
  hostname: string;
  revShare: number; // % vigente hoje (só configuração; nunca aparece em relatório)
  revShareFrom: string | null;
  createdBySync?: boolean; // site que apareceu no Ad Manager e ainda não foi cadastrado
  active: boolean;
  squadId: string | null;
  googleAccounts: string[];
  metaAccounts: string[];
  lastDataAt: string | null;
}
export interface Squad {
  id: string;
  name: string;
  domains: string[];
  userIds: string[];
}
export interface CreateUserRequest {
  name: string;
  email: string;
  role: Role;
  squadId: string | null;
}
export interface UpdateUserRequest {
  name?: string;
  role?: Role;
  squadId?: string | null;
  status?: 'active' | 'disabled';
}
export interface CreateUserResponse {
  user: User;
  inviteSent: boolean; // o servidor envia o e-mail por admin@plutomidia.com.br
}
export interface FxLatest {
  base: 'USD';
  rates: Record<Currency, number>;
  fetchedAt: string;
  source: string;
}
export interface FxHistoryRow {
  date: string;
  BRL: number;
  EUR: number;
}

export interface SearchResult {
  kind: 'campaign' | 'domain' | 'url';
  label: string;
  sub?: string;
  platform?: Platform;
  domain?: string;
  id?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
