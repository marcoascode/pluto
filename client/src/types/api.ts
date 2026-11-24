/**
 * Contrato entre o front (React + Vite) e o servidor Node.js.
 * Moedas (0.18.6): nada é convertido nos relatórios. Receita do Ad Manager e derivados (eCPM, RPS, CPC ADX…) em USD;
 * despesas (Google Ads + Meta Ads + IVA), ROI em R$ (profit) e custos por ação em BRL.
 * ROI (R$) = Receita (US$) × cotação USD/BRL (travada no mês ou a atual c/ deságio) − Despesas (R$).
 * Percentuais vêm em pontos (ex.: 38.7 = 38,7%). Campos sem dado vêm como null.
 * Datas no formato YYYY-MM-DD, já normalizadas para o timezone da organização.
 */

export type Currency = 'USD' | 'BRL' | 'EUR';
export type Platform = 'google' | 'meta';
/** gestor: os domínios dele, só as campanhas das contas dele · gerente: vários Squads, sem administração ·
 *  admin: tudo menos conectar integrações/sync · superadmin: tudo */
export type Role = 'gestor' | 'gerente' | 'admin' | 'superadmin';

/* ---------- filtros comuns ---------- */
export interface PeriodQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusive)
  domain?: string; // hostname; vazio = todos os domínios do usuário
  company?: string; // id da Empresa (seletor do topo); vazio = todas as Empresas que o usuário vê
}

/* ---------- métricas ---------- */
export interface Metrics {
  revenue: number; // USD · receita líquida = receita bruta do Ad Manager × (1 − revShare do domínio). É a que aparece nas telas.
  revenueBrl: number; // receita em R$ pela cotação do ROI (travada no mês ou atual c/ deságio)
  fxRate: number | null; // cotação média usada no ROI (revenueBrl ÷ revenue)
  grossRevenue: number; // receita bruta do Ad Manager (uso interno; não aparece nos relatórios)
  spend: number; // BRL · despesa total = googleSpend + metaSpend + iva
  googleSpend: number;
  metaSpend: number; // sem IVA
  iva: number; // IVA sobre a Meta = metaSpend × 13,83%
  googleShare: number | null; // googleSpend / spend × 100
  metaShare: number | null; // metaSpend / spend × 100
  profit: number; // BRL · ROI (R$) = revenueBrl − spend
  roi: number | null; // Profit / Spend × 100
  margin: number | null; // Profit / revenueBrl × 100
  rps: number | null; // Receita / Sessões
  sessionRpm: number | null; // RPM de Sessão = Receita / Sessões × 1000
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
  /** 0.15 · receita com utm_source de retenção: total, Push (pushalert / …push) e WhatsApp (…wpp / …whatsapp) */
  retentionRevenue?: number; pushRevenue?: number; whatsappRevenue?: number;
  attributionRate: number | null;
  cpcAdx: number | null; // Receita / cliques ADX
  // Meta Ads (actions): impressões, cliques no link, conversas iniciadas, leads e custo por ação (custo Meta sem IVA ÷ ação)
  metaImpressions: number;
  metaLinkClicks: number;
  cpcLink: number | null;
  metaResults: number;
  cpr: number | null;
  metaLeads: number;
  cpl: number | null;
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
export type CommissionMode = 'progressive' | 'fixed';
/** Faixa da comissão progressiva: a partir de `from` (ROI do mês), `pct`%. */
export interface CommissionTier { from: number; pct: number }
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  squadIds: string[]; // Gerente: Squads que ele vê
  companyIds: string[]; // Empresas em que é sócio (sócio vê a Empresa inteira)
  domains: DomainLink[]; // Gestor: domínio + contas que ele usa ali
  status: 'active' | 'invited' | 'disabled';
  mustChangePassword: boolean;
  isMainAdmin?: boolean;
  /** 0.18: criação automatizada de campanhas Meta. Só o SuperAdmin atribui. */
  canCreateMetaCampaigns?: boolean;
  /** 0.18.8: Gestor — comissão progressiva (faixas do painel de Comissões) ou fixa (commissionPct %). */
  commissionMode?: CommissionMode;
  commissionPct?: number | null;
  /** 0.18.10: faixas da progressiva do próprio gestor (na moeda commissionTierCurrency) */
  commissionTiers?: CommissionTier[] | null;
  commissionTierCurrency?: Currency;
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
  roles: Record<Role, Capability[]>; // gestor e gerente configuráveis · superadmin todas · admin todas menos superAdminOnly
}
/** Gestor: um domínio que ele gere e as contas Google Ads / Meta Ads que usa nesse domínio (ids de IntegrationAccount). */
export interface DomainLink { domain: string; googleAccounts: string[]; metaAccounts: string[] }

/* ---------- Empresas (sociedades) ---------- */
export interface CompanyPartner { id: string; name: string; role: Role }
/** Seletor "Empresa" do topo. Só os domínios que o usuário vê. */
export interface MyCompany {
  id: string;
  name: string;
  partners: CompanyPartner[];
  squads: { id: string; name: string; domains: string[] }[];
  domains: string[];
}
export interface CompanyOverviewResponse {
  company: { id: string; name: string; partners: CompanyPartner[] };
  period: { from: string; to: string };
  comparison: Comparison | null;
  totals: Metrics;
  daily: DailyPoint[];
  squads: { id: string; name: string; metrics: Metrics; domains: { domain: string; metrics: Metrics; gestores: { id: string; name: string }[] }[] }[];
}
/** Admin → Empresas */
export interface Company { id: string; name: string; partnerIds: string[]; squadIds: string[] }
export type CompanyInput = Omit<Company, 'id'>;

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
  /** Sem domínio: o custo está no domínio técnico "Sem domínio" (só Admin vê) → mostrar o seletor de domínio. */
  noDomain?: boolean;
  /** Domínio definido à mão (PATCH /admin/campaigns/:id); o sync não troca. */
  domainManual?: boolean;
  accountId: string;
  accountName: string;
  status: 'ENABLED' | 'PAUSED';
  metrics: Metrics;
  roiDays: RoiDays;
}
/** GET /admin/campaigns/unmapped: campanhas sem domínio (custo em "Sem domínio" nos últimos N dias, ou ativas sem domínio). */
export interface UnmappedCampaign {
  id: string; name: string; platform: Platform; status: string; accountId: string; accountName: string;
  spend: number; clicks: number; rows: number; firstDate: string | null; lastDate: string | null;
}
export interface UnmappedCampaignsResponse { platform: Platform; days: number; campaigns: UnmappedCampaign[]; totals: { spend: number; rows: number } }
/** 0.18 · auditoria do sufixo de UTM dos anúncios Meta (GET /admin/utm-audit/meta). */
export type MetaTagStatus = 'ok' | 'missing' | 'different' | 'unread';
export interface MetaTagAuditAd {
  id: string; name: string; status: MetaTagStatus; params: Record<string, string>; attributable: boolean;
  urlTags: string | null; adset: string; campaignId: string; campaignName: string;
  accountId: string; accountName: string; managers: string | null; domain: string | null; spend: number;
}
export interface MetaTagAuditResponse {
  template: string; days: number;
  totals: Record<MetaTagStatus, number> & { spendAtRisk: number };
  ads: MetaTagAuditAd[];
}
export interface SetCampaignDomainResponse {
  campaign: { id: string; platform: Platform; name: string; domain: string | null; domainManual: boolean };
  movedRows: number;
  resync: 'started' | 'queued' | null;
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
  /** 0.15: receita do domínio principal distribuída pelo custo (o Ad Manager não informou o subdomínio) */
  estimated?: boolean;
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
  hosts: { key: string; metrics: Metrics; estimated?: boolean }[]; // só no nível root
  campaigns: { id: string; name: string; accountName: string; status: 'ENABLED' | 'PAUSED'; metrics: Metrics }[];
}

/* ---------- URLs / Ad Manager ---------- */
export interface UrlRow {
  domain: string;
  path: string;
  metrics: Metrics;
}
/** Origem da receita (utm_source): Google Ads / Meta Ads (campanha atribuída), retenção manual (push, whatsapp…) ou Sem origem. */
export interface UrlOrigin { key: string; label: string; kind: 'google' | 'meta' | 'retention' | 'none'; metrics: Metrics }
export interface UrlsResponse {
  urls: UrlRow[];
  origins: UrlOrigin[];
  origin: string | null; // filtro aplicado (?origin=)
}
export interface GamSummaryResponse {
  network: { name: string; code: string; currency: Currency };
  metrics: Metrics;
  domains: DomainSummary[];
}

/* ---------- relatórios (dia e mês) ---------- */
export interface ReportQuery {
  domain?: string;
  company?: string;
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
/** Cotação do ROI do mês: travada (câmbio fechado) ou a atual c/ deságio. */
export interface MonthFx { rate: number | null; locked: boolean; note: string | null; lockedAt: string | null; lockedBy: string | null }
export interface MonthlyReportResponse {
  total: Metrics; // total de todos os meses devolvidos
  months: (ReportRow & { fx: MonthFx })[]; // mais recente primeiro
  currentRate: number | null; // USD/BRL c/ deságio (meses sem trava)
  canLock: boolean; // Admin/SuperAdmin
}
export interface FxMonthLock { month: string; rate: number; note: string | null; createdAt: string; createdBy: string | null }

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
export type ConnStatus = 'ok' | 'warn' | 'late' | 'error' | 'permission' | 'token' | 'disconnected' | 'not_imported';
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
  gam: { connected: boolean; googleAccount: string; networkName: string; networkCode: string; currency: Currency; timezone: string; status: ConnStatus; lastSyncAt: string | null; accounts?: AccountStatus[] };
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
  domains: string[]; // domínios ligados à conta (0.18.8: vêm dos vínculos de Usuários & Squads; só leitura)
  status: ConnStatus;
  lastSyncAt: string | null;
  message?: string;
}
export type IntegrationAccountInput = Pick<IntegrationAccount, 'name' | 'externalId' | 'currency' | 'timezone' | 'imported'>;
export interface SyncSetting {
  id: string; // ex.: google-ads.metrics
  provider: Provider | 'fx';
  label: string;
  window: string; // descrição da janela baixada (ex.: "D-3 → hoje")
  windowMode: 'days' | 'incremental' | 'fixed'; // fixed = sem janela (estrutura, câmbio, limpeza)
  windowDays: number | null; // X de D-X
  windowEditable: boolean;
  hasRetention: boolean; // jobs de limpeza
  retentionDays: number | null; // "Excluir dados com mais de X dias" (null = desligado)
  lastMessage: string | null;
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
  gamAccountId?: string | null; // conta do Ad Manager do domínio (uma só)
  revShareFrom?: string; // YYYY-MM-DD a partir de quando vale (padrão: hoje; o primeiro vale para todo o histórico)
  active?: boolean;
  squadId?: string | null;
  // 0.18.8: contas Google/Meta do domínio não se editam aqui (só em Usuários & Squads → gestor → Domínios)
  /** 0.18.9: rateio entre os gestores do domínio (todos, soma = 100). null = dividir igualmente. */
  managerShares?: { userId: string; sharePct: number }[] | null;
  /** 0.17: registro do domínio */
  registrar?: string | null; expiresOn?: string | null; hosting?: string | null; wpUser?: string | null;
  /** texto = troca a senha · null = apaga · ausente = mantém (a senha nunca volta na lista) */
  wpPassword?: string | null;
}
export interface Domain {
  hostname: string;
  /** Domínio técnico "Sem domínio" (sistema): só Admin vê, não se edita nem se vincula. */
  technical?: boolean;
  revShare: number; // % vigente hoje (só configuração; nunca aparece em relatório)
  revShareFrom: string | null;
  createdBySync?: boolean; // site que apareceu no Ad Manager e ainda não foi cadastrado
  active: boolean;
  squadId: string | null;
  googleAccounts: string[];
  metaAccounts: string[];
  gamAccountId: string | null;
  /** Gestores do domínio e as contas de cada um (editado em Usuários). */
  /** sharePct: 0.18.9 rateio da receita do domínio (null = dividido igualmente) */
  managers: { userId: string; name: string; sharePct: number | null; googleAccounts: string[]; metaAccounts: string[] }[];
  lastDataAt: string | null;
  /** 0.17: registro do domínio (a senha WP só por adminApi.revealWpPassword) */
  registrar?: string | null; expiresOn?: string | null; hosting?: string | null; wpUser?: string | null; hasWpPassword?: boolean;
}
export interface Squad {
  id: string;
  name: string;
  companyId: string | null;
  domains: string[];
  userIds: string[]; // Gerentes que veem este Squad
}
export interface CreateUserRequest {
  name: string;
  email: string;
  role: Role;
  squadIds?: string[]; // só Gerente
  companyIds?: string[];
  domains?: DomainLink[]; // só Gestor
  commissionMode?: CommissionMode; // só Gestor
  commissionPct?: number | null;
  commissionTiers?: CommissionTier[] | null;
  commissionTierCurrency?: Currency;
}
export interface UpdateUserRequest {
  name?: string;
  role?: Role;
  squadIds?: string[];
  companyIds?: string[];
  domains?: DomainLink[];
  status?: 'active' | 'disabled';
  commissionMode?: CommissionMode;
  commissionPct?: number | null;
  commissionTiers?: CommissionTier[] | null;
  commissionTierCurrency?: Currency;
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
  brlDiscount: number; // deságio vigente (R$)
  brlDiscountFrom: string | null;
  brlRevenueRate: number | null; // USD/BRL c/ deságio = cotação − deságio (usado no ROI dos meses sem cotação travada)
}
export interface FxDiscountResponse {
  current: { amount: number; validFrom: string } | null;
  history: { amount: number; validFrom: string; createdAt: string; createdBy: string | null }[];
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

/* ---------- Finance (Caixa Empresa e Custos) ---------- */
export type CostCategory = 'tools' | 'domains' | 'hosting' | 'team' | 'taxes' | 'services' | 'other';
export interface FinanceCompany { id: string; name: string }
export interface MonthClose {
  month: string; // YYYY-MM
  partial: boolean; // mês atual
  revenue: number; googleSpend: number; metaSpend: number; iva: number;
  adSpend: number; // Google + Meta + IVA
  costs: number; // custos lançados que valem no mês
  costsByCategory: Partial<Record<CostCategory, number>>;
  result: number; // receita − anúncios − custos
  margin: number | null;
  companies: { companyId: string; revenue: number; adSpend: number; costs: number; result: number }[];
}
export interface CashEntry { id: string; date: string; kind: 'balance' | 'deposit' | 'withdrawal'; amount: number; currency: Currency; converted: number; note: string | null; createdBy: string | null }
export interface CashCompany {
  companyId: string; companyName: string;
  anchor: { date: string; amount: number } | null;
  resultSince: number; costsSince: number; deposits: number; withdrawals: number;
  balance: number | null;
  entries: CashEntry[];
}
export interface FinanceOverview {
  currency: Currency; from: string; to: string; companies: FinanceCompany[]; selected: string | null;
  cash: { total: number | null; companies: CashCompany[] };
  months: MonthClose[];
  totals: { revenue: number; googleSpend: number; metaSpend: number; iva: number; adSpend: number; costs: number; result: number; margin: number | null };
  outside: { revenue: number; adSpend: number } | null; // Admin: domínios fora das Empresas
}
export interface FinanceCost {
  id: string; companyId: string; companyName: string; name: string; category: CostCategory; amount: number; currency: Currency;
  recurrence: 'monthly' | 'once'; startMonth: string; endMonth: string | null; payDay: number; notes: string | null;
  appliesInMonth?: boolean; monthAmount?: number;
}
export type FinanceCostInput = Omit<FinanceCost, 'id' | 'companyName' | 'appliesInMonth' | 'monthAmount'>;
export interface FinanceCostsResponse {
  currency: Currency; month: string; companies: FinanceCompany[]; costs: FinanceCost[];
  totals: { month: number; recurring: number; once: number; byCategory: Partial<Record<CostCategory, number>> };
}
export interface CashInput { companyId: string; date: string; kind: CashEntry['kind']; amount: number; currency: Currency; note?: string | null }


/* ---------- 0.18 · criação automatizada de campanhas Meta ---------- */
/** Perfil Meta de contingência. 0.18.2: conectado via Facebook Login (source 'oauth'); 'system_user' = token manual legado. */
export interface MetaProfile {
  id: string;
  name: string;
  source: 'oauth' | 'system_user';
  /** id do Perfil do Facebook que autorizou (app-scoped) */
  fbUserId: string | null;
  email: string | null;
  businessId: string | null;
  systemUserName: string | null;
  tokenLast4: string | null;
  status: 'valid' | 'invalid' | 'pending' | 'expired';
  message: string | null;
  scopes: string[];
  declinedScopes: string[];
  /** null = não expira (System User legado) */
  tokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  counts: { businesses: number; adAccounts: number; pages: number; datasets: number };
  createdAt: string;
  updatedAt: string;
}
export interface MetaProfileSync { profile: MetaProfile; sync: { counts: { business: number; ad_account: number; page: number; dataset: number }; warnings: string[] } }
export interface MetaAdAccount { id: string; name: string; status: number | null; currency: string | null; timezone: string | null; businessId: string | null; plutoAccountId: string; sites: string[] }
export interface MetaPage { id: string; name: string; category: string | null; tasks: string[] }
export interface MetaDataset { id: string; name: string; lastFiredAt: string | null; unavailable: boolean }

export const META_CTAS = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'DOWNLOAD', 'WATCH_MORE', 'GET_OFFER', 'APPLY_NOW', 'SUBSCRIBE'] as const;
export type MetaCta = (typeof META_CTAS)[number];
export const META_COPY_LIMITS = { headline: 40, primaryText: 125, description: 30 } as const;
export const META_OBJECTIVES = ['OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT'] as const;
/** Posicionamentos manuais do Conjunto (targeting.publisher_platforms / <plataforma>_positions / device_platforms). */
export const META_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'] as const;
export type MetaPlatform = (typeof META_PLATFORMS)[number];
export const META_PLATFORM_POSITIONS = {
  facebook: ['feed', 'profile_feed', 'marketplace', 'right_hand_column', 'search', 'story', 'facebook_reels', 'instream_video'],
  instagram: ['stream', 'profile_feed', 'explore', 'explore_home', 'ig_search', 'story', 'reels'],
  audience_network: ['classic', 'rewarded_video'],
  messenger: ['messenger_home', 'story'],
} as const satisfies Record<MetaPlatform, readonly string[]>;
export const META_DEVICES = ['mobile', 'desktop'] as const;
export const META_OPT_GOALS = ['LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'REACH'] as const;
export const META_CONVERSION_EVENTS = ['PURCHASE', 'LEAD', 'COMPLETE_REGISTRATION', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'ADD_PAYMENT_INFO', 'ADD_TO_WISHLIST', 'CONTENT_VIEW',
  'SEARCH', 'CONTACT', 'SCHEDULE', 'START_TRIAL', 'SUBMIT_APPLICATION', 'SUBSCRIBE'] as const;
/** Eventos personalizados do Pixel para o campo "Evento do Pixel" (além dos padrão). */
export interface MetaConversionEvents { customConversions: { id: string; name: string; eventType: string | null }[]; customEvents: { name: string; count: number }[]; warnings: string[] }

export interface MetaCopy { angle?: string; headline: string; primaryText: string; description: string; cta: MetaCta }
export interface MetaCopyRequest { site: string; count: number; offer: string; language: 'pt-BR' | 'en-US' | 'es-ES'; tone?: string }
export interface MetaCopyResponse { site: string; model: string; requested: number; returned: number; dropped: number; variations: MetaCopy[] }

export interface MetaSuggestion {
  site: string;
  window: { from: string; to: string; days: number };
  confidence: 'high' | 'medium' | 'low' | 'none';
  objective: { value: (typeof META_OBJECTIVES)[number]; optimizationGoal: (typeof META_OPT_GOALS)[number]; basis: string; note: string };
  dailyBudget: { usd: number | null; brl: number | null; rangeUsd: [number, number] | null; basis: string; note: string };
  audience: { countries: { code: string; spendUsd: number; revenueUsd: number; roi: number | null }[]; avoidCountries: { code: string; spendUsd: number; roi: number | null }[]; ageMin: number; ageMax: number; genders: 'all'; basis: string; note: string };
  evidence: { campaignId: string; name: string; spendUsd: number; revenueUsd: number; roi: number | null; avgDailySpendUsd: number | null }[];
  warnings: string[];
}
export interface MetaTrackedUrl { site: string; link: string; urlTags: string; preview: string; replaced: string[] }

export interface MetaUploadResponse {
  adAccountId: string;
  uploaded: { index: number; filename: string; imageHash: string; url: string | null; bytes: number }[];
  failed: { index: number; filename: string; code: string; message: string }[];
}

export interface MetaPublishRequest {
  adAccountId: string;
  pageId: string;
  site: string;
  url: string;
  source: 'manual' | 'ai';
  suggestion?: {
    objective: { value: MetaSuggestion['objective']['value']; optimizationGoal: MetaSuggestion['objective']['optimizationGoal'] };
    dailyBudget: { usd: number | null; brl: number | null };
    audience: { countries: { code: string }[]; ageMin: number; ageMax: number; genders: 'all' };
  };
  campaign: { name?: string; objective?: MetaSuggestion['objective']['value']; status: 'PAUSED' | 'ACTIVE' };
  adset: { dailyBudget?: number; optimizationGoal?: MetaSuggestion['objective']['optimizationGoal']; countries?: string[]; ageMin?: number; ageMax?: number; genders?: 'all' | 'male' | 'female';
    /** Omitido = posicionamentos automáticos (Advantage+). */
    publisherPlatforms?: MetaPlatform[]; positions?: Partial<Record<MetaPlatform, string[]>>; devicePlatforms?: (typeof META_DEVICES)[number][] };
  tracking: { datasetId?: string; linkDatasetToAdSet: boolean; conversionEvent?: (typeof META_CONVERSION_EVENTS)[number]; customConversionId?: string; customEventName?: string; linkPixelToAds: boolean };
  imageHashes: string[];
  copies: MetaCopy[];
  pairing: 'zip' | 'cross';
  rollbackOnFailure: boolean;
}
export interface MetaRunStep { id: string; seq: number; kind: 'campaign' | 'adset' | 'creative' | 'ad' | 'rollback'; label: string; status: string; metaId: string | null; attempts: number; rateLimited: boolean; errorHttp: number | null; errorMessage: string | null }
export interface MetaRun { id: string; profileId: string; adAccountId: string; site: string; source: string; name: string; status: string; metaCampaignId: string | null; metaAdsetId: string | null; error: string | null; createdAt: string; finishedAt: string | null; steps: MetaRunStep[] }

/** Campanha pendente de envio (rascunho do assistente). */
export type MetaDraftStatus = 'draft' | 'pending' | 'failed';
export interface MetaDraft {
  id: string; profileId: string | null; adAccountId: string | null; site: string | null; name: string; status: MetaDraftStatus;
  lastError: string | null; lastRunId: string | null; createdAt: string; updatedAt: string; copies: number; images: number;
}
export interface MetaDraftSave { name: string; profileId?: string | null; adAccountId?: string | null; site?: string | null; status: MetaDraftStatus; lastError?: string | null; lastRunId?: string | null; state: Record<string, unknown> }

/** Permissões obrigatórias do System User Token (o servidor confere o mesmo conjunto). */
export const META_REQUIRED_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'public_profile'] as const;

/* ---------- 0.18.6 · Administração → Relatórios (só Admin/SuperAdmin) ---------- */
export type AdminReportPlatform = 'meta' | 'google-ads' | 'gam';
export interface AdminReportAccount { id: string; name: string; externalId: string; currency: string; imported: boolean; status: string }
export interface AdminReportAccountsResponse { platform: AdminReportPlatform; currency: Currency; accounts: AdminReportAccount[] }
/** Métricas por plataforma: Meta e Google Ads em BRL, Ad Manager em USD (sem conversão). */
export type AdminReportMetrics = Record<string, number | null>;
export interface AdminReportRow { date: string | null; accountId: string; accountName: string; externalId: string; metrics: AdminReportMetrics }
export interface AdminReportResponse {
  platform: AdminReportPlatform; mode: 'account' | 'period'; from: string; to: string; currency: Currency;
  accounts: AdminReportAccount[]; rows: AdminReportRow[]; total: AdminReportMetrics;
}
