/**
 * Servidor FALSO: responde às mesmas rotas de docs/API.md usando mocks/db.ts.
 * Aplica a mesma regra de Squad que o backend precisa aplicar.
 */
import { ApiError } from '@/lib/api/client';
import type * as T from '@/types/api';
import { addDays, lastMonths } from '@/lib/period';
import { agg, CAMPS, CT, DATES, DAYS, DOMAINS, FX, GACC, MACC, ROWS, SQUADS, TODAY, UNKNOWN_DOMAIN, USERS, accName, dayIndex, type Row } from './db';

const LS = { get: <V,>(k: string): V | null => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const me = (): (typeof USERS)[number] | null => USERS.find((u) => u.id === LS.get<string>('pluto_mock_session')) ?? null;
/* ---- permissões (mesma regra do servidor) ---- */
const CAPS: T.CapabilityDef[] = [
  { key: 'reports.view', label: 'Relatórios (dia e mês)', group: 'Visualização', adminOnly: false },
  { key: 'urls.view', label: 'URLs e Drop-off', group: 'Visualização', adminOnly: false },
  { key: 'campaigns.google.view', label: 'Google Ads', group: 'Visualização', adminOnly: false },
  { key: 'campaigns.meta.view', label: 'Meta Ads', group: 'Visualização', adminOnly: false },
  { key: 'gam.view', label: 'Google Ad Manager', group: 'Visualização', adminOnly: false },
  { key: 'attribution.view', label: 'Attribution Health', group: 'Visualização', adminOnly: false },
  { key: 'utm.debug', label: 'UTM Debugger', group: 'Visualização', adminOnly: false },
  { key: 'admin.integrations', label: 'Conectar APIs e contas / frequência do sync', group: 'Administração', adminOnly: true },
  { key: 'admin.users', label: 'Usuários, Squads e permissões', group: 'Administração', adminOnly: true },
  { key: 'admin.domains', label: 'Domínios', group: 'Administração', adminOnly: true },
  { key: 'admin.utms', label: 'UTMs globais', group: 'Administração', adminOnly: true },
  { key: 'admin.currency', label: 'Moedas e câmbio', group: 'Administração', adminOnly: true },
];
let GESTOR_CAPS: T.Capability[] = CAPS.filter((c) => !c.adminOnly).map((c) => c.key);
const capsOf = (u: T.User): T.Capability[] => (u.role === 'total' ? CAPS.map((c) => c.key) : GESTOR_CAPS);
const need = (u: T.User, cap: T.Capability) => { if (!capsOf(u).includes(cap)) throw new ApiError(403, 'forbidden_module', 'Este módulo não está liberado para o seu usuário.'); };
const pub = (u: (typeof USERS)[number]): T.User => { const { password: _p, ...rest } = u; return { ...rest, permissions: capsOf(u) }; };

/* ---- contas das integrações e agendamentos (mock) ---- */
const PROV_OF: Record<string, T.Provider> = { g: 'google-ads', m: 'meta', n: 'gam' };
const ACCTS: T.IntegrationAccount[] = [
  ...GACC.map((a) => ({ id: a.id, provider: 'google-ads' as const, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, imported: !!a.imported, domains: [], status: a.status, lastSyncAt: a.lastSyncAt, message: a.message })),
  ...MACC.map((a) => ({ id: a.id, provider: 'meta' as const, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, imported: true, domains: [], status: a.status, lastSyncAt: a.lastSyncAt, message: a.message })),
  { id: 'n1', provider: 'gam', name: 'Minha Rede GAM', externalId: '12345678', currency: 'USD', timezone: 'America/Sao_Paulo', imported: true, domains: [], status: 'ok', lastSyncAt: new Date(Date.now() - 6 * 60000).toISOString() },
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
  ['google-ads.metrics', 'google-ads', 'Custo por campanha × país', 'incremental · D-3 → hoje', 30], ['google-ads.structure', 'google-ads', 'Estrutura: campanhas, grupos, anúncios', 'incremental', 120],
  ['meta.metrics', 'meta', 'Insights por anúncio × país', 'incremental · D-3 → hoje', 30], ['meta.structure', 'meta', 'Estrutura: campanha, conjunto, anúncio', 'incremental', 120],
  ['gam.revenue', 'gam', 'Receita e delivery por key-values × país × URL', 'reprocessa hoje e D-1 a D-3', 60], ['gam.close', 'gam', 'Fechamento de receita', 'reprocessa D-4 a D-7', 1440],
  ['fx.rates', 'fx', 'Cotações USD → BRL e EUR (Frankfurter)', 'hoje + dias que faltarem', 360],
] as const).map(([id, provider, label, window, every]) => ({ id, provider, label, window, everyMinutes: every, enabled: true, lastRunAt: new Date(now - 7 * 60000).toISOString(), nextRunAt: new Date(now + (every - 7) * 60000).toISOString(), lastStatus: 'success' as const }));
void PROV_OF;

function allowed(u: T.User): Set<string> {
  if (u.role === 'total') return new Set([...DOMAINS.map((d) => d.hostname), UNKNOWN_DOMAIN]);
  const s = SQUADS.find((x) => x.id === u.squadId);
  return new Set((s?.domains ?? []).filter((d) => DOMAINS.find((x) => x.hostname === d)?.active));
}
function range(q: Record<string, unknown>) {
  const a = dayIndex(String(q.to)), b = dayIndex(String(q.from));
  return [a < 0 ? 0 : a, b < 0 ? DAYS - 1 : b] as const;
}
function rowsFor(u: T.User, q: Record<string, unknown>, extra?: (r: Row) => boolean, override?: readonly [number, number]) {
  const al = allowed(u); const [a, b] = override ?? range(q); const dom = q.domain ? String(q.domain) : '';
  if (dom && !al.has(dom)) throw new ApiError(403, 'forbidden_domain', 'Você não tem acesso a este domínio.');
  return ROWS.filter((r) => r.di >= a && r.di <= b && al.has(r.domain) && (!dom || r.domain === dom) && (!extra || extra(r)));
}
function comparison(u: T.User, q: Record<string, unknown>, extra: ((r: Row) => boolean) | undefined, cur: T.Currency): T.Comparison | null {
  const [a0, b] = range(q); if (a0 === 0 && b === 0) return null; const a = a0 === 0 ? 1 : a0; const len = b - a + 1; const pa = b + 1, pb = b + len; if (pb >= DAYS) return null;
  return { from: DATES[pb], to: DATES[pa], metrics: agg(rowsFor(u, q, extra, [pa, pb]), cur) };
}
function roiDays(rows: Row[], cur: T.Currency): T.RoiDays {
  const by = (d: number) => { const x = rows.filter((r) => r.di === d); return x.length ? agg(x, cur).roi : null; };
  return { today: by(0), d1: by(1), d2: by(2), d3: by(3) };
}
function group<K>(rows: Row[], fn: (r: Row) => K) { const m = new Map<K, Row[]>(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); } return m; }

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

  if (path === '/me/domains') return out({ domains: [...allowed(u)].filter((d) => DOMAINS.find((x) => x.hostname === d && x.active)) });
  if (path === '/search') {
    const t = String(q.q || '').toLowerCase(); const al = allowed(u); const results: T.SearchResult[] = [];
    CAMPS.filter((c) => al.has(c.domain) && (c.name.toLowerCase().includes(t) || c.id.includes(t))).slice(0, 6).forEach((c) => results.push({ kind: 'campaign', label: c.name, sub: c.id, platform: c.platform, id: c.id, domain: c.domain }));
    DOMAINS.filter((d) => al.has(d.hostname) && d.active && d.hostname.toLowerCase().includes(t)).forEach((d) => results.push({ kind: 'domain', label: d.hostname, domain: d.hostname }));
    return out({ results });
  }
  if (path.startsWith('/admin') && u.role !== 'total') throw new ApiError(403, 'forbidden', 'Área exclusiva de Acesso Total.');

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
    return out<T.DomainDetailResponse>({ domain: dom, comparison: comparison(u, qq, undefined, cur), metrics: agg(rows, cur), campaignTotals: agg(cr, cur), campaignTotalsRoiDays: roiDays(crec, cur), campaigns: campaignRows(CAMPS.filter((c) => c.domain === dom), rows, recent, cur) });
  }
  if (path === '/campaigns') {
    const platform = q.platform as T.Platform; need(u, platform === 'google' ? 'campaigns.google.view' : 'campaigns.meta.view'); const al = allowed(u);
    let camps = CAMPS.filter((c) => c.platform === platform && al.has(c.domain) && (!q.domain || c.domain === q.domain) && (!q.accountId || c.acc === q.accountId));
    if (q.includePaused !== true && q.includePaused !== 'true') camps = camps.filter((c) => c.status === 'ENABLED');
    const ids = new Set(camps.map((c) => c.id)); const rows = rowsFor(u, q, (r) => ids.has(r.camp!)); const recent = rowsFor(u, q, (r) => ids.has(r.camp!), [0, 3]);
    return out<T.CampaignsResponse>({ comparison: comparison(u, q, (r) => ids.has(r.camp!), cur), totals: agg(rows, cur), totalsRoiDays: roiDays(recent, cur), campaigns: campaignRows(camps, rows, recent, cur),
      accounts: [...new Set(CAMPS.filter((c) => c.platform === platform && al.has(c.domain)).map((c) => c.acc))].map((id) => ({ id, name: accName(id) })) });
  }
  m = path.match(/^\/campaigns\/(google|meta)\/([^/]+)\/(children|countries)$/);
  if (m) {
    const c = CAMPS.find((x) => x.id === m![2]); if (!c || !allowed(u).has(c.domain)) throw new ApiError(404, 'not_found', 'Campanha não encontrada.');
    const rows = rowsFor(u, q, (r) => r.camp === c.id); const recent = rowsFor(u, q, (r) => r.camp === c.id, [0, 3]);
    if (m[3] === 'children') return out<T.CampaignChildrenResponse>({ groups: c.groups.map((g) => ({ id: g.id, name: g.name, metrics: agg(rows.filter((r) => r.grp === g.id), cur), roiDays: roiDays(recent.filter((r) => r.grp === g.id), cur),
      ads: g.ads.map((a) => ({ id: a.id, name: a.name, metrics: agg(rows.filter((r) => r.ad === a.id), cur), roiDays: roiDays(recent.filter((r) => r.ad === a.id), cur) })) })) });
    return out<T.CampaignCountriesResponse>({ campaign: { id: c.id, name: c.name, platform: c.platform, domain: c.domain }, totals: agg(rows, cur),
      countries: [...group(rows, (r) => r.country)].map(([k, rs]) => ({ country: k, name: CT[k].n, metrics: agg(rs, cur) })) });
  }
  if (path === '/urls') { need(u, 'urls.view'); const rows = rowsFor(u, q, (r) => !!DOMAINS.find((d) => d.hostname === r.domain)); return out<T.UrlsResponse>({ urls: [...group(rows, (r) => r.domain + '|' + r.url)].map(([k, rs]) => { const [d, p] = k.split('|'); return { domain: d, path: p, metrics: agg(rs, cur) }; }) }); }
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
  if (path === '/fx/latest') return out<T.FxLatest>({ base: 'USD', rates: { USD: 1, BRL: FX.BRL[0], EUR: FX.EUR[0] }, fetchedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'API de câmbio (mock)' });
  if (path === '/fx/history') return out({ rows: DATES.slice(0, Number(q.days) || 10).map((d, i) => ({ date: d, BRL: FX.BRL[i], EUR: FX.EUR[i] })) });

  /* ---- admin ---- */
  if (path === '/admin/integrations') return out<T.IntegrationsResponse>({
    google: { connected: true, googleAccount: 'midia@exemplo.com', mccName: 'Pluto Media MCC', mccCustomerId: '123-456-7890', accountsFound: GACC.length, lastSyncAt: new Date(Date.now() - 4 * 60000).toISOString(), accounts: GACC },
    meta: { connected: true, business: 'Pluto Media BM', user: 'midia@exemplo.com', lastSyncAt: new Date(Date.now() - 7 * 60000).toISOString(), accounts: MACC },
    gam: { connected: true, googleAccount: 'financeiro@exemplo.com', networkName: 'Minha Rede GAM', networkCode: '12345678', currency: 'USD', timezone: 'America/Sao_Paulo', status: 'ok', lastSyncAt: new Date(Date.now() - 6 * 60000).toISOString() } });
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
  if (m) { const st = SYNC.find((x) => x.id === decodeURIComponent(m![1])); if (!st) throw new ApiError(404, 'not_found', 'Job não encontrado.');
    if (b.everyMinutes !== undefined) { const v = Number(b.everyMinutes); if (!(v >= 15 && v <= 1440)) throw new ApiError(422, 'invalid_frequency', 'Frequência entre 15 min e 24 h.'); st.everyMinutes = v; }
    if (b.enabled !== undefined) st.enabled = !!b.enabled;
    st.nextRunAt = st.enabled ? new Date(Date.parse(st.lastRunAt ?? new Date().toISOString()) + st.everyMinutes * 60000).toISOString() : null; return out(st); }
  if (path === '/admin/fx/refresh') { FX.BRL[0] = +(FX.BRL[0] + (Math.random() - 0.5) * 0.01).toFixed(4); return out<T.FxLatest>({ base: 'USD', rates: { USD: 1, BRL: FX.BRL[0], EUR: FX.EUR[0] }, fetchedAt: new Date().toISOString(), source: 'Frankfurter (mock)' }); }
  if (path === '/admin/permissions') {
    if (method === 'PUT') { const want = (b.gestor ?? []) as T.Capability[]; GESTOR_CAPS = CAPS.filter((c) => !c.adminOnly && want.includes(c.key)).map((c) => c.key); }
    return out<T.PermissionsResponse>({ capabilities: CAPS, roles: { gestor: GESTOR_CAPS, total: CAPS.map((c) => c.key) } });
  }
  if (/\/sync$/.test(path)) return out(undefined);
  if (path === '/admin/domains' && method === 'GET') return out({ domains: DOMAINS.map((d) => ({ ...d, squadId: SQUADS.find((s) => s.domains.includes(d.hostname))?.id ?? null })) });
  if (path === '/admin/domains' && method === 'POST') { const d: T.Domain = { hostname: String(b.hostname), active: true, squadId: null, googleAccounts: [], metaAccounts: [], lastDataAt: null }; DOMAINS.push(d); return out(d); }
  m = path.match(/^\/admin\/domains\/(.+)$/);
  if (m) {
    const d = DOMAINS.find((x) => x.hostname === decodeURIComponent(m![1])); if (!d) throw new ApiError(404, 'not_found', 'Domínio não encontrado.');
    if (method === 'DELETE') { if (ROWS.some((r) => r.domain === d.hostname)) throw new ApiError(409, 'domain_has_data', 'Este domínio tem dados históricos. Desative em vez de excluir.'); DOMAINS.splice(DOMAINS.indexOf(d), 1); SQUADS.forEach((s) => (s.domains = s.domains.filter((x) => x !== d.hostname))); return out(undefined); }
    if (b.hostname && b.hostname !== d.hostname) { if (DOMAINS.find((x) => x.hostname === b.hostname)) throw new ApiError(409, 'domain_exists', 'Já existe um domínio com esse nome.'); if (ROWS.some((r) => r.domain === d.hostname)) throw new ApiError(409, 'rename_mock', 'No modo mock não dá para renomear domínios com dados.'); SQUADS.forEach((s) => (s.domains = s.domains.map((x) => (x === d.hostname ? b.hostname : x)))); d.hostname = b.hostname; }
    if (b.squadId !== undefined) { SQUADS.forEach((s) => (s.domains = s.domains.filter((x) => x !== d.hostname))); const s = SQUADS.find((x) => x.id === b.squadId); if (s) s.domains.push(d.hostname); d.squadId = s?.id ?? null; }
    for (const k of ['active', 'googleAccounts', 'metaAccounts'] as const) if (b[k] !== undefined) (d as any)[k] = b[k];
    return out(d);
  }
  if (path === '/admin/squads' && method === 'GET') return out({ squads: SQUADS.map((s) => ({ ...s, userIds: USERS.filter((x) => x.squadId === s.id).map((x) => x.id) })) });
  m = path.match(/^\/admin\/squads\/([^/]+)$/);
  if (m && method === 'DELETE') { const s = SQUADS.find((x) => x.id === m![1]); if (!s) throw new ApiError(404, 'not_found', 'Squad não encontrado.'); if (USERS.some((x) => x.squadId === s.id)) throw new ApiError(409, 'squad_has_users', 'Este Squad tem gestores. Mova-os para outro Squad antes.'); SQUADS.splice(SQUADS.indexOf(s), 1); DOMAINS.forEach((d) => { if (d.squadId === s.id) d.squadId = null; }); return out(undefined); }
  if (path.startsWith('/admin/squads')) { let s = SQUADS.find((x) => x.id === b.id); if (!s) { s = { id: 's' + Date.now(), name: b.name, domains: [], userIds: [] }; SQUADS.push(s); } s.name = b.name; s.domains = b.domains ?? []; SQUADS.forEach((x) => { if (x !== s) x.domains = x.domains.filter((d) => !s!.domains.includes(d)); }); return out(s); }
  if (path === '/admin/users' && method === 'GET') return out({ users: USERS.map(pub) });
  if (path === '/admin/users' && method === 'POST') {
    if (USERS.find((x) => x.email === String(b.email).toLowerCase())) throw new ApiError(409, 'email_taken', 'Já existe um usuário com esse e-mail.');
    const nu = { id: 'u' + Date.now(), name: b.name, email: String(b.email).toLowerCase(), role: b.role, squadId: b.squadId ?? null, status: 'invited' as const, mustChangePassword: true, password: 'temp1234' };
    USERS.push(nu); return out<T.CreateUserResponse>({ user: pub(nu), inviteSent: true });
  }
  m = path.match(/^\/admin\/users\/([^/]+)(\/resend-invite)?$/);
  if (m) {
    const t = USERS.find((x) => x.id === m![1]); if (!t) throw new ApiError(404, 'not_found', 'Usuário não encontrado.');
    if (m[2]) { if (t.status !== 'invited') throw new ApiError(409, 'not_invited', 'Esse usuário já ativou o acesso.'); return out({ inviteSent: true }); }
    if (method === 'DELETE') { if (t.isMainAdmin) throw new ApiError(409, 'main_admin', 'O admin principal não pode ser excluído.'); if (t.id === u.id) throw new ApiError(409, 'self', 'Você não pode excluir a si mesmo.'); USERS.splice(USERS.indexOf(t), 1); return out(undefined); }
    if (method === 'PATCH') {
      if (t.id === u.id && (b.role && b.role !== t.role || b.status === 'disabled')) throw new ApiError(409, 'self', 'Você não pode mudar a sua própria permissão ou se desativar.');
      if (t.isMainAdmin && b.role === 'gestor') throw new ApiError(409, 'main_admin', 'O admin principal sempre tem Acesso Total.');
      if (b.name !== undefined) t.name = String(b.name).trim(); if (b.role) t.role = b.role; if (b.squadId !== undefined) t.squadId = t.role === 'gestor' ? b.squadId : null; if (b.status) t.status = b.status;
      if (t.role === 'gestor' && !t.squadId) throw new ApiError(422, 'squad_required', 'Gestor precisa de um Squad.');
      return out(pub(t));
    }
  }
  throw new ApiError(404, 'not_found', `Rota mock não implementada: ${method} ${path}`);
}

function campaignRows(camps: typeof CAMPS, rows: Row[], recent: Row[], cur: T.Currency): T.CampaignRow[] {
  const g = group(rows, (r) => r.camp); const gr = group(recent, (r) => r.camp);
  return camps.map((c) => ({ id: c.id, platform: c.platform, name: c.name, domain: c.domain, accountId: c.acc, accountName: accName(c.acc), status: c.status, metrics: agg(g.get(c.id) ?? [], cur), roiDays: roiDays(gr.get(c.id) ?? [], cur) }));
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
