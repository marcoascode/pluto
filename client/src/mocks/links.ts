/** 0.17 (modo demo) — mesmas regras de routes/links.ts: vínculo conta → site com data e atribuição aos gestores. Ids de domínio = hostname. */
import { ApiError } from '@/lib/api/client';
import { addDays } from '@/lib/period';
import type * as T from '@/types/api';
import { DOMAINS, GACC, MACC, TECH, TODAY, USERS } from './db';

type Prov = 'google-ads' | 'meta';
interface Per { id: string; from: string; domains: string[]; by: string | null; at: string }
const ALWAYS = '2000-01-01';
const ACC = [...GACC.map((a) => ({ id: a.id, name: a.name, externalId: a.externalId, provider: 'google-ads' as Prov, imported: !!a.imported, status: a.status })),
  ...MACC.map((a) => ({ id: a.id, name: a.name, externalId: a.externalId, provider: 'meta' as Prov, imported: true, status: a.status }))];
const key = (p: Prov) => (p === 'google-ads' ? 'googleAccounts' : 'metaAccounts') as 'googleAccounts' | 'metaAccounts';
const curOf = (id: string) => { const a = ACC.find((x) => x.id === id)!; return DOMAINS.filter((d) => !d.technical && d[key(a.provider)].includes(id)).map((d) => d.hostname).sort(); };
const setCur = (id: string, hosts: string[]) => { const k = key(ACC.find((x) => x.id === id)!.provider); DOMAINS.forEach((d) => { const has = d[k].includes(id), want = hosts.includes(d.hostname); if (want && !has) d[k] = [...d[k], id]; if (!want && has) d[k] = d[k].filter((x) => x !== id); }); };
let seq = 1;
const HIST: Record<string, Per[]> = {};
const MANAGER_ACCS: Record<string, Set<string>> = {};
let seeded = false;
function seed() {
  if (seeded) return; seeded = true;
  for (const a of ACC) { const c = curOf(a.id); if (c.length) HIST[a.id] = [{ id: String(seq++), from: ALWAYS, domains: c, by: null, at: new Date().toISOString() }]; }
  // exemplo: uma conta que trocou de site há 12 dias (site antigo penalizado no Ad Manager)
  const g = HIST.g2;
  if (g?.length && g[0].domains.join() !== 'dominioZ.com') HIST.g2 = [{ id: String(seq++), from: ALWAYS, domains: ['dominioZ.com'], by: null, at: new Date().toISOString() }, { ...g[0], from: addDays(TODAY, -12), by: 'Sócio Principal' }];
  for (const u of USERS.filter((x) => x.role === 'gestor')) MANAGER_ACCS[u.id] = new Set(u.domains.flatMap((l) => [...l.googleAccounts, ...l.metaAccounts]));
}
const canDate = (r: T.Role) => r !== 'gestor';
function ctx(u: T.User, allowed: Set<string>) {
  seed();
  const nonTech = DOMAINS.filter((d) => !d.technical && d.hostname !== TECH).map((d) => d.hostname);
  if (u.role === 'admin' || u.role === 'superadmin') return { doms: new Set(nonTech), accs: new Set(ACC.map((a) => a.id)) };
  if (u.role === 'gerente') {
    const doms = new Set(nonTech.filter((h) => allowed.has(h)));
    const gestAccs = USERS.filter((g) => g.role === 'gestor' && g.domains.some((l) => doms.has(l.domain))).flatMap((g) => [...(MANAGER_ACCS[g.id] ?? [])]);
    return { doms, accs: new Set(ACC.filter((a) => { const c = curOf(a.id); return !c.length || c.some((h) => doms.has(h)) || gestAccs.includes(a.id); }).map((a) => a.id)) };
  }
  return { doms: new Set(u.domains.map((l) => l.domain).filter((h) => nonTech.includes(h))), accs: new Set(MANAGER_ACCS[u.id] ?? []) };
}
function snapshot(id: string, from: string, by: string) {
  const cur = curOf(id), list = (HIST[id] ??= []);
  const prev = [...list].reverse().find((p) => p.from < from);
  HIST[id] = list.filter((p) => p.from < from);
  if (prev && prev.domains.join() === cur.join()) return false;
  if (!prev && !cur.length && !list.length) return false;
  HIST[id].push({ id: String(seq++), from, domains: cur, by, at: new Date().toISOString() });
  return true;
}
function applyCurrent(id: string) { const c = [...(HIST[id] ?? [])].reverse().find((p) => p.from <= TODAY); if (c) setCur(id, c.domains); }
const forbid = (m: string) => new ApiError(403, 'forbidden', m);

export function linksMock(u: T.User, allowed: Set<string>, method: string, path: string, b: Record<string, any>): unknown {
  const cx = ctx(u, allowed);
  if (path === '/links' && method === 'GET') {
    return {
      viewer: { role: u.role, canDate: canDate(u.role), canAssign: canDate(u.role), today: TODAY },
      domains: [...cx.doms].sort().map((h) => ({ id: h, hostname: h, active: DOMAINS.find((d) => d.hostname === h)?.active ?? true })),
      accounts: ACC.filter((a) => cx.accs.has(a.id)).map((a) => {
        const h = [...(HIST[a.id] ?? [])].sort((x, y) => y.from.localeCompare(x.from));
        const cur = h.find((x) => x.from <= TODAY);
        return { ...a, since: cur && cur.from > ALWAYS ? cur.from : null, history: h.map((x) => ({ ...x, accountId: a.id })),
          domains: curOf(a.id).map((d) => ({ id: d, hostname: d, editable: cx.doms.has(d) })) };
      }),
    };
  }
  if (path === '/links/assignments' && method === 'GET') {
    if (!canDate(u.role)) throw forbid('Só Gerente, Admin ou SuperAdmin atribuem domínios e contas aos gestores.');
    const gs = USERS.filter((g) => g.role === 'gestor' && g.status !== 'disabled' && (u.role !== 'gerente' || !g.domains.length || g.domains.some((l) => cx.doms.has(l.domain))));
    return {
      gestores: gs.map((g) => { const ds = g.domains.map((l) => l.domain), as = [...(MANAGER_ACCS[g.id] ?? [])];
        return { id: g.id, name: g.name, email: g.email, domains: ds.filter((d) => cx.doms.has(d)), accounts: as.filter((a) => cx.accs.has(a)), otherDomains: ds.filter((d) => !cx.doms.has(d)).length, otherAccounts: as.filter((a) => !cx.accs.has(a)).length }; }),
      accounts: ACC.filter((a) => cx.accs.has(a.id)).map((a) => ({ id: a.id, name: a.name, provider: a.provider })),
      domains: [...cx.doms].sort().map((h) => ({ id: h, hostname: h })),
    };
  }
  let m = path.match(/^\/links\/assignments\/([^/]+)$/);
  if (m && method === 'PUT') {
    if (!canDate(u.role)) throw forbid('Só Gerente, Admin ou SuperAdmin atribuem domínios e contas aos gestores.');
    const g = USERS.find((x) => x.id === m![1]); if (!g || g.role !== 'gestor') throw new ApiError(409, 'not_gestor', 'Só Gestores recebem domínios e contas por aqui.');
    const ds: string[] | undefined = b.domainIds, as: string[] | undefined = b.accountIds;
    if (ds?.some((d) => !cx.doms.has(d)) || as?.some((a) => !cx.accs.has(a))) throw forbid('Algum item está fora do seu alcance.');
    if (ds) { g.domains = g.domains.filter((l) => !cx.doms.has(l.domain) || ds.includes(l.domain)); for (const d of ds) if (!g.domains.some((l) => l.domain === d)) g.domains.push({ domain: d, googleAccounts: [], metaAccounts: [] }); }
    if (as) { const s = (MANAGER_ACCS[g.id] ??= new Set()); for (const a of [...s]) if (cx.accs.has(a) && !as.includes(a)) s.delete(a); as.forEach((a) => s.add(a)); }
    // contas do gestor já ligadas aos domínios dele: ele passa a ver as campanhas
    const mine = MANAGER_ACCS[g.id] ?? new Set();
    g.domains = g.domains.map((l) => { const d = DOMAINS.find((x) => x.hostname === l.domain); return d ? { ...l, googleAccounts: d.googleAccounts.filter((a) => mine.has(a)), metaAccounts: d.metaAccounts.filter((a) => mine.has(a)) } : l; });
    return { ok: true };
  }
  m = path.match(/^\/links\/history\/([^/]+)$/);
  if (m) {
    if (!canDate(u.role)) throw forbid('Só Gerente, Admin ou SuperAdmin editam a data do vínculo.');
    const accId = Object.keys(HIST).find((k) => HIST[k].some((p) => p.id === m![1]));
    if (!accId || !cx.accs.has(accId)) throw new ApiError(404, 'not_found', 'Período não encontrado.');
    const p = HIST[accId].find((x) => x.id === m![1])!;
    if (method === 'PATCH') {
      if (b.from > TODAY) throw new ApiError(409, 'future_date', 'A data do vínculo não pode ser no futuro.');
      if (HIST[accId].some((x) => x !== p && x.from === b.from)) throw new ApiError(409, 'date_taken', 'Já existe uma mudança desta conta nessa data.');
      p.from = b.from; p.by = u.name; p.at = new Date().toISOString(); HIST[accId].sort((x, y) => x.from.localeCompare(y.from));
    } else HIST[accId] = HIST[accId].filter((x) => x !== p);
    applyCurrent(accId);
    return method === 'PATCH' ? { ok: true } : undefined;
  }
  m = path.match(/^\/links\/([^/]+)$/);
  if (m && method === 'PUT') {
    const id = m[1];
    if (!cx.accs.has(id)) throw forbid('Esta conta não está atribuída a você.');
    const wanted: string[] = [...new Set<string>(b.domainIds ?? [])];
    if (wanted.some((d) => !cx.doms.has(d))) throw forbid('Algum domínio da lista não está atribuído a você.');
    if (b.from && !canDate(u.role) && b.from !== TODAY) throw forbid('Só Gerente, Admin ou SuperAdmin escolhem a data do vínculo.');
    const from = canDate(u.role) && b.from ? b.from : TODAY;
    if (from > TODAY) throw new ApiError(409, 'future_date', 'A data do vínculo não pode ser no futuro.');
    const cur = curOf(id), next = [...new Set([...cur.filter((d) => !cx.doms.has(d)), ...wanted])].sort();
    setCur(id, next);
    if (u.role === 'gestor') { const p = ACC.find((a) => a.id === id)!.provider, k = key(p); u.domains = u.domains.map((l) => ({ ...l, [k]: next.includes(l.domain) ? [...new Set([...l[k], id])] : l[k].filter((x) => x !== id) })); }
    const changed = snapshot(id, from, u.name);
    return { ok: true, from, changed };
  }
  throw new ApiError(404, 'not_found', 'Rota não encontrada.');
}

/** Registro do domínio no modo demo: senha WP guardada só em memória (no servidor real ela fica criptografada). */
const WP: Record<string, string> = { 'dominioX.com': 'demo-Senha!2026' };
export function wpPasswordOf(host: string) { return WP[host] ?? null; }
export function setWpPassword(host: string, v: string | null) { if (v) WP[host] = v; else delete WP[host]; }
