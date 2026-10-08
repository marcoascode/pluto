/**
 * Banco FALSO em memória, só para VITE_API_MOCK=true (npm run dev:mock).
 * Imita o que o servidor Node.js faz com o MySQL: guarda linhas diárias
 * (campaign_country_daily + receita não atribuída) e agrega sob demanda.
 * Pode ser apagado quando o backend estiver no ar.
 */
import type { Currency, Metrics, User, Squad, Domain, AccountStatus, IssueType, Company } from '@/types/api';
import { addDays, lastMonths, todayISO } from '@/lib/period';

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = mulberry(20260930);
const rn = (a: number, b: number) => a + (b - a) * R();
const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
const digits = (n: number) => { let s = String(1 + Math.floor(R() * 9)); for (let i = 1; i < n; i++) s += Math.floor(R() * 10); return s; };

export const TODAY = todayISO();
export const REPORT_MONTHS = 14; // histórico do relatório mensal
const FIRST_DAY = lastMonths(REPORT_MONTHS, TODAY)[REPORT_MONTHS - 1] + '-01';
export const DAYS = Math.round((Date.parse(TODAY) - Date.parse(FIRST_DAY)) / 864e5) + 1;
export const DATES = Array.from({ length: DAYS }, (_, i) => addDays(TODAY, -i)); // DATES[0] = hoje
export const FX: Record<Currency, number[]> = { USD: [], BRL: [], EUR: [] };
for (let i = 0; i < DAYS; i++) { FX.USD[i] = 1; FX.BRL[i] = +(5.38 + 0.06 * Math.sin(i / 4) + rn(-0.02, 0.02)).toFixed(4); FX.EUR[i] = +(0.915 + 0.006 * Math.sin(i / 6)).toFixed(4); }

export const CT: Record<string, { n: string; rps: number; ecpm: number; cpc: number }> = {
  US: { n: 'Estados Unidos', rps: 690, ecpm: 62, cpc: 0.3 }, CA: { n: 'Canadá', rps: 600, ecpm: 55, cpc: 0.26 }, AU: { n: 'Austrália', rps: 520, ecpm: 48, cpc: 0.3 },
  GB: { n: 'Reino Unido', rps: 500, ecpm: 46, cpc: 0.28 }, ES: { n: 'Espanha', rps: 250, ecpm: 24, cpc: 0.12 }, MX: { n: 'México', rps: 120, ecpm: 11, cpc: 0.05 },
  BR: { n: 'Brasil', rps: 95, ecpm: 9, cpc: 0.03 }, CL: { n: 'Chile', rps: 110, ecpm: 10, cpc: 0.05 }, CO: { n: 'Colômbia', rps: 80, ecpm: 7.5, cpc: 0.035 },
  AR: { n: 'Argentina', rps: 60, ecpm: 6, cpc: 0.03 }, PE: { n: 'Peru', rps: 70, ecpm: 6.5, cpc: 0.03 }, ZZ: { n: 'Desconhecido', rps: 100, ecpm: 10, cpc: 0.1 },
};
const CBIAS: Record<string, number> = { US: 0.22, CA: 0.05, AU: -0.14, GB: -0.12, ES: 0, MX: -0.05, BR: 0, CL: 0, CO: -0.1, AR: -0.28, PE: -0.2 };

export const GACC: AccountStatus[] = Array.from({ length: 14 }, (_, i) => ({
  id: 'g' + (i + 1), name: 'Conta Google ' + String(i + 1).padStart(2, '0'), externalId: `${400 + i * 37}-${String(118 + i * 53).padStart(3, '0')}-${String(1000 + i * 611).slice(0, 4)}`,
  currency: i < 3 ? 'BRL' : 'USD', timezone: i === 3 ? 'America/New_York' : 'America/Sao_Paulo', status: i < 5 ? 'ok' : 'not_imported', imported: i < 5,
  lastSyncAt: i < 5 ? new Date(Date.now() - 4 * 60000).toISOString() : null,
}));
Object.assign(GACC[3], { status: 'late', lastSyncAt: new Date(Date.now() - 52 * 60000).toISOString(), message: 'Sincronização atrasada · última há 52 min' });
Object.assign(GACC[4], { status: 'error', message: 'Erro na API · RESOURCE_EXHAUSTED · nova tentativa em 16s' });
Object.assign(GACC[8], { status: 'permission', message: 'Permissão insuficiente · a MCC não tem acesso de leitura' });
export const MACC: AccountStatus[] = [
  { id: 'm1', name: 'Meta Conta 01', externalId: 'act_1000000001', currency: 'USD', timezone: 'America/Sao_Paulo', status: 'ok', lastSyncAt: new Date(Date.now() - 7 * 60000).toISOString() },
  { id: 'm2', name: 'Meta Conta 02', externalId: 'act_1000000002', currency: 'USD', timezone: 'America/Los_Angeles', status: 'warn', lastSyncAt: new Date(Date.now() - 7 * 60000).toISOString(),
    message: '14 linhas sem domínio fora do ROI (US$ 38,40 de custo · 212 cliques) em FB | 12 - TESTE - EN. O link do criativo não aponta para um domínio cadastrado e a campanha/conta não tem domínio: ligue a conta a um domínio em Domínios ou defina o domínio da campanha' },
  { id: 'm3', name: 'Meta Conta 03', externalId: 'act_1000000003', currency: 'BRL', timezone: 'America/Sao_Paulo', status: 'token', lastSyncAt: new Date(Date.now() - 9 * 60000).toISOString(), message: 'Token expira em 5 dias · reconectar' },
  { id: 'm4', name: 'Meta Conta 04', externalId: 'act_1000000004', currency: 'USD', timezone: 'America/Sao_Paulo', status: 'disconnected', lastSyncAt: null, message: 'Desconectada · autenticação necessária' },
];
export const accName = (id: string) => [...GACC, ...MACC].find((a) => a.id === id)?.name ?? id;

export const DOMAINS: Domain[] = [
  { hostname: 'dominioX.com', revShare: 7, revShareFrom: null, active: true, squadId: 's1', googleAccounts: ['g1', 'g2'], metaAccounts: ['m1'], gamAccountId: 'n1', managers: [], lastDataAt: new Date(Date.now() - 4 * 60000).toISOString() },
  { hostname: 'dominioY.com', revShare: 7, revShareFrom: null, active: true, squadId: 's1', googleAccounts: ['g3'], metaAccounts: [], gamAccountId: 'n1', managers: [], lastDataAt: new Date(Date.now() - 5 * 60000).toISOString() },
  { hostname: 'dominioZ.com', revShare: 10, revShareFrom: null, active: true, squadId: 's2', googleAccounts: ['g1'], metaAccounts: ['m1'], gamAccountId: 'n1', managers: [], lastDataAt: new Date(Date.now() - 4 * 60000).toISOString() },
  { hostname: 'dominioA.com', revShare: 7, revShareFrom: null, active: true, squadId: 's2', googleAccounts: ['g4'], metaAccounts: ['m2'], gamAccountId: 'n1', managers: [], lastDataAt: new Date(Date.now() - 52 * 60000).toISOString() },
  { hostname: 'dominioB.com', revShare: 12, revShareFrom: null, active: true, squadId: null, googleAccounts: ['g5'], metaAccounts: ['m3'], gamAccountId: 'n1', managers: [], lastDataAt: new Date(Date.now() - 22 * 60000).toISOString() },
  { hostname: 'dominioC.com', revShare: 0, revShareFrom: null, active: false, squadId: null, googleAccounts: [], metaAccounts: [], gamAccountId: null, managers: [], lastDataAt: null },
];
export const SQUADS: Squad[] = [
  { id: 's1', name: 'Squad 01', companyId: 'c1', domains: ['dominioX.com', 'dominioY.com'], userIds: [] },
  { id: 's2', name: 'Squad 02', companyId: 'c2', domains: ['dominioZ.com', 'dominioA.com'], userIds: [] },
];
/** Empresas (sociedades) de exemplo: sócios + Squads. Nomes genéricos. */
export const COMPANIES: Company[] = [
  { id: 'c1', name: 'Empresa A', partnerIds: ['u1', 'u5'], squadIds: ['s1'] },
  { id: 'c2', name: 'Empresa B', partnerIds: ['u6', 'u5'], squadIds: ['s2'] },
];
export const USERS: (User & { password?: string })[] = [
  { id: 'u1', name: 'Lucas Hirsch', email: 'admin@exemplo.com', role: 'superadmin', squadIds: [], companyIds: ['c1'], domains: [], status: 'active', mustChangePassword: false, isMainAdmin: true, password: 'admin123' },
  { id: 'u4', name: 'Admin Exemplo', email: 'ops@exemplo.com', role: 'admin', squadIds: [], companyIds: [], domains: [], status: 'active', mustChangePassword: false, password: 'admin123' },
  { id: 'u5', name: 'Sócio Principal', email: 'socio@exemplo.com', role: 'gerente', squadIds: [], companyIds: ['c1', 'c2'], domains: [], status: 'active', mustChangePassword: false, password: 'socio123' },
  { id: 'u6', name: 'Sócio B', email: 'socio.b@exemplo.com', role: 'gerente', squadIds: [], companyIds: ['c2'], domains: [], status: 'active', mustChangePassword: false, password: 'socio123' },
  { id: 'u2', name: 'Gestor Exemplo', email: 'gestor@exemplo.com', role: 'gestor', squadIds: [], companyIds: [], status: 'active', mustChangePassword: false, password: 'gestor123',
    domains: [{ domain: 'dominioX.com', googleAccounts: ['g1'], metaAccounts: ['m1'] }, { domain: 'dominioY.com', googleAccounts: ['g3'], metaAccounts: [] }] },
  { id: 'u3', name: 'Ana Exemplo', email: 'ana@exemplo.com', role: 'gestor', squadIds: [], companyIds: [], status: 'invited', mustChangePassword: true,
    domains: [{ domain: 'dominioX.com', googleAccounts: ['g2'], metaAccounts: [] }, { domain: 'dominioZ.com', googleAccounts: ['g1'], metaAccounts: ['m1'] }, { domain: 'dominioA.com', googleAccounts: ['g4'], metaAccounts: ['m2'] }] },
];
/** Deságio (R$ por US$) com histórico. A receita do Ad Manager em BRL usa cotação − deságio do dia. */
export const FXD: { validFrom: string; amount: number; createdAt: string; createdBy: string | null }[] = [];
export function discountAt(di: number) { const d = DATES[di]; let best: { validFrom: string; amount: number } | null = null; for (const x of FXD) if (x.validFrom <= d && (!best || x.validFrom > best.validFrom)) best = x; return best?.amount ?? 0; }
export const UNKNOWN_DOMAIN = 'site-nao-cadastrado.com';
const URLS: Record<string, string[]> = {
  'dominioX.com': ['/cw/url-01/', '/cw/url-02/', '/cw/url-03/', '/cw/url-04/'], 'dominioY.com': ['/vagas/url-01/', '/vagas/url-02/', '/vagas/url-03/'],
  'dominioZ.com': ['/fin/url-01/', '/fin/url-02/'], 'dominioA.com': ['/saude/url-01/', '/cursos/url-02/', '/cursos/url-03/'], 'dominioB.com': ['/receitas/url-01/', '/quiz/url-02/'], [UNKNOWN_DOMAIN]: ['/'],
};

export interface Camp { id: string; platform: 'google' | 'meta'; acc: string; domain: string; name: string; countries: string[]; base: number; bias: number; status: 'ENABLED' | 'PAUSED'; url: string; cOff: Record<string, number>; groups: { id: string; name: string; bias: number; ads: { id: string; name: string; bias: number }[] }[] }
export const CAMPS: Camp[] = [];
const MUN = ['US', 'CA', 'AU', 'GB', 'ES', 'MX'];
const defs: [Camp['platform'], string, string, string, string[], number, number, string, boolean?][] = [
  ['google', 'g1', 'dominioX.com', '01 - CURSOS - MUNDIAL - EN - 336x280', MUN, 210, 0.22, '/cw/url-01/'],
  ['google', 'g2', 'dominioX.com', '01.1 - CURSOS - MUNDIAL - EN - 300x250', MUN, 160, 0.26, '/cw/url-02/'],
  ['google', 'g1', 'dominioX.com', '03 - CURSOS - EUA - EN - 300x250', ['US'], 290, 0.85, '/cw/url-01/'],
  ['google', 'g1', 'dominioX.com', '04 - CURSOS - CAN/EUA/ESP - EN - 300x250', ['US', 'CA', 'ES'], 200, 0.55, '/cw/url-02/'],
  ['google', 'g1', 'dominioX.com', '05 - CURSOS - ESPANHA - ES - 300x250', ['ES'], 60, 0.06, '/cw/url-04/', true],
  ['google', 'g3', 'dominioY.com', '02 - EMPREGOS - BRASIL - PT - 336x280', ['BR'], 240, 0.16, '/vagas/url-01/'],
  ['google', 'g3', 'dominioY.com', '02.2 - EMPREGOS - DISCOVER - BRASIL - PT', ['BR'], 58, -0.22, '/vagas/url-03/'],
  ['google', 'g1', 'dominioZ.com', '07 - FINANÇAS - MUNDIAL - ES - 336x280', ['ES', 'MX', 'AR', 'CO', 'CL', 'PE'], 72, -0.05, '/fin/url-02/'],
  ['google', 'g4', 'dominioA.com', '08 - SAÚDE - EUA/CAN - EN - 300x250', ['US', 'CA'], 140, 0.34, '/saude/url-01/'],
  ['google', 'g4', 'dominioA.com', '09 - CURSOS - PAÍSES - EN - 336x280', ['CA', 'US', 'GB', 'AU'], 77, 1.0, '/cursos/url-02/'],
  ['google', 'g5', 'dominioB.com', '10 - RECEITAS - MUNDIAL - ES - 336x280', ['MX', 'ES', 'CO', 'AR'], 34, -0.36, '/receitas/url-01/'],
  ['meta', 'm1', 'dominioX.com', 'FB | 03 - CURSOS - EUA | CBO', ['US'], 180, 0.3, '/cw/url-01/'],
  ['meta', 'm1', 'dominioZ.com', 'FB | 06 - FINANÇAS - LATAM | ABO', ['MX', 'CO', 'CL'], 90, 0.08, '/fin/url-01/'],
  ['meta', 'm2', 'dominioA.com', 'FB | 08 - SAÚDE - EUA/CAN | Advantage+', ['US', 'CA'], 240, 0.42, '/saude/url-01/'],
  ['meta', 'm3', 'dominioB.com', 'FB | 11 - QUIZ - CHILE', ['CL'], 40, -0.12, '/quiz/url-02/'],
];
for (const [platform, acc, domain, name, countries, base, bias, url, paused] of defs) {
  const id = platform === 'google' ? digits(11) : '1202' + digits(14);
  const c: Camp = { id, platform, acc, domain, name, countries, base, bias, status: paused ? 'PAUSED' : 'ENABLED', url, cOff: {}, groups: [] };
  countries.forEach((k) => (c.cOff[k] = gauss() * 0.3));
  for (let g = 0; g < 2; g++) {
    const gid = platform === 'google' ? digits(11) : '1202' + digits(14);
    c.groups.push({ id: gid, name: (platform === 'google' ? 'Grupo ' : 'Conjunto ') + String(g + 1).padStart(2, '0'), bias: gauss() * 0.12,
      ads: [0, 1].map((a) => ({ id: platform === 'google' ? digits(12) : '1202' + digits(14), name: 'Criativo ' + String(g * 2 + a + 1).padStart(2, '0'), bias: gauss() * 0.12 })) });
  }
  CAMPS.push(c);
}

export interface Row { di: number; src: 'google' | 'meta' | 'unatt'; acc: string | null; camp: string | null; grp: string | null; ad: string | null; domain: string; url: string; country: string; reason?: IssueType; spendUSD: number; revUSD: number; grossUSD: number; sess: number; adImps: number; rsv: number; adReq: number; adClk: number; view: number; clk: number; tImps: number }
export const ROWS: Row[] = [];
/** Drop-off base por URL (algumas com problema, para a tela de URLs ter alerta) e rev share retido por domínio. */
const DROP_HOT: Record<string, number> = { 'dominioX.com|/cw/url-03/': 0.27, 'dominioB.com|/quiz/url-02/': 0.31, 'dominioZ.com|/fin/url-02/': 0.19 };
const URLDROP = new Map<string, number>();
const urlDrop = (d: string, u: string) => { const k = d + '|' + u; if (!URLDROP.has(k)) URLDROP.set(k, DROP_HOT[k] ?? rn(0.05, 0.12)); return URLDROP.get(k)!; };
export const META_IVA = 0.1383;
/** revShare (fração) de cada domínio — a receita do mock já é a líquida. */
export const DOMSHARE: Record<string, number> = { 'dominioX.com': 0.07, 'dominioY.com': 0.07, 'dominioZ.com': 0.1, 'dominioA.com': 0.07, 'dominioB.com': 0.12 };
/** Volume menor no passado + sazonalidade, para o relatório mensal não ficar plano. */
const volOf = (di: number) => (0.58 + 0.42 * Math.cos((di / DAYS) * (Math.PI / 1.6))) * (1 + 0.16 * Math.sin(di / 23));
function served(domain: string, url: string, adImps: number) { const drop = Math.min(0.6, Math.max(0.01, urlDrop(domain, url) * Math.exp(gauss() * 0.12))); return Math.round(adImps / (1 - drop)); }
for (const c of CAMPS) {
  const w = c.countries.map((_, i) => Math.pow(0.5, i)); const ws = w.reduce((a, b) => a + b, 0);
  for (let di = 0; di < DAYS; di++) {
    if (c.status === 'PAUSED' && di < 5) continue;
    const scale = (di === 0 ? 0.4 : 1) * volOf(di) * (c.platform === 'meta' ? 0.75 + 0.55 * Math.sin(di / 52 + 1) : 1); const trend = 1 + 0.14 * Math.sin((di + c.base) / 5);
    c.countries.forEach((k, i) => {
      const spend = c.base * (w[i] / ws) * trend * scale * Math.exp(gauss() * 0.18); if (spend < 0.04) return;
      const g = pick(c.groups), ad = pick(g.ads);
      const roi = Math.max(-0.92, c.bias + CBIAS[k] + c.cOff[k] + g.bias + ad.bias + 0.16 * Math.sin(di / 38 + 0.6) + gauss() * 0.22); const rev = spend * (1 + roi); const ct = CT[k];
      const adImps = Math.max(1, Math.round((rev * 1000) / (ct.ecpm * Math.exp(gauss() * 0.1))));
      const clk = Math.max(1, Math.round(spend / (ct.cpc * Math.exp(gauss() * 0.15) * (c.platform === 'meta' ? 1.25 : 1))));
      const rsv = served(c.domain, c.url, adImps);
      ROWS.push({ di, src: c.platform, acc: c.acc, camp: c.id, grp: g.id, ad: ad.id, domain: c.domain, url: c.url, country: k, spendUSD: spend, revUSD: rev, grossUSD: rev / (1 - (DOMSHARE[c.domain] ?? 0)),
        sess: Math.max(1, Math.round((rev * 1000) / (ct.rps * Math.exp(gauss() * 0.12)))), adImps, rsv, adReq: Math.round(rsv / rn(0.84, 0.96)), adClk: Math.round(adImps * rn(0.009, 0.024)), view: adImps * rn(0.88, 0.96), clk, tImps: Math.round(clk / rn(0.025, 0.07)) });
    });
  }
}
const REASONS_BY_DOMAIN: Record<string, IssueType[]> = { 'dominioX.com': ['missing_campaign_id', 'gads_creative_not_found'], 'dominioY.com': ['missing_adgroup_id'], 'dominioZ.com': ['invalid_utm', 'meta_ad_not_found'], 'dominioA.com': ['campaign_not_found'], 'dominioB.com': ['missing_campaign_id', 'meta_ad_not_found'] };
function pushUn(di: number, domain: string, url: string, country: string, rev: number, reason: IssueType) {
  const ct = CT[country] ?? CT.ZZ; const adImps = Math.max(1, Math.round((rev * 1000) / ct.ecpm));
  const rsv = served(domain, url, adImps);
  ROWS.push({ di, src: 'unatt', acc: null, camp: null, grp: null, ad: null, domain, url, country, reason, spendUSD: 0, revUSD: rev, grossUSD: rev / (1 - (DOMSHARE[domain] ?? 0)), sess: Math.max(1, Math.round((rev * 1000) / ct.rps)), adImps, rsv, adReq: Math.round(rsv / 0.9), adClk: Math.round(adImps * 0.014), view: adImps * 0.91, clk: 0, tImps: 0 });
}
{
  const byDom = new Map<string, number>(); for (const r of ROWS) byDom.set(r.domain + '|' + r.di, (byDom.get(r.domain + '|' + r.di) ?? 0) + r.revUSD);
  for (const [k, v] of byDom) { const [dom, dis] = k.split('|'); pushUn(+dis, dom, pick(URLS[dom]), CAMPS.find((c) => c.domain === dom)!.countries[0], v * (dom === 'dominioB.com' ? rn(0.08, 0.12) : rn(0.012, 0.035)), pick(REASONS_BY_DOMAIN[dom])); }
  for (let di = 0; di < DAYS; di++) pushUn(di, UNKNOWN_DOMAIN, '/', 'US', rn(3, 8) * (di === 0 ? 0.4 : 1) * volOf(di), 'unknown_domain');
}

/** Mesma agregação que o servidor faz em SQL (SUM + fórmulas). */
export function agg(rows: Row[], cur: Currency): Metrics {
  // spend = Google + Meta + IVA (13,83% sobre a Meta) · revenue = bruta × (1 − revShare do domínio)
  const s = { spend: 0, gs: 0, ms: 0, iva: 0, rev: 0, gross: 0, att: 0, un: 0, sess: 0, ai: 0, ar: 0, rsv: 0, ac: 0, vw: 0, clk: 0, ti: 0 };
  for (const r of rows) { const f = FX[cur][r.di] ?? 1; const fr = cur === 'BRL' ? Math.max(0.0001, f - discountAt(r.di)) : f; const sp = r.spendUSD * f, rv = r.revUSD * fr, iv = r.src === 'meta' ? sp * META_IVA : 0; s.spend += sp + iv; s.iva += iv; if (r.src === 'google') s.gs += sp; else if (r.src === 'meta') s.ms += sp;
    s.rev += rv; s.gross += r.grossUSD * fr; s.rsv += r.rsv; if (r.src === 'unatt') s.un += rv; else s.att += rv; s.sess += r.sess; s.ai += r.adImps; s.ar += r.adReq; s.ac += r.adClk; s.vw += r.view; s.clk += r.clk; s.ti += r.tImps; }
  const profit = s.rev - s.spend;
  return { revenue: s.rev, grossRevenue: s.gross, spend: s.spend, googleSpend: s.gs, metaSpend: s.ms, iva: s.iva,
    googleShare: s.spend > 0 ? (s.gs / s.spend) * 100 : null, metaShare: s.spend > 0 ? (s.ms / s.spend) * 100 : null, profit, roi: s.spend > 0 ? (profit / s.spend) * 100 : null, margin: s.rev > 0 ? (profit / s.rev) * 100 : null,
    rps: s.sess ? (s.rev / s.sess) * 1000 : null, ecpm: s.ai ? (s.rev / s.ai) * 1000 : null, impressions: s.ai, adRequests: s.ar, responsesServed: s.rsv, dropOffRate: s.rsv ? ((s.rsv - s.ai) / s.rsv) * 100 : null, fillRate: s.ar ? (s.ai / s.ar) * 100 : null,
    ctr: s.ai ? (s.ac / s.ai) * 100 : null, adClicks: s.ac, viewability: s.ai ? (s.vw / s.ai) * 100 : null, sessions: s.sess, trafficClicks: s.clk, trafficImpressions: s.ti,
    trafficCtr: s.ti ? (s.clk / s.ti) * 100 : null, cpc: s.clk ? s.spend / s.clk : null, attributedRevenue: s.att, unattributedRevenue: s.un, attributionRate: s.rev ? (s.att / s.rev) * 100 : null };
}
export const dayIndex = (iso: string) => DATES.indexOf(iso);
