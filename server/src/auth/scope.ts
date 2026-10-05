import type { Request } from 'express';
import { q } from '../db.js';
import { HttpError } from '../lib/http.js';
import { isAdminRole } from './permissions.js';

/**
 * Regra de Squad (o Postgres não faz isso sozinho aqui, então TODA consulta de métricas passa por aqui):
 * - Admin / SuperAdmin: todos os domínios ativos.
 * - Gestor: só os domínios ativos do Squad dele.
 * Devolve ids de domains para usar em `domain_id = ANY($n)`.
 */
export async function allowedDomains(req: Request): Promise<{ ids: string[]; hosts: string[] }> {
  const u = req.user!;
  const rows = isAdminRole(u.role)
    ? await q<{ id: string; hostname: string }>('SELECT id::text, hostname FROM domains WHERE active ORDER BY hostname')
    : await q<{ id: string; hostname: string }>(
      `SELECT d.id::text, d.hostname FROM squad_users su
         JOIN squad_domains sd ON sd.squad_id = su.squad_id
         JOIN domains d ON d.id = sd.domain_id AND d.active
        WHERE su.user_id = $1 ORDER BY d.hostname`, [u.id]);
  return { ids: rows.map((r) => r.id), hosts: rows.map((r) => r.hostname) };
}

/** Escopo da consulta: lista permitida, reduzida ao ?domain= se vier. 403 se o domínio estiver fora. */
export async function scope(req: Request, domain?: unknown): Promise<{ ids: string[]; hosts: string[] }> {
  const al = await allowedDomains(req);
  if (domain === undefined || domain === null || domain === '') return al;
  const host = String(domain).toLowerCase();
  const i = al.hosts.indexOf(host);
  if (i < 0) throw new HttpError(403, 'forbidden_domain', 'Você não tem acesso a este domínio.');
  return { ids: [al.ids[i]], hosts: [host] };
}
