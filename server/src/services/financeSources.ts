/**
 * Finance ← sites (domínios) que já existem no dash, para escolher o site no Caixa, nos Custos e nos vínculos de gestor.
 * domains(hostname, is_technical) → Empresa pelo Squad (squad_domains → squads.company_id). O domínio técnico "sem-dominio" fica de fora.
 * Se a consulta falhar, o Finance continua funcionando (o site pode ser digitado à mão).
 */
import type { QueryResultRow } from 'pg';
import { q } from '../db.js';

/** revshare = % vigente do domínio (Admin → Domínios), para sugerir o desconto na receita; null = sem cadastro (usa 7,5%) */
export interface SiteRow { site: string; companyId: string; revshare?: number | null }

/** hostname normalizado: minúsculas, sem protocolo, sem www., sem caminho. */
export const normSite = (s: string | null | undefined) => {
  if (!s) return null;
  const h = s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9.-]+$/.test(h) && h.includes('.') ? h : null;
};

const SQL_SITES = `
  SELECT d.hostname AS site, sq.company_id::text AS "companyId",
         (SELECT (r.rev_share * 100)::float FROM domain_rev_shares r WHERE r.domain_id = d.id AND r.valid_from <= current_date ORDER BY r.valid_from DESC LIMIT 1) AS revshare
    FROM domains d
    JOIN squad_domains sd ON sd.domain_id = d.id
    JOIN squads sq ON sq.id = sd.squad_id
   WHERE sq.company_id = ANY($1::bigint[]) AND NOT d.is_technical
   ORDER BY 1`;

async function safe<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[]; error: string | null }> {
  try { return { rows: await q<T>(sql, params), error: null }; }
  catch (e) { return { rows: [], error: `Lista de sites indisponível: ${(e as Error).message}` }; }
}

export async function listSites(companyIds: string[]) {
  const r = await safe<SiteRow>(SQL_SITES, [companyIds]);
  return { ...r, rows: r.rows.map((x) => ({ ...x, site: normSite(x.site)! })).filter((x) => x.site) };
}
