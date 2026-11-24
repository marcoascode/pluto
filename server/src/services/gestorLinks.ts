/**
 * 0.18.9 · Vínculo gestor × domínio × contas (Usuários & Squads). Usado pelo Admin (/admin/users) e pelo Gerente
 * (/team, só nos domínios e contas do alcance dele).
 *
 * - domain_managers / domain_manager_accounts: o gestor e as contas que ele usa em cada domínio;
 * - manager_accounts: contas do gestor (todas as que ele usa em algum domínio);
 * - domain_accounts: derivado (deriveAccounts) → site em que o sync põe a despesa da conta;
 * - share_pct (rateio do domínio): mantido para quem continua; zerado no domínio em que entrou ou saiu gestor.
 */
import type { PoolClient } from 'pg';
import { one, q } from '../db.js';
import { conflict, HttpError, notFound } from '../lib/http.js';
import { deriveAccounts, providersOf } from './accountLinks.js';
import { requestRun } from './sync/index.js';

export interface DomainLinkIn { domain: string; googleAccounts: string[]; metaAccounts: string[] }
/** Alcance de quem edita (Gerente). Sem alcance = Admin (tudo). */
export interface LinkScope { domainIds: Set<string>; accountIds: Set<string> }

export const accountsOf = async (c: PoolClient, uid: string) =>
  (await q<{ id: string }>('SELECT DISTINCT account_id::text AS id FROM domain_manager_accounts WHERE user_id = $1', [uid], c)).map((r) => r.id);

/** Grava os domínios/contas do gestor. Devolve as contas cujo site mudou (ressincronizar depois do commit). */
export async function saveGestorLinks(c: PoolClient, uid: string, links: DomainLinkIn[], actor: string | null, scope?: LinkScope): Promise<string[]> {
  const before = await accountsOf(c, uid);
  const old = await q<{ domain_id: string; share: number | null }>('SELECT domain_id::text, share_pct::float AS share FROM domain_managers WHERE user_id = $1', [uid], c);
  const editable = (d: string) => !scope || scope.domainIds.has(d);
  // o que está fora do alcance de quem edita fica como está
  await c.query('DELETE FROM domain_managers WHERE user_id = $1 AND domain_id = ANY($2::bigint[])', [uid, old.map((o) => o.domain_id).filter(editable)]);   // contas saem em cascata
  const seen = new Set<string>();
  const now: string[] = old.map((o) => o.domain_id).filter((d) => !editable(d));
  for (const l of links) {
    if (seen.has(l.domain)) throw conflict('duplicate_domain', `O domínio ${l.domain} está repetido.`);
    seen.add(l.domain);
    const d = await one<{ id: string; technical: boolean }>('SELECT id::text, is_technical AS technical FROM domains WHERE hostname = $1', [l.domain], c);
    if (!d) throw notFound(`Domínio ${l.domain} não cadastrado.`);
    if (d.technical) throw conflict('technical_domain', '"Sem domínio" não recebe gestor.');
    if (!editable(d.id)) {
      if (now.includes(d.id)) continue;   // já é dele e está fora do alcance: fica como está
      throw new HttpError(403, 'forbidden', `O domínio ${l.domain} está fora do seu alcance.`);
    }
    const prev = old.find((o) => o.domain_id === d.id);
    await c.query('INSERT INTO domain_managers (domain_id, user_id, share_pct) VALUES ($1, $2, $3)', [d.id, uid, prev?.share ?? null]);
    now.push(d.id);
    for (const [prov, list] of [['google-ads', l.googleAccounts], ['meta', l.metaAccounts]] as const) {
      const acc = [...new Set(list)];
      if (!acc.length) continue;
      const ok = await q<{ id: string }>('SELECT id::text FROM integration_accounts WHERE provider = $1 AND id = ANY($2::bigint[])', [prov, acc], c);
      if (ok.length !== acc.length) throw conflict('unknown_account', 'Alguma conta da lista não existe.');
      if (scope && acc.some((a) => !scope.accountIds.has(a))) throw new HttpError(403, 'forbidden', 'Alguma conta está fora do seu alcance.');
      for (const a of acc) await c.query('INSERT INTO domain_manager_accounts (domain_id, user_id, account_id) VALUES ($1, $2, $3)', [d.id, uid, a]);
    }
  }
  // entrou ou saiu gestor do domínio: o rateio daquele domínio volta para "dividido igualmente" até o Admin definir de novo
  const was = old.map((o) => o.domain_id);
  const changed = [...was.filter((d) => !now.includes(d)), ...now.filter((d) => !was.includes(d))];
  if (changed.length) await c.query('UPDATE domain_managers SET share_pct = NULL WHERE domain_id = ANY($1::bigint[])', [changed]);
  // contas atribuídas ao gestor (wizard Meta, Contas × Sites) = as que ele usa em algum domínio
  const after = await accountsOf(c, uid);
  await c.query('DELETE FROM manager_accounts WHERE user_id = $1 AND NOT (account_id = ANY($2::bigint[]))', [uid, after]);
  for (const a of after) await c.query('INSERT INTO manager_accounts (user_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, a]);
  return deriveAccounts(c, [...before, ...after], actor);
}

/** Tira o gestor de todos os domínios (mudou de papel / excluído). */
export async function clearGestorLinks(c: PoolClient, uid: string, actor: string | null) {
  const acc = await accountsOf(c, uid);
  const doms = (await q<{ id: string }>('SELECT domain_id::text AS id FROM domain_managers WHERE user_id = $1', [uid], c)).map((r) => r.id);
  await c.query('DELETE FROM domain_managers WHERE user_id = $1', [uid]);
  if (doms.length) await c.query('UPDATE domain_managers SET share_pct = NULL WHERE domain_id = ANY($1::bigint[])', [doms]);
  await c.query('DELETE FROM manager_accounts WHERE user_id = $1', [uid]);
  return deriveAccounts(c, acc, actor);
}

/** Depois do commit: ressincroniza a despesa das plataformas das contas que mudaram de site. */
export async function resyncAccounts(accountIds: string[]) {
  if (!accountIds.length) return;
  for (const p of await providersOf(accountIds)) { requestRun(p === 'meta' ? 'meta.metrics' : 'google-ads.metrics'); if (p === 'google-ads') requestRun('google-ads.placements'); }
}
