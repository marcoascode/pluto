/**
 * Servidor FALSO: responde às mesmas rotas de docs/API.md usando mocks/db.ts.
 * Aplica a mesma regra de Squad que o backend precisa aplicar.
 */
import { ApiError } from '@/lib/api/client';
import type * as T from '@/types/api';
import { addDays, lastMonths } from '@/lib/period';
import { agg, CAMPS, COMPANIES, CT, DATES, DAYS, DOMAINS, FX, FXD, GACC, MACC, ROWS, SQUADS, TODAY, UNKNOWN_DOMAIN, USERS, accName, dayIndex, discountAt, originOf, TECH, type Row } from './db';
import { PL_LABEL, placementRows, typeOf, type PRow } from './placements';
import { financeCosts, financeMutate, financeOverview } from './finance';
import { linksMock, setWpPassword, wpPasswordOf } from './links';

/** Guarda sessão/preferências do mock. Se o navegador bloquear o storage (prévia com sandbox, aba anônima), fica em memória. */
const MEM = new Map<string, string>();
const LS = {
  get: <V,>(k: string): V | null => { let raw: string | null = null; try { raw = localStorage.getItem(k); } catch { /* sem storage */ } if (raw == null) raw = MEM.get(k) ?? null; try { return JSON.parse(raw || 'null'); } catch { return null; } },
  set: (k: string, v: unknown) => { const raw = JSON.stringify(v); MEM.set(k, raw); try { localStorage.setItem(k, raw); } catch { /* sem storage */ } },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const me = (): (typeof USERS)[number] | null => USERS.find((u) => u.id === LS.get<string>('pluto_mock_session')) ?? null;
/* ---- permissões (mesma regra do servidor) ---- */
const CAPS: T.CapabilityDef[] = [
  { key: 'reports.view', label: 'Relatórios (dia e mês)', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'urls.view', label: 'URLs e Drop-off', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'campaigns.google.view', label: 'Google Ads', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'campaigns.meta.view', label: 'Meta Ads', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'gam.view', label: 'Google Ad Manager', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'attribution.view', label: 'Attribution Health', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'utm.debug', label: 'UTM Debugger', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'admin.integrations', label: 'Contas das integrações (cadastrar, editar, importar, excluir)', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.integrations.connect', label: 'Conectar integrações (OAuth) e editar a frequência do sync', group: 'Administração', adminOnly: true, superAdminOnly: true },
  { key: 'admin.users', label: 'Usuários, Squads e permissões', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.domains', label: 'Domínios e revShare', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.utms', label: 'UTMs globais', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.currency', label: 'Moedas e câmbio', group: 'Administração', adminOnly: true, superAdminOnly: false },
];
let GESTOR_CAPS: T.Capability[] = CAPS.filter((c) => !c.adminOnly).map((c) => c.key);
let GERENTE_CAPS: T.Capability[] = CAPS.filter((c) => !c.adminOnly).map((c) => c.key);
const isAdm = (u: T.User) => u.role === 'admin' || u.role === 'superadmin';
const capsOf = (u: T.User): T.Capability[] => (u.role === 'superadmin' ? CAPS.map((c) => c.key) : u.role === 'admin' ? CAPS.filter((c) => !c.superAdminOnly).map((c) => c.key) : u.role === 'gerente' ? GERENTE_CAPS : GESTOR_CAPS);
const onlySuper = (u: T.User) => { if (u.role !== 'superadmin') throw new ApiError(403, 'superadmin_only', 'Só o SuperAdmin pode conectar integrações e mudar a frequência de sincronização.'); };
const need = (u: T.User, cap: T.Capability) => { if (!capsOf(u).includes(cap)) throw new ApiError(403, 'forbidden_module', 'Este módulo não está liberado para o seu usuário.'); };
const pub = (u: (typeof USERS)[number]): T.User => { const { password: _p, ...rest } = u; return { ...rest, permissions: capsOf(u) }; };

/* ---- contas das integrações e agendamentos (mock) ---- */
const PROV_OF: Record<string, T.Provider> = { g: 'google-ads', m: 'meta', n: 'gam' };
const ACCTS: T.IntegrationAccount[] = [
  ...GACC.map((a) => ({ id: a.id, provider: 'google-ads' as const, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, imported: !!a.imported, domains: [], status: a.status, lastSyncAt: a.lastSyncAt, message: a.message })),
  ...MACC.map((a) => ({ id: a.id, provider: 'meta' as const, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, imported: true, domains: [], status: a.status, lastSyncAt: a.lastSyncAt, message: a.message })),
  { id: 'n1', provider: 'gam', name: 'Minha Rede GAM', externalId: '12345678', currency: 'USD', timezone: 'America/Sao_Paulo', imported: true, domains: [], status: 'warn', lastSyncAt: new Date(Date.now() - 6 * 60000).toISOString(),
    message: '9 linhas sem site ignoradas (US$ 4,12): confira se utm_campaign e utm_content estão como dimensão personalizada nesta rede · 22 linhas de sites sem rede ligada ignoradas (US$ 61,30): dominioN.com. Ligue cada site a esta rede em Domínios' },
];
const accDomains = (a: T.IntegrationAccount) => (a.provider === 'gam' ? [] : DOMAINS.filter((d) => (a.provider === 'google-ads' ? d.googleAccounts : d.metaAccounts).includes(a.id)).map((d) => d.hostname));
const withDomains = (a: T.IntegrationAccount): T.IntegrationAccount => ({ ...a, domains: accDomains(a) });
function setAccDomains(a: T.IntegrationAccount, hosts: string[]) {
  if (a.provider === 'gam') return;
  const key = a.provider === 'google-ads' ? 'googleAccounts' : 'metaAccounts';
  DOMAINS.forEach((d) => { const has = d[key].includes(a.id); const want = hosts.includes(d.hostname); if (want && !has) d[key] = [...d[key], a.id]; if (!want && has) d[key] = d[key].filter((x) => x !== a.id); });
}
const now = Date.now();
const SYNC: T.SyncSetting[] = ([
  ['google-ads.metrics', 'google-ads', 'Custo por campanha × país', 'days', 3, 30], ['google-ads.structure', 'google-ads', 'Estrutura: campanhas, grupos, anúncios', 'fixed', null, 120],
  ['meta.metrics', 'meta', 'Insights por anúncio × país', 'days', 3, 30], ['meta.structure', 'meta', 'Estrutura: campanha, conjunto, anúncio', 'fixed', null, 120],
  ['gam.revenue', 'gam', 'Receita e delivery por key-values × país × URL', 'days', 3, 60], ['gam.close', 'gam', 'Fechamento de receita', 'days', 7, 1440],
  ['google-ads.placements', 'google-ads', 'Custo por placement (onde o anúncio apareceu)', 'days', 3, 60], ['gam.placements', 'gam', 'Receita por placement (key-value placement)', 'days', 3, 60],
  ['google-ads.cleanup', 'google-ads', 'Limpeza de grupos e anúncios antigos', 'fixed', null, 1440], ['meta.cleanup', 'meta', 'Limpeza de conjuntos e anúncios antigos', 'fixed', null, 1440],
  ['fx.rates', 'fx', 'Cotações USD → BRL e EUR (Frankfurter)', 'fixed', null, 360],
] as const).map(([id, provider, label, mode, days, every]) => ({ id, provider, label, window: '', windowMode: mode, windowDays: days, windowEditable: mode !== 'fixed', hasRetention: id.endsWith('.cleanup'), retentionDays: null as number | null,
  lastMessage: id.endsWith('.cleanup') ? 'Limpeza desligada (defina "Excluir dados com mais de X dias")' : '1/1 contas · ok', everyMinutes: every, enabled: true, lastRunAt: new Date(now - 7 * 60000).toISOString(), nextRunAt: new Date(now + (every - 7) * 60000).toISOString(), lastStatus: 'success' as const }));
const winLabel = (st: T.SyncSetting) => (st.windowMode === 'days' ? `D-${st.windowDays} → ${st.id === 'gam.close' ? 'D-4' : 'hoje'}` : st.windowMode === 'incremental' ? 'incremental · desde a última execução' : st.id === 'fx.rates' ? 'hoje + dias que faltarem' : st.id.endsWith('.structure') ? 'incremental' : '—');
SYNC.forEach((st) => { st.window = winLabel(st); });
void PROV_OF;

/* ---- escopo (mesma regra do servidor: auth/scope.ts) ----
   Admin: tudo · Sócio: Empresa inteira · Gerente: Squads dele · Gestor: domínios dele, só campanhas das contas dele
   (receita não atribuída só se for o único gestor do domínio) · ?company= filtra a Empresa. */
let REQ_COMPANY = '';
interface Scope { doms: Set<string>; filter: { full: Set<string>; camps: Set<string>; solo: Set<string> } | null }
const activeDom = (h: string) => !!DOMAINS.find((x) => x.hostname === h && x.active);
function visibleCompanies(u: T.User) {
  if (isAdm(u)) return COMPANIES.map((c) => c.id);
  return COMPANIES.filter((c) => c.partnerIds.includes(u.id) || c.squadIds.some((sid) => u.squadIds.includes(sid)) || SQUADS.some((s) => s.companyId === c.id && s.domains.some((d) => u.domains.some((x) => x.domain === d)))).map((c) => c.id);
}
function scopeOf(u: T.User, company = REQ_COMPANY): Scope {
  let doms: Set<string>; let filter: Scope['filter'] = null;
  if (isAdm(u)) doms = new Set([...DOMAINS.map((d) => d.hostname), UNKNOWN_DOMAIN]);
  else {
    const full = new Set(SQUADS.filter((s) => (s.companyId && COMPANIES.find((c) => c.id === s.companyId)?.partnerIds.includes(u.id)) || (u.role === 'gerente' && u.squadIds.includes(s.id))).flatMap((s) => s.domains).filter(activeDom));
    const restricted = u.role === 'gestor' ? u.domains.filter((l) => activeDom(l.domain) && !full.has(l.domain)) : [];
    doms = new Set([...full, ...restricted.map((l) => l.domain)]);
    if (restricted.length) {
      const camps = new Set(CAMPS.filter((c) => restricted.some((l) => l.domain === c.domain && [...l.googleAccounts, ...l.metaAccounts].includes(c.acc))).map((c) => c.id));
      const solo = new Set(restricted.filter((l) => USERS.filter((x) => x.role === 'gestor' && x.domains.some((d) => d.domain === l.domain)).length === 1).map((l) => l.domain));
      filter = { full, camps, solo };
    }
  }
  if (company) {
    if (!visibleCompanies(u).includes(company)) throw new ApiError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
    const inCo = new Set(SQUADS.filter((s) => s.companyId === company).flatMap((s) => s.domains));
    doms = new Set([...doms].filter((d) => inCo.has(d)));
  }
  return { doms, filter };
}
function allowed(u: T.User): Set<string> { return scopeOf(u).doms; }
const rowOk = (sc: Scope, r: Row) => sc.doms.has(r.domain) && (!sc.filter || sc.filter.full.has(r.domain) || (!!r.camp && sc.filter.camps.has(r.camp)) || (r.src === 'unatt' && sc.filter.solo.has(r.domain)));
const campOk = (sc: Scope, c: { id: string; domain: string }) => sc.doms.has(c.domain) && (!sc.filter || sc.filter.full.has(c.domain) || sc.filter.camps.has(c.id));
function range(q: Record<string, unknown>) {
  const a = dayIndex(String(q.to)), b = dayIndex(String(q.from));
  return [a < 0 ? 0 : a, b < 0 ? DAYS - 1 : b] as const;
}
function rowsFor(u: T.User, q: Record<string, unknown>, extra?: (r: Row) => boolean, override?: readonly [number, number]) {
  const sc = scopeOf(u); const [a, b] = override ?? range(q); const dom = q.domain ? String(q.domain) : '';
  if (dom && !sc.doms.has(dom)) throw new ApiError(403, 'forbidden_domain', 'Você não tem acesso a este domínio.');
  return ROWS.filter((r) => r.di >= a && r.di <= b && rowOk(sc, r) && (!dom || r.domain === dom) && (!extra || extra(r)));
}
function comparison(u: T.User, q: Record<string, unknown>, extra: ((r: Row) => boolean) | undefined, cur: T.Currency): T.Comparison | null {
  const [a0, b] = range(q); if (a0 === 0 && b === 0) return null; const a = a0 === 0 ? 1 : a0; const len = b - a + 1; const pa = b + 1, pb = b + len; if (pb >= DAYS) return null;
  return { from: DATES[pb], to: DATES[pa], metrics: agg(rowsFor(u, q, extra, [pa, pb]), cur) };
}
function roiDays(rows: Row[], cur: T.Currency): T.RoiDays {
  const by = (d: number) => { const x = rows.filter((r) => r.di === d); return x.length ? agg(x, cur).roi : null; };
  return { today: by(0), d1: by(1), d2: by(2), d3: by(3) };
}
function group<K, X extends Row = Row>(rows: X[], fn: (r: X) => K) { const m = new Map<K, X[]>(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); } return m; }

const TITLES: Record<T.IssueType, [string, string, string]> = {
  missing_campaign_id: ['Missing Campaign ID', 'utm_campaign não contém o Campaign ID.', 'Verificar o tracking template / sufixo do URL final da campanha.'],
  missing_adgroup_id: ['Missing Ad Group ID', 'utm_content chegou sem o {adgroupid}.', 'Conferir se utm_content={adgroupid}_{creative} está no template da conta.'],
  missing_creative_id: ['Missing Creative ID', 'utm_content chegou sem a parte {creative}.', 'Conferir o template da conta.'],
  invalid_utm: ['UTM inválida', 'Macro não substituída, por exemplo {campaignid} escrito na URL.', 'Usar o sufixo do URL final em vez de colar a URL pronta.'],
  unknown_domain: ['Domínio não identificado', 'Receita de um site que não está cadastrado.', 'Cadastrar o domínio em Configurações → Domínios.'],
  campaign_not_found: ['Campanha não localizada', 'O Campaign ID não existe nas contas importadas.', 'Importar a conta dona da campanha na MCC.'],
  meta_ad_not_found: ['Meta Ad não localizado', 'O Ad ID não está nas contas Meta conectadas.', 'Reconectar a conta Meta e conferir {{ad.id}}.'],
  gads_creative_not_found: ['Google Ads Creative não localizado', 'O Creative ID não tem correspondência na estrutura.', 'Rodar o sync de estrutura.'],
};
const UTM: T.UtmTemplates = {
  google: 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}_{creative}&utm_term={keyword}&placement={placement}&network={network}&device={device}',
  meta: 'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{adset.id}}_{{ad.id}}&utm_term={{placement}}',
};

export async function mockRequest<R>(method: string, path: string, query: Record<string, unknown> = {}, body?: unknown): Promise<R> {
  await sleep(180 + Math.random() * 220);
  const q = query; const cur = (q.currency as T.Currency) || 'USD'; const b = (body ?? {}) as Record<string, any>;
  REQ_COMPANY = typeof q.company === 'string' ? q.company : '';
  const out = <V,>(v: V) => v as unknown as R;

  /* ---- auth ---- */
  if (path === '/auth/login' && method === 'POST') {
    const u = USERS.find((x) => x.email.toLowerCase() === String(b.email).trim().toLowerCase());
    if (!u || !u.password || u.password !== b.password) throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    if (u.status === 'disabled') throw new ApiError(403, 'user_disabled', 'Usuário desativado. Fale com o administrador.');
    LS.set('pluto_mock_session', u.id); return out({ user: pub(u) });
  }
  if (path === '/auth/forgot-password') return out(undefined);
  if (path === '/auth/reset-password') return out(undefined);
  const u = me(); if (!u) throw new ApiError(401, 'unauthenticated', 'Sessão expirada.');
  if (path === '/auth/me') return out({ user: pub(u) });
  if (path === '/auth/logout') { LS.set('pluto_mock_session', null); return out(undefined); }
  if (path === '/auth/change-password') { u.password = b.newPassword; u.mustChangePassword = false; u.status = 'active'; return out(undefined); }
  if (path === '/me/preferences') { const k = 'pluto_mock_prefs_' + u.id; if (method === 'PUT') LS.set(k, b); return out(LS.get(k) ?? {}); }

  /* ---- 0.17 Contas × Sites ---- */
  if (path === '/links' || path.startsWith('/links/')) return out(linksMock(u, allowed(u), method, path, b));
  /* ---- Finance ---- */
  if (path === '/finance/overview') return out<T.FinanceOverview>(financeOverview(u, q));
  if (path === '/finance/costs' && method === 'GET') return out<T.FinanceCostsResponse>(financeCosts(u, q));
  if (path.startsWith('/finance/')) return out(financeMutate(u, method, path, b));
  if (path === '/me/domains') return out({ domains: [...allowed(u)].filter((d) => DOMAINS.find((x) => x.hostname === d && x.active)) });
  if (path === '/search') {
    const t = String(q.q || '').toLowerCase(); const al = allowed(u); const results: T.SearchResult[] = [];
    const sc = scopeOf(u); CAMPS.filter((c) => campOk(sc, c) && (c.name.toLowerCase().includes(t) || c.id.includes(t))).slice(0, 6).forEach((c) => results.push({ kind: 'campaign', label: c.name, sub: c.id, platform: c.platform, id: c.id, domain: c.domain }));
    DOMAINS.filter((d) => al.has(d.hostname) && d.active && d.hostname.toLowerCase().includes(t)).forEach((d) => results.push({ kind: 'domain', label: d.hostname, domain: d.hostname }));
    return out({ results });
  }
  if (path === '/me/companies') {
    const vis = scopeOf(u, '').doms;
    return out({ companies: COMPANIES.filter((c) => visibleCompanies(u).includes(c.id)).map((c) => {
      const squads = SQUADS.filter((s) => s.companyId === c.id).map((s) => ({ id: s.id, name: s.name, domains: s.domains.filter((d) => vis.has(d)) })).filter((s) => s.domains.length);
      return { id: c.id, name: c.name, partners: USERS.filter((x) => c.partnerIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name, role: x.role })), squads, domains: squads.flatMap((s) => s.domains) };
    }) });
  }
  let mc = path.match(/^\/companies\/([^/]+)\/overview$/);
  if (mc) {
    const cid = decodeURIComponent(mc[1]); const sc = scopeOf(u, cid); const c = COMPANIES.find((x) => x.id === cid)!;
    const qq = { ...q, company: cid }; REQ_COMPANY = cid;
    const rows = rowsFor(u, qq); const [a, bb] = range(q); const g = group(rowsFor(u, qq, undefined, [Math.min(a, 1), Math.max(bb, a + 13)]), (r) => r.di);
    const daily: T.DailyPoint[] = []; for (let d = Math.max(bb, a + 13); d >= a; d--) daily.push({ date: DATES[d], partial: d === 0, metrics: agg(g.get(d) ?? [], cur) });
    return out<T.CompanyOverviewResponse>({ company: { id: c.id, name: c.name, partners: USERS.filter((x) => c.partnerIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name, role: x.role })) },
      period: { from: String(q.from), to: String(q.to) }, comparison: comparison(u, qq, undefined, cur), totals: agg(rows, cur), daily,
      squads: SQUADS.filter((s) => s.companyId === cid).map((s) => { const ds = s.domains.filter((d) => sc.doms.has(d)); return { id: s.id, name: s.name, metrics: agg(rows.filter((r) => ds.includes(r.domain)), cur),
        domains: ds.map((d) => ({ domain: d, metrics: agg(rows.filter((r) => r.domain === d), cur), gestores: USERS.filter((x) => x.role === 'gestor' && x.domains.some((l) => l.domain === d)).map((x) => ({ id: x.id, name: x.name })) })) }; }).filter((s) => s.domains.length) });
  }
  if (path.startsWith('/admin') && !isAdm(u)) throw new ApiError(403, 'forbidden', 'Área exclusiva de Admin.');

  /* ---- métricas ---- */
  if (path === '/dashboard') {
    const rows = rowsFor(u, q); const doms = [...allowed(u)].filter((d) => DOMAINS.find((x) => x.hostname === d && x.active) && (!q.domain || d === q.domain));
    const [a, bb] = range(q); const daily: T.DailyPoint[] = []; const g = group(rowsFor(u, q, undefined, [0, DAYS - 1]), (r) => r.di);
    for (let d = Math.min(DAYS - 1, Math.max(bb, a + 13)); d >= 0; d--) daily.push({ date: DATES[d], partial: d === 0, metrics: agg(g.get(d) ?? [], cur) });
    return out<T.DashboardResponse>({ period: { from: String(q.from), to: String(q.to) }, comparison: comparison(u, q, undefined, cur), metrics: agg(rows, cur), daily,
      domains: doms.map((d) => ({ domain: d, metrics: agg(rows.filter((r) => r.domain === d), cur) })), lastSyncAt: new Date(Date.now() - 4 * 60000).toISOString() });
  }
  if (path === '/domains/summary') { const rows = rowsFor(u, q); return out({ domains: [...allowed(u)].filter((d) => DOMAINS.find((x) => x.hostname === d && x.active)).map((d) => ({ domain: d, metrics: agg(rows.filter((r) => r.domain === d), cur) })) }); }
  let m = path.match(/^\/domains\/([^/]+)$/);
  if (m) {
    const dom = decodeURIComponent(m[1]); const qq = { ...q, domain: dom }; const rows = rowsFor(u, qq); const recent = rowsFor(u, qq, undefined, [0, 3]);
    const cr = rows.filter((r) => r.camp); const crec = recent.filter((r) => r.camp);
    return out<T.DomainDetailResponse>({ domain: dom, comparison: comparison(u, qq, undefined, cur), metrics: agg(rows, cur), campaignTotals: agg(cr, cur), campaignTotalsRoiDays: roiDays(crec, cur), campaigns: campaignRows(CAMPS.filter((c) => c.domain === dom && campOk(scopeOf(u), c)), rows, recent, cur) });
  }
  if (path === '/campaigns') {
    const platform = q.platform as T.Platform; need(u, platform === 'google' ? 'campaigns.google.view' : 'campaigns.meta.view'); const al = allowed(u);
    const sc = scopeOf(u); void al;
    let camps = CAMPS.filter((c) => c.platform === platform && campOk(sc, c) && (!q.domain || c.domain === q.domain) && (!q.accountId || c.acc === q.accountId));
    if (q.includePaused !== true && q.includePaused !== 'true') camps = camps.filter((c) => c.status === 'ENABLED');
    const ids = new Set(camps.map((c) => c.id)); const rows = rowsFor(u, q, (r) => ids.has(r.camp!)); const recent = rowsFor(u, q, (r) => ids.has(r.camp!), [0, 3]);
    return out<T.CampaignsResponse>({ comparison: comparison(u, q, (r) => ids.has(r.camp!), cur), totals: agg(rows, cur), totalsRoiDays: roiDays(recent, cur), campaigns: campaignRows(camps, rows, recent, cur),
      accounts: [...new Set(CAMPS.filter((c) => c.platform === platform && campOk(sc, c)).map((c) => c.acc))].map((id) => ({ id, name: accName(id) })) });
  }
  m = path.match(/^\/campaigns\/(google|meta)\/([^/]+)\/(children|countries)$/);
  if (m) {
    const c = CAMPS.find((x) => x.id === m![2]); if (!c || !campOk(scopeOf(u), c)) throw new ApiError(404, 'not_found', 'Campanha não encontrada.');
    const rows = rowsFor(u, q, (r) => r.camp === c.id); const recent = rowsFor(u, q, (r) => r.camp === c.id, [0, 3]);
    if (m[3] === 'children') return out<T.CampaignChildrenResponse>({ groups: c.groups.map((g) => ({ id: g.id, name: g.name, metrics: agg(rows.filter((r) => r.grp === g.id), cur), roiDays: roiDays(recent.filter((r) => r.grp === g.id), cur),
      ads: g.ads.map((a) => ({ id: a.id, name: a.name, metrics: agg(rows.filter((r) => r.ad === a.id), cur), roiDays: roiDays(recent.filter((r) => r.ad === a.id), cur) })) })) });
    return out<T.CampaignCountriesResponse>({ campaign: { id: c.id, name: c.name, platform: c.platform, domain: c.domain }, totals: agg(rows, cur),
      countries: [...group(rows, (r) => r.country)].map(([k, rs]) => ({ country: k, name: CT[k].n, metrics: agg(rs, cur) })) });
  }
  /* ---- placements: domínio → contas → campanhas ---- */
  if (path.startsWith('/placements')) {
    need(u, 'campaigns.google.view');
    const dom = String(q.domain || ''); if (!dom) throw new ApiError(422, 'domain_required', 'Escolha um domínio.');
    if (!allowed(u).has(dom)) throw new ApiError(403, 'forbidden_domain', 'Você não tem acesso a este domínio.');
    const psc = scopeOf(u); const camps = CAMPS.filter((c) => c.platform === 'google' && c.domain === dom && campOk(psc, c));
    if (path === '/placements/filters') {
      const accs = [...new Set(camps.map((c) => c.acc))];
      return out<T.PlacementFiltersResponse>({ domain: dom, accounts: accs.map((id) => ({ id, name: accName(id), externalId: GACC.find((g) => g.id === id)?.externalId ?? id, campaigns: camps.filter((c) => c.acc === id).length })),
        campaigns: camps.map((c) => ({ id: c.id, name: c.name, accountId: c.acc, status: c.status })) });
    }
    const accs = String(q.accounts || '').split(',').filter(Boolean); const ids = String(q.campaigns || '').split(',').filter(Boolean);
    const inAcc = camps.filter((c) => !accs.length || accs.includes(c.acc)); const use = inAcc.filter((c) => !ids.length || ids.includes(c.id));
    const [a, bb] = range(q); const useIds = use.map((c) => c.id);
    const cur_ = placementRows(useIds, a, bb); const rec = placementRows(useIds, 0, 3);
    const label = (k: string) => PL_LABEL[k] ?? (k.startsWith('mobileapp::') ? k.slice(11) : k);
    const recent = (rs: PRow[]) => [0, 1, 2, 3].map((d) => { const x = rs.filter((r) => r.di === d); const m = agg(x, cur); return [m.spend, m.revenue] as [number, number]; });
    if (path === '/placements/campaigns') {
      const key = String(q.placement || ''); const lvl = q.level === 'host' ? 'host' : 'root';
      const rows = cur_.filter((r) => (lvl === 'host' ? r.host : r.root) === key);
      return out<T.PlacementCampaignsResponse>({ placement: key, level: lvl, totals: agg(rows, cur),
        hosts: lvl === 'root' ? [...group(rows, (r) => (r as PRow).host)].map(([k, rs]) => ({ key: k, metrics: agg(rs, cur) })) : [],
        campaigns: use.filter((c) => rows.some((r) => r.camp === c.id)).map((c) => ({ id: c.id, name: c.name, accountName: accName(c.acc), status: c.status, metrics: agg(rows.filter((r) => r.camp === c.id), cur) })) });
    }
    const byRoot = group(cur_, (r) => (r as PRow).root); const recRoot = group(rec, (r) => (r as PRow).root);
    const groups: T.PlacementGroup[] = [...byRoot].map(([rt, rs]) => {
      const rr = (recRoot.get(rt) ?? []) as PRow[]; const byHost = group(rs as PRow[], (r) => r.host);
      return { key: rt, label: label(rt), type: typeOf(rt), metrics: agg(rs, cur), roiDays: roiDays(rr, cur), recent: recent(rr),
        children: [...byHost].map(([h, hs]) => { const hr = rr.filter((r) => r.host === h); return { key: h, label: label(h), type: typeOf(h), metrics: agg(hs, cur), roiDays: roiDays(hr, cur), recent: recent(hr) }; }) };
    });
    let cmp: T.Comparison | null = null;
    { const [a0, b] = [a, bb]; if (!(a0 === 0 && b === 0)) { const s0 = a0 === 0 ? 1 : a0; const len = b - s0 + 1; const pa = b + 1, pb = b + len; if (pb < DAYS) cmp = { from: DATES[pb], to: DATES[pa], metrics: agg(placementRows(useIds, pa, pb), cur) }; } }
    return out<T.PlacementsResponse>({ domain: dom, selection: { accounts: accs.length, accountsTotal: new Set(camps.map((c) => c.acc)).size, campaigns: use.length, campaignsTotal: inAcc.length },
      comparison: cmp, totals: agg(cur_, cur), totalsRoiDays: roiDays(rec, cur), groups });
  }
  if (path === '/urls') {
    need(u, 'urls.view'); const all = rowsFor(u, q, (r) => !!DOMAINS.find((d) => d.hostname === r.domain)); const origin = q.origin ? String(q.origin) : null;
    const rows = origin ? all.filter((r) => originOf(r) === origin) : all;
    const RANK = { google: 0, meta: 1, retention: 2, none: 3 } as const;
    const origins = [...group(all, originOf)].map(([k, rs]) => ({ key: k, label: k === 'google' ? 'Google Ads' : k === 'meta' ? 'Meta Ads' : k === 'none' ? 'Sem origem' : `${/^pushalert|push$/.test(k.slice(4)) ? 'Push' : /(wpp|whatsapp)$/.test(k.slice(4)) ? 'WhatsApp' : 'Retenção'} · ${k.slice(4)}`, kind: (k.startsWith('utm:') ? 'retention' : k) as T.UrlOrigin['kind'], metrics: agg(rs, cur) }))
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.metrics.revenue - a.metrics.revenue);
    return out<T.UrlsResponse>({ urls: [...group(rows, (r) => r.domain + '|' + r.url)].map(([k, rs]) => { const [d, p] = k.split('|'); return { domain: d, path: p, metrics: agg(rs, cur) }; }), origins, origin });
  }
  if (path.startsWith('/reports/')) need(u, 'reports.view');
  if (path === '/reports/daily') {
    const month = String(q.month || TODAY.slice(0, 7)); const dis = DATES.map((d, i) => [d, i] as const).filter(([d]) => d.startsWith(month)).map(([, i]) => i);
    if (!dis.length) return out<T.DailyReportResponse>({ month, total: agg([], cur), days: [] });
    const rows = rowsFor(u, q, undefined, [Math.min(...dis), Math.max(...dis)]); const g = group(rows, (r) => r.di);
    return out<T.DailyReportResponse>({ month, total: agg(rows, cur), days: dis.map((di) => ({ key: DATES[di], partial: di <= 3, metrics: agg(g.get(di) ?? [], cur) })) });
  }
  if (path === '/reports/monthly') {
    const n = Math.min(Math.max(1, Number(q.months) || 12), 36); const rows = rowsFor(u, q, undefined, [0, DAYS - 1]); const g = group(rows, (r) => DATES[r.di].slice(0, 7));
    const months = lastMonths(n, TODAY); const keep = rows.filter((r) => months.includes(DATES[r.di].slice(0, 7)));
    return out<T.MonthlyReportResponse>({ total: agg(keep, cur), months: months.map((mk, i) => ({ key: mk, partial: i === 0 || addDays(TODAY, -3).slice(0, 7) === mk, metrics: agg(g.get(mk) ?? [], cur) })) });
  }
  if (path === '/gam/summary') { need(u, 'gam.view'); const rows = rowsFor(u, q); return out<T.GamSummaryResponse>({ network: { name: 'Minha Rede GAM', code: '12345678', currency: 'USD' }, metrics: agg(rows, cur), domains: [...group(rows.filter((r) => DOMAINS.find((d) => d.hostname === r.domain)), (r) => r.domain)].map(([d, rs]) => ({ domain: d, metrics: agg(rs, cur) })) }); }
  if (path === '/attribution/health') {
    need(u, 'attribution.view');
    const rows = rowsFor(u, q); const [a, bb] = range(q); const g = group(rowsFor(u, q, undefined, [Math.max(1, a), Math.max(bb, a + 13)]), (r) => r.di);
    return out<T.AttributionHealthResponse>({ metrics: agg(rows, cur),
      issues: [...group(rows.filter((r) => r.src === 'unatt'), (r) => r.reason!)].map(([k, rs]) => { const s = agg(rs, cur); return { type: k, title: TITLES[k][0], cause: TITLES[k][1], action: TITLES[k][2], sessions: s.sessions, revenue: s.revenue, domains: [...new Set(rs.map((r) => r.domain))] }; }).sort((x, y) => y.revenue - x.revenue),
      daily: [...g.keys()].sort((x, y) => y - x).map((d) => ({ date: DATES[d], attributionRate: agg(g.get(d)!, cur).attributionRate })),
      domains: [...group(rows, (r) => r.domain)].map(([d, rs]) => { const s = agg(rs, cur); return { domain: d, registered: !!DOMAINS.find((x) => x.hostname === d), revenue: s.revenue, unattributed: s.unattributedRevenue, attributionRate: s.attributionRate }; }) });
  }
  if (path === '/utm/templates') return out(UTM);
  if (path === '/utm/debug') { need(u, 'utm.debug'); return out(debugUtm(String(b.url || ''))); }
  if (path === '/fx/latest') return out<T.FxLatest>(fxLatest('API de câmbio (mock)', 12));
  if (path === '/fx/history') return out({ rows: DATES.slice(0, Number(q.days) || 10).map((d, i) => ({ date: d, BRL: FX.BRL[i], EUR: FX.EUR[i] })) });

  /* ---- admin ---- */
  if (path === '/admin/integrations') return out<T.IntegrationsResponse>({
    google: { connected: true, googleAccount: 'midia@exemplo.com', mccName: 'Pluto Media MCC', mccCustomerId: '123-456-7890', accountsFound: GACC.length, lastSyncAt: new Date(Date.now() - 4 * 60000).toISOString(), accounts: GACC },
    meta: { connected: true, business: 'Pluto Media BM', user: 'midia@exemplo.com', lastSyncAt: new Date(Date.now() - 7 * 60000).toISOString(), accounts: MACC },
    gam: { connected: true, googleAccount: 'financeiro@exemplo.com', networkName: 'Minha Rede GAM', networkCode: '12345678', currency: 'USD', timezone: 'America/Sao_Paulo', status: 'ok', lastSyncAt: new Date(Date.now() - 6 * 60000).toISOString(), accounts: ACCTS.filter((a) => a.provider === 'gam').map(({ provider: _p, domains: _d, ...a }) => a) } });
  if (/\/oauth\/start$/.test(path)) onlySuper(u);
  if (/\/oauth\/start$/.test(path)) return out<T.OAuthStartResponse>({ authorizeUrl: '#oauth-mock' });
  m = path.match(/^\/admin\/integrations\/(google-ads|meta|gam)\/accounts(?:\/([^/]+))?$/);
  if (m) {
    const prov = m[1] as T.Provider; const id = m[2] ? decodeURIComponent(m[2]) : null;
    if (!id && method === 'GET') return out({ accounts: ACCTS.filter((a) => a.provider === prov).map(withDomains) });
    if (!id && method === 'POST') {
      const ext = String(b.externalId).trim();
      if (ACCTS.find((a) => a.provider === prov && a.externalId.replace(/\D/g, '') === ext.replace(/\D/g, ''))) throw new ApiError(409, 'account_exists', 'Essa conta já está cadastrada.');
      const a: T.IntegrationAccount = { id: prov[0] + Date.now(), provider: prov, name: b.name, externalId: ext, currency: b.currency, timezone: b.timezone, imported: !!b.imported, domains: [], status: b.imported ? 'late' : 'not_imported', lastSyncAt: null, message: b.imported ? 'Aguardando o primeiro sync' : undefined };
      ACCTS.push(a); setAccDomains(a, b.domains ?? []); return out(withDomains(a));
    }
    const a = ACCTS.find((x) => x.id === id && x.provider === prov); if (!a) throw new ApiError(404, 'not_found', 'Conta não encontrada.');
    if (method === 'PATCH') { for (const k of ['name', 'currency', 'timezone', 'imported'] as const) if (b[k] !== undefined) (a as any)[k] = b[k]; if (b.domains) setAccDomains(a, b.domains);
      if (b.imported === false) a.status = 'not_imported'; else if (b.imported && a.status === 'not_imported') a.status = 'ok'; return out(withDomains(a)); }
    if (method === 'DELETE') { setAccDomains(a, []); ACCTS.splice(ACCTS.indexOf(a), 1); return out(undefined); }
  }
  if (path === '/admin/sync-settings') return out({ settings: SYNC });
  m = path.match(/^\/admin\/sync-settings\/(.+)$/);
  if (m) { onlySuper(u); const st = SYNC.find((x) => x.id === decodeURIComponent(m![1])); if (!st) throw new ApiError(404, 'not_found', 'Job não encontrado.');
    if (b.everyMinutes !== undefined) { const v = Number(b.everyMinutes); if (!(v >= 15 && v <= 10080)) throw new ApiError(422, 'invalid_frequency', 'Frequência entre 15 min e 1 semana.'); st.everyMinutes = v; }
    if (b.windowMode !== undefined || b.windowDays !== undefined) {
      if (st.windowMode === 'fixed') throw new ApiError(422, 'window_fixed', 'Este job não tem janela de datas.');
      if (st.id === 'gam.close' && (b.windowMode === 'incremental' || (b.windowDays !== undefined && b.windowDays < 4))) throw new ApiError(422, 'invalid_window', 'O fechamento vai de D-X até D-4: use X a partir de 4.');
      if (b.windowMode) st.windowMode = b.windowMode; if (b.windowDays !== undefined) st.windowDays = Number(b.windowDays); st.window = winLabel(st);
    }
    if (b.retentionDays !== undefined) { if (!st.hasRetention) throw new ApiError(422, 'no_retention', 'Só os jobs de limpeza têm retenção.'); st.retentionDays = b.retentionDays; st.lastMessage = b.retentionDays ? `0 anúncio(s) e 0 grupo(s) sem atividade há mais de ${b.retentionDays} dias removidos (mock)` : 'Limpeza desligada'; }
    if (b.enabled !== undefined) st.enabled = !!b.enabled;
    st.nextRunAt = st.enabled ? new Date(Date.parse(st.lastRunAt ?? new Date().toISOString()) + st.everyMinutes * 60000).toISOString() : null; return out(st); }
  if (path === '/admin/fx/refresh') { FX.BRL[0] = +(FX.BRL[0] + (Math.random() - 0.5) * 0.01).toFixed(4); return out<T.FxLatest>(fxLatest('Frankfurter (mock)', 0)); }
  if (path === '/admin/fx-discount') {
    if (method === 'PUT') { const amount = Number(b.amount); if (!(amount >= 0 && amount < 5)) throw new ApiError(422, 'invalid_input', 'Deságio entre R$ 0 e R$ 4,9999.'); const from = b.validFrom ?? (FXD.length ? TODAY : '2000-01-01'); const ex = FXD.find((x) => x.validFrom === from); if (ex) { ex.amount = amount; ex.createdBy = u.name; } else FXD.push({ validFrom: from, amount, createdAt: new Date().toISOString(), createdBy: u.name }); }
    const curD = FXD.filter((x) => x.validFrom <= TODAY).sort((a2, b2) => b2.validFrom.localeCompare(a2.validFrom))[0];
    return out<T.FxDiscountResponse>({ current: curD ? { amount: curD.amount, validFrom: curD.validFrom } : null, history: FXD.slice().sort((a2, b2) => b2.validFrom.localeCompare(a2.validFrom)) });
  }
  if (path === '/admin/permissions') {
    if (method === 'PUT') { if (b.gestor) GESTOR_CAPS = CAPS.filter((c) => !c.adminOnly && (b.gestor as T.Capability[]).includes(c.key)).map((c) => c.key); if (b.gerente) GERENTE_CAPS = CAPS.filter((c) => !c.adminOnly && (b.gerente as T.Capability[]).includes(c.key)).map((c) => c.key); }
    return out<T.PermissionsResponse>({ capabilities: CAPS, roles: { gestor: GESTOR_CAPS, gerente: GERENTE_CAPS, admin: CAPS.filter((c) => !c.superAdminOnly).map((c) => c.key), superadmin: CAPS.map((c) => c.key) } });
  }
  if (/\/sync$/.test(path)) return out(undefined);
  if (path === '/admin/domains' && method === 'GET') return out({ domains: DOMAINS.map(domOut) });
  /* ---- campanhas sem domínio (Prompt-05) ---- */
  if (path === '/admin/campaigns/unmapped') {
    const platform = (q.platform as T.Platform) || 'meta'; const days = Number(q.days) || 30;
    const list = CAMPS.filter((c) => c.platform === platform && c.domain === TECH).map((c) => {
      const rs = ROWS.filter((r) => r.camp === c.id && r.domain === TECH && r.di <= days);
      const dis = rs.map((r) => r.di);
      return { id: c.id, name: c.name, platform: c.platform, status: c.status, accountId: c.acc, accountName: accName(c.acc), spend: rs.reduce((a, r) => a + r.spendUSD * (1 + (r.src === 'meta' ? 0.1383 : 0)), 0), clicks: rs.reduce((a, r) => a + r.clk, 0), rows: rs.length,
        firstDate: dis.length ? DATES[Math.max(...dis)] : null, lastDate: dis.length ? DATES[Math.min(...dis)] : null };
    }).sort((a, b) => b.spend - a.spend);
    return out<T.UnmappedCampaignsResponse>({ platform, days, campaigns: list, totals: { spend: list.reduce((a, c) => a + c.spend, 0), rows: list.reduce((a, c) => a + c.rows, 0) } });
  }
  m = path.match(/^\/admin\/campaigns\/([^/]+)$/);
  if (m && method === 'PATCH') {
    const c = CAMPS.find((x) => x.id === decodeURIComponent(m![1]) && x.platform === (b.platform ?? 'meta')); if (!c) throw new ApiError(404, 'not_found', 'Campanha não encontrada.');
    const d = DOMAINS.find((x) => x.hostname === b.domain); if (!d) throw new ApiError(404, 'not_found', 'Domínio não encontrado.');
    if (d.technical) throw new ApiError(409, 'technical_domain', 'Escolha um site: "Sem domínio" é o destino automático de quem não tem domínio.');
    if (!d.active) throw new ApiError(409, 'domain_inactive', 'Este domínio está inativo. Ative em Domínios antes de usar.');
    let moved = 0; for (const r of ROWS) if (r.camp === c.id && r.domain !== d.hostname) { r.domain = d.hostname; moved++; }
    c.domain = d.hostname;
    if (!CAMPS.some((x) => x.domain === TECH && x.acc === c.acc)) { const a = MACC.find((x) => x.id === c.acc); if (a && a.status === 'warn') { a.status = 'ok'; a.message = undefined; } const ac = ACCTS.find((x) => x.id === c.acc); if (ac && ac.status === 'warn') { ac.status = 'ok'; ac.message = undefined; } }
    return out<T.SetCampaignDomainResponse>({ campaign: { id: c.id, platform: c.platform, name: c.name, domain: d.hostname, domainManual: true }, movedRows: moved, resync: 'started' });
  }
  if (path === '/admin/domains' && method === 'POST') { const d: T.Domain = { hostname: String(b.hostname), revShare: Number(b.revShare ?? 0), revShareFrom: null, active: true, squadId: null, googleAccounts: [], metaAccounts: [], gamAccountId: null, managers: [], lastDataAt: null }; DOMAINS.push(d); return out(d); }
  m = path.match(/^\/admin\/domains\/(.+)\/wp-password$/);
  if (m && method === 'POST') { const h = decodeURIComponent(m[1]); const pw = wpPasswordOf(h); if (!pw) throw new ApiError(404, 'no_password', 'Nenhuma senha salva para este domínio.'); return out({ user: DOMAINS.find((x) => x.hostname === h)?.wpUser ?? null, password: pw }); }
  m = path.match(/^\/admin\/domains\/(.+)$/);
  if (m) {
    const d = DOMAINS.find((x) => x.hostname === decodeURIComponent(m![1])); if (!d) throw new ApiError(404, 'not_found', 'Domínio não encontrado.');
    if (d.technical) throw new ApiError(409, 'technical_domain', 'O domínio técnico "Sem domínio" é do sistema e não pode ser alterado. Para tirar campanhas dele, defina o domínio da campanha.');
    if (method === 'DELETE') { if (ROWS.some((r) => r.domain === d.hostname)) throw new ApiError(409, 'domain_has_data', 'Este domínio tem dados históricos. Desative em vez de excluir.'); DOMAINS.splice(DOMAINS.indexOf(d), 1); SQUADS.forEach((s) => (s.domains = s.domains.filter((x) => x !== d.hostname))); return out(undefined); }
    if (b.hostname && b.hostname !== d.hostname) { if (DOMAINS.find((x) => x.hostname === b.hostname)) throw new ApiError(409, 'domain_exists', 'Já existe um domínio com esse nome.'); if (ROWS.some((r) => r.domain === d.hostname)) throw new ApiError(409, 'rename_mock', 'No modo mock não dá para renomear domínios com dados.'); SQUADS.forEach((s) => (s.domains = s.domains.map((x) => (x === d.hostname ? b.hostname : x)))); d.hostname = b.hostname; }
    if (b.squadId !== undefined) { SQUADS.forEach((s) => (s.domains = s.domains.filter((x) => x !== d.hostname))); const s = SQUADS.find((x) => x.id === b.squadId); if (s) s.domains.push(d.hostname); d.squadId = s?.id ?? null; }
    for (const k of ['active', 'googleAccounts', 'metaAccounts', 'gamAccountId', 'registrar', 'expiresOn', 'hosting', 'wpUser'] as const) if (b[k] !== undefined) (d as any)[k] = b[k] === '' ? null : b[k];
    if (b.wpPassword !== undefined) setWpPassword(d.hostname, b.wpPassword || null);
    if (b.revShare !== undefined) { const v = Number(b.revShare); if (!(v >= 0 && v < 100)) throw new ApiError(422, 'invalid_input', 'revShare entre 0 e 99,999%.'); d.revShare = v; d.revShareFrom = b.revShareFrom ?? TODAY; }
    return out(domOut(d));
  }
  if (path === '/admin/squads' && method === 'GET') return out({ squads: SQUADS.map(sqOut) });
  m = path.match(/^\/admin\/squads\/([^/]+)$/);
  if (m && method === 'DELETE') { const s = SQUADS.find((x) => x.id === m![1]); if (!s) throw new ApiError(404, 'not_found', 'Squad não encontrado.'); SQUADS.splice(SQUADS.indexOf(s), 1); USERS.forEach((x) => (x.squadIds = x.squadIds.filter((y) => y !== s.id))); COMPANIES.forEach((c) => (c.squadIds = c.squadIds.filter((y) => y !== s.id))); return out(undefined); }
  if (path.startsWith('/admin/squads')) {
    let s = SQUADS.find((x) => x.id === b.id); if (!s) { s = { id: 's' + Date.now(), name: b.name, companyId: null, domains: [], userIds: [] }; SQUADS.push(s); }
    const sq = s; sq.name = b.name; sq.domains = b.domains ?? []; SQUADS.forEach((x) => { if (x !== sq) x.domains = x.domains.filter((d) => !sq.domains.includes(d)); });
    if (b.companyId !== undefined) { sq.companyId = b.companyId; COMPANIES.forEach((c) => { c.squadIds = c.squadIds.filter((y) => y !== sq.id); if (c.id === b.companyId) c.squadIds.push(sq.id); }); }
    return out(sqOut(sq));
  }
  if (path === '/admin/companies' && method === 'GET') return out({ companies: COMPANIES });
  m = path.match(/^\/admin\/companies(?:\/([^/]+))?$/);
  if (m) {
    if (method === 'DELETE') { const c = COMPANIES.find((x) => x.id === m![1]); if (!c) throw new ApiError(404, 'not_found', 'Empresa não encontrada.'); COMPANIES.splice(COMPANIES.indexOf(c), 1); SQUADS.forEach((sq) => { if (sq.companyId === c.id) sq.companyId = null; }); USERS.forEach((x) => (x.companyIds = x.companyIds.filter((y) => y !== c.id))); return out(undefined); }
    const name = String(b.name ?? '').trim(); if (name.length < 2) throw new ApiError(422, 'invalid_input', 'Nome com pelo menos 2 letras.');
    if (COMPANIES.some((x) => x.id !== m![1] && x.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'company_exists', 'Já existe uma Empresa com esse nome.');
    let c = COMPANIES.find((x) => x.id === m![1]); if (!c) { c = { id: 'c' + Date.now(), name, partnerIds: [], squadIds: [] }; COMPANIES.push(c); }
    const co = c; co.name = name; co.partnerIds = b.partnerIds ?? []; co.squadIds = b.squadIds ?? [];
    SQUADS.forEach((sq) => { if (co.squadIds.includes(sq.id)) sq.companyId = co.id; else if (sq.companyId === co.id) sq.companyId = null; });
    COMPANIES.forEach((x) => { if (x !== co) x.squadIds = x.squadIds.filter((y) => !co.squadIds.includes(y)); });
    USERS.forEach((x) => { const has = co.partnerIds.includes(x.id); x.companyIds = has ? [...new Set([...x.companyIds, co.id])] : x.companyIds.filter((y) => y !== co.id); });
    return out(co);
  }
  if (path === '/admin/users' && method === 'GET') return out({ users: USERS.map(pub) });
  if (path === '/admin/users' && method === 'POST') {
    if (b.role === 'superadmin' && u.role !== 'superadmin') throw new ApiError(403, 'superadmin_only', 'Só um SuperAdmin pode dar a permissão SuperAdmin.');
    if (USERS.find((x) => x.email === String(b.email).toLowerCase())) throw new ApiError(409, 'email_taken', 'Já existe um usuário com esse e-mail.');
    const nu = { id: 'u' + Date.now(), name: b.name, email: String(b.email).toLowerCase(), role: b.role, squadIds: [], companyIds: [], domains: [], status: 'invited' as const, mustChangePassword: true, password: 'temp1234' };
    USERS.push(nu); setLinks(nu, b); return out<T.CreateUserResponse>({ user: pub(nu), inviteSent: true });
  }
  m = path.match(/^\/admin\/users\/([^/]+)(\/resend-invite)?$/);
  if (m) {
    const t = USERS.find((x) => x.id === m![1]); if (!t) throw new ApiError(404, 'not_found', 'Usuário não encontrado.');
    if (u.role !== 'superadmin' && (t.role === 'superadmin' || b.role === 'superadmin')) throw new ApiError(403, 'superadmin_only', 'Só um SuperAdmin pode alterar outro SuperAdmin.');
    if (m[2]) { if (t.status !== 'invited') throw new ApiError(409, 'not_invited', 'Esse usuário já ativou o acesso.'); return out({ inviteSent: true }); }
    if (method === 'DELETE') { if (t.isMainAdmin) throw new ApiError(409, 'main_admin', 'O admin principal não pode ser excluído.'); if (t.id === u.id) throw new ApiError(409, 'self', 'Você não pode excluir a si mesmo.'); USERS.splice(USERS.indexOf(t), 1); return out(undefined); }
    if (method === 'PATCH') {
      if (t.id === u.id && (b.role && b.role !== t.role || b.status === 'disabled')) throw new ApiError(409, 'self', 'Você não pode mudar a sua própria permissão ou se desativar.');
      if (t.isMainAdmin && b.role && b.role !== 'superadmin') throw new ApiError(409, 'main_admin', 'O admin principal é sempre SuperAdmin.');
      const changed = !!b.role && b.role !== t.role;
      if (b.name !== undefined) t.name = String(b.name).trim(); if (b.role) t.role = b.role; if (b.status) t.status = b.status;
      setLinks(t, b, changed);
      return out(pub(t));
    }
  }
  throw new ApiError(404, 'not_found', `Rota mock não implementada: ${method} ${path}`);
}

function fxLatest(source: string, agoMin: number): T.FxLatest {
  const d = discountAt(0); const fr = FXD.filter((x) => x.validFrom <= TODAY).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return { base: 'USD', rates: { USD: 1, BRL: FX.BRL[0], EUR: FX.EUR[0] }, fetchedAt: new Date(Date.now() - agoMin * 60000).toISOString(), source, brlDiscount: d, brlDiscountFrom: fr?.validFrom ?? null, brlRevenueRate: Math.max(0.0001, FX.BRL[0] - d) };
}
const domOut = (d: T.Domain): T.Domain => ({ ...d, hasWpPassword: !!wpPasswordOf(d.hostname), squadId: SQUADS.find((s) => s.domains.includes(d.hostname))?.id ?? null,
  managers: USERS.filter((x) => x.role === 'gestor' && x.domains.some((l) => l.domain === d.hostname)).map((x) => { const l = x.domains.find((y) => y.domain === d.hostname)!; return { userId: x.id, name: x.name, googleAccounts: l.googleAccounts, metaAccounts: l.metaAccounts }; }) });
const sqOut = (s: T.Squad): T.Squad => ({ ...s, userIds: USERS.filter((x) => x.role === 'gerente' && x.squadIds.includes(s.id)).map((x) => x.id) });
/** Mesmas regras de vínculo do servidor (routes/admin/users.ts → saveLinks). */
function setLinks(t: T.User, b: Record<string, any>, roleChanged = false) {
  if (b.squadIds !== undefined || roleChanged) t.squadIds = t.role === 'gerente' ? [...new Set<string>(b.squadIds ?? (roleChanged ? [] : t.squadIds))] : [];
  if (b.companyIds !== undefined) { t.companyIds = [...new Set<string>(b.companyIds)]; COMPANIES.forEach((c) => { const has = t.companyIds.includes(c.id); c.partnerIds = has ? [...new Set([...c.partnerIds, t.id])] : c.partnerIds.filter((y) => y !== t.id); }); }
  if (b.domains !== undefined || roleChanged) {
    const list: T.DomainLink[] = t.role === 'gestor' ? (b.domains ?? (roleChanged ? [] : t.domains)) : [];
    for (const l of list) if (!DOMAINS.find((d) => d.hostname === l.domain)) throw new ApiError(404, 'not_found', `Domínio ${l.domain} não cadastrado.`);
    if (new Set(list.map((l) => l.domain)).size !== list.length) throw new ApiError(409, 'duplicate_domain', 'Domínio repetido.');
    t.domains = list.map((l) => ({ domain: l.domain, googleAccounts: l.googleAccounts ?? [], metaAccounts: l.metaAccounts ?? [] }));
    for (const l of t.domains) { const d = DOMAINS.find((x) => x.hostname === l.domain)!; d.googleAccounts = [...new Set([...d.googleAccounts, ...l.googleAccounts])]; d.metaAccounts = [...new Set([...d.metaAccounts, ...l.metaAccounts])]; }
  }
}

function campaignRows(camps: typeof CAMPS, rows: Row[], recent: Row[], cur: T.Currency): T.CampaignRow[] {
  const g = group(rows, (r) => r.camp); const gr = group(recent, (r) => r.camp);
  return camps.map((c) => ({ id: c.id, platform: c.platform, name: c.name, domain: c.domain, noDomain: c.domain === TECH, accountId: c.acc, accountName: accName(c.acc), status: c.status, metrics: agg(g.get(c.id) ?? [], cur), roiDays: roiDays(gr.get(c.id) ?? [], cur) }));
}

function debugUtm(raw: string): T.UtmDebugResponse {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { status: 'invalid', source: null, domain: '', campaign: null, fields: {}, checks: [{ level: 'error', message: 'URL inválida', detail: 'Cole a URL completa, começando com https://' }], preview: { google: '', meta: '' } }; }
  const host = url.hostname.replace(/^www\./, ''); const q = Object.fromEntries(url.searchParams); const checks: T.UtmDebugResponse['checks'] = [];
  const isMeta = /^(fb|facebook|ig|instagram|an|msg)$/i.test(q.utm_source || '') || q.utm_medium === 'paid_social' || !!q.fbclid;
  const isGoogle = !isMeta && (/^google$/i.test(q.utm_source || '') || !!q.gclid || q.utm_medium === 'cpc');
  const okv = (v?: string) => !!v && !/[{}]/.test(v);
  const source = isMeta ? 'Meta Ads' : isGoogle ? 'Google Ads' : null;
  checks.push(source ? { level: 'ok', message: `Source identificada: ${source}` } : { level: 'error', message: 'Source não identificada', detail: 'utm_source deve ser "google" ou o {{site_source_name}} da Meta.' });
  const dom = DOMAINS.find((d) => d.hostname.toLowerCase() === host.toLowerCase());
  checks.push(dom ? { level: dom.active ? 'ok' : 'warn', message: dom.active ? `Domínio cadastrado: ${dom.hostname}` : `Domínio ${dom.hostname} está inativo` } : { level: 'error', message: `Domínio não identificado: ${host}` });
  Object.entries(q).filter(([, v]) => /[{}]/.test(v)).forEach(([k, v]) => checks.push({ level: 'error', message: `Macro não substituída em ${k}`, detail: `Valor "${v}".` }));
  const [p1, p2] = (q.utm_content || '').split('_');
  // formato do dash antigo (Google Ads): utm_campaign={creative} e utm_content={creative}_{placement}
  const legacy = !isMeta && okv(q.utm_campaign) && ((q.utm_content || '') === q.utm_campaign || (q.utm_content || '').startsWith(q.utm_campaign + '_'));
  if (legacy) {
    const g = CAMPS.filter((x) => x.platform === 'google');
    const lc = g[[...q.utm_campaign].reduce((a, ch) => a + ch.charCodeAt(0), 0) % g.length];   // no demo, qualquer criativo cai numa campanha de exemplo
    const fields = { campaignId: lc?.id ?? null, adGroupId: null, creative: q.utm_campaign, keyword: q.utm_term ?? null, placement: (q.utm_content || '').slice(q.utm_campaign.length + 1) || null, network: q.network ?? null, device: q.device ?? null };
    checks.push({ level: 'ok', message: 'Formato do dash antigo: utm_campaign={creative} e utm_content={creative}_{placement}', detail: 'Campanha e grupo encontrados pelo ID do criativo.' });
    checks.push(okv(fields.placement ?? undefined) ? { level: 'ok', message: 'placement detectado' } : { level: 'warn', message: 'placement vazio' });
    if (lc) checks.push({ level: 'ok', message: `Campanha localizada: ${lc.name}` });
    const base = url.origin + url.pathname;
    return { status: checks.some((x) => x.level === 'error') ? 'invalid' : 'valid', source, domain: host, campaign: lc ? { id: lc.id, name: lc.name } : null, fields, checks, preview: { google: base + '?' + UTM.google, meta: base + '?' + UTM.meta } };
  }
  const fields: Record<string, string | null> = isMeta ? { campaignId: q.utm_campaign ?? null, adSetId: p1 ?? null, adId: p2 ?? null, placement: q.utm_term ?? null } : { campaignId: q.utm_campaign ?? null, adGroupId: p1 ?? null, creative: p2 ?? null, keyword: q.utm_term ?? null, placement: q.placement ?? null, network: q.network ?? null, device: q.device ?? null };
  const need = isMeta ? [['campaignId', 'campaign.id'], ['adSetId', 'adset.id'], ['adId', 'ad.id']] : [['campaignId', 'campaignid'], ['adGroupId', 'adgroupid']];
  need.forEach(([k, l]) => checks.push(okv(fields[k] ?? undefined) ? { level: 'ok', message: `${l} detectado` } : { level: 'error', message: `${l} ausente` }));
  if (!isMeta) checks.push(okv(fields.creative ?? undefined) ? { level: 'ok', message: 'creative detectado' } : { level: 'warn', message: 'creative vazio' });
  checks.push(okv(fields.placement ?? undefined) ? { level: 'ok', message: 'placement detectado' } : { level: 'warn', message: 'placement vazio', detail: 'A análise por placement fica sem essa sessão.' });
  const c = CAMPS.find((x) => x.id === fields.campaignId);
  if (okv(fields.campaignId ?? undefined)) checks.push(c ? { level: 'ok', message: `Campanha localizada: ${c.name}` } : { level: 'error', message: 'Campanha não localizada', detail: 'O ID não existe nas contas importadas.' });
  const base = url.origin + url.pathname;
  return { status: checks.some((x) => x.level === 'error') ? 'invalid' : 'valid', source, domain: host, campaign: c ? { id: c.id, name: c.name } : null, fields, checks, preview: { google: base + '?' + UTM.google, meta: base + '?' + UTM.meta } };
}

export const _mockInfo = { TODAY, first: addDays(TODAY, -(DAYS - 1)) };
