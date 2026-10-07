import type { Request } from 'express';
import { q } from '../db.js';
import { HttpError } from '../lib/http.js';
import { isAdminRole } from './permissions.js';

/**
 * Quem vê o quê (TODA consulta de métricas passa por aqui):
 * - Admin / SuperAdmin: todos os domínios ativos.
 * - Sócio de uma Empresa (qualquer papel): todos os domínios dos Squads da Empresa, completos.
 * - Gerente: todos os domínios dos Squads dados a ele (vários), completos.
 * - Gestor: os domínios que ele gere (domain_managers), mas só as campanhas das contas Google/Meta ligadas a
 *   ele naquele domínio. A receita não atribuída do domínio só entra quando ele é o único gestor do domínio
 *   (com mais de um, não dá para saber de quem é — fica para Admin/Gerente).
 * ?company=<id> reduz tudo aos domínios daquela Empresa (seletor "Empresa" do topo). Empresa fora do alcance → 403.
 */
export interface RowFilter {
  fullDomainIds: string[];   // domínios vistos por inteiro
  campaignIds: string[];     // campanhas liberadas nos domínios restritos
  soloDomainIds: string[];   // domínios restritos em que o gestor é o único → vê a receita não atribuída
}
export interface Scope { ids: string[]; hosts: string[]; filter: RowFilter | null }

type Dom = { id: string; hostname: string };
const DOMS = (where: string) => `SELECT DISTINCT d.id::text, d.hostname FROM domains d ${where} AND d.active ORDER BY d.hostname`;

/** Empresas que o usuário enxerga (ids). Admin: todas. */
export async function visibleCompanyIds(req: Request): Promise<string[]> {
  const u = req.user!;
  if (isAdminRole(u.role)) return (await q<{ id: string }>('SELECT id::text FROM companies ORDER BY name')).map((r) => r.id);
  return (await q<{ id: string }>(`
    SELECT c.id::text FROM companies c WHERE
      EXISTS (SELECT 1 FROM company_users cu WHERE cu.company_id = c.id AND cu.user_id = $1)
      OR EXISTS (SELECT 1 FROM squads s JOIN squad_users su ON su.squad_id = s.id WHERE s.company_id = c.id AND su.user_id = $1)
      OR EXISTS (SELECT 1 FROM squads s JOIN squad_domains sd ON sd.squad_id = s.id JOIN domain_managers dm ON dm.domain_id = sd.domain_id WHERE s.company_id = c.id AND dm.user_id = $1)
    ORDER BY c.name`, [u.id])).map((r) => r.id);
}

async function compute(req: Request, companyParam: unknown = req.query.company): Promise<Scope> {
  const u = req.user!;
  let full: Dom[] = [], restricted: Dom[] = [];
  let filter: RowFilter | null = null;
  if (isAdminRole(u.role)) full = await q<Dom>(DOMS('WHERE true'));
  else {
    // sócio: Empresa inteira · Gerente: Squads dele (Gestor não ganha domínio pelo Squad, só pelo vínculo de gestor)
    full = await q<Dom>(DOMS(`JOIN squad_domains sd ON sd.domain_id = d.id JOIN squads s ON s.id = sd.squad_id
      WHERE (s.company_id IN (SELECT company_id FROM company_users WHERE user_id = $1)
             OR ($2 = 'gerente' AND s.id IN (SELECT squad_id FROM squad_users WHERE user_id = $1)))`), [u.id, u.role]);
    const fullIds = new Set(full.map((d) => d.id));
    restricted = (await q<Dom>(DOMS('JOIN domain_managers dm ON dm.domain_id = d.id WHERE dm.user_id = $1'), [u.id])).filter((d) => !fullIds.has(d.id));
    if (restricted.length) {
      const rid = restricted.map((d) => d.id);
      const [camps, solo] = await Promise.all([
        q<{ id: string }>(`SELECT c.id::text FROM campaigns c JOIN domain_manager_accounts x ON x.account_id = c.account_id AND x.domain_id = c.domain_id
                            WHERE x.user_id = $1 AND c.domain_id = ANY($2::bigint[])`, [u.id, rid]),
        q<{ id: string }>(`SELECT domain_id::text AS id FROM domain_managers WHERE domain_id = ANY($1::bigint[]) GROUP BY domain_id HAVING count(*) = 1`, [rid]),
      ]);
      filter = { fullDomainIds: [...fullIds], campaignIds: camps.map((r) => r.id), soloDomainIds: solo.map((r) => r.id) };
    }
  }
  let all = [...full, ...restricted].sort((a, b) => a.hostname.localeCompare(b.hostname));
  // seletor "Empresa" do topo
  const company = companyParam;
  if (typeof company === 'string' && company) {
    if (!/^\d+$/.test(company) || !(await visibleCompanyIds(req)).includes(company)) throw new HttpError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
    const inCo = new Set((await q<{ id: string }>('SELECT sd.domain_id::text AS id FROM squad_domains sd JOIN squads s ON s.id = sd.squad_id WHERE s.company_id = $1', [company])).map((r) => r.id));
    all = all.filter((d) => inCo.has(d.id));
  }
  return { ids: all.map((d) => d.id), hosts: all.map((d) => d.hostname), filter };
}

/** Domínios que o usuário pode ver (já reduzidos pela Empresa escolhida). Calculado uma vez por requisição. */
export async function allowedDomains(req: Request): Promise<Scope> {
  const r = req as Request & { _scope?: Promise<Scope> };
  r._scope ??= compute(req);
  return r._scope;
}

/** Escopo de uma Empresa específica (tela da Empresa), ignorando o ?company= da URL. */
export async function companyScope(req: Request, companyId: string): Promise<Scope> {
  return compute(req, companyId);
}
/** Sem o filtro de Empresa (seletor do topo precisa da lista inteira). */
export async function scopeWithoutCompany(req: Request): Promise<Scope> {
  return compute(req, '');
}

/** Escopo da consulta: lista permitida, reduzida ao ?domain= se vier. 403 se o domínio estiver fora. */
export async function scope(req: Request, domain?: unknown): Promise<Scope> {
  const al = await allowedDomains(req);
  if (domain === undefined || domain === null || domain === '') return al;
  const host = String(domain).toLowerCase();
  const i = al.hosts.indexOf(host);
  if (i < 0) throw new HttpError(403, 'forbidden_domain', 'Você não tem acesso a este domínio.');
  return { ids: [al.ids[i]], hosts: [host], filter: al.filter };
}

/** A campanha está liberada para este escopo? (lista de campanhas, gavetas, placements) */
export function canSeeCampaign(sc: Scope, campaignId: string, domainId: string | null) {
  if (!sc.filter) return true;
  return (!!domainId && sc.filter.fullDomainIds.includes(domainId)) || sc.filter.campaignIds.includes(campaignId);
}

/** Condição SQL do filtro de linhas (alias m), com placeholders a partir de $start. */
export function rowFilterSql(f: RowFilter | null, start: number): { sql: string; params: unknown[] } {
  if (!f) return { sql: '', params: [] };
  return {
    sql: `AND (m.domain_id = ANY($${start}::bigint[]) OR m.campaign_id = ANY($${start + 1}::bigint[]) OR (m.platform = 'none' AND m.domain_id = ANY($${start + 2}::bigint[])))`,
    params: [f.fullDomainIds, f.campaignIds, f.soloDomainIds],
  };
}
