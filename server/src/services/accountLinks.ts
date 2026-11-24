/**
 * 0.17 · Vínculo conta de anúncios → site com data (account_domain_history).
 *
 * Cada mudança de vínculo grava "a partir do dia X, a conta paga os sites [..]". No sync, a despesa de cada dia vai para
 * o site que a conta pagava NAQUELE dia. Caso típico: site A penalizado no Ad Manager → a conta passa para o site B em
 * 10/11 → a despesa até 09/11 fica no A e a partir de 10/11 vai para o B, mesmo quando o sync reprocessa os dias antigos
 * (antes, a campanha trocava de domínio e levava o histórico junto).
 *
 * Regra por linha de despesa (data D, site que o sync achou pelo link/campanha = "achado"):
 *   - conta sem histórico: fica o "achado" (como sempre foi);
 *   - vínculo vigente em D com UM site: vai para esse site;
 *   - vínculo vigente com vários sites: fica o "achado" se ele estiver entre eles; senão, o primeiro do vínculo;
 *   - vínculo vigente vazio (conta desligada): fica o "achado".
 * domain_accounts continua sendo o vínculo de hoje (= linha vigente), usado pelas telas e pelo fallback dos syncs.
 * 0.18.8: domain_accounts é derivado dos vínculos de Usuários & Squads (deriveAccounts); não se edita mais por Domínios,
 * Integrações nem Contas × Sites.
 */
import type { PoolClient } from 'pg';
import { one, q } from '../db.js';
import { today } from '../lib/dates.js';

export interface LinkPeriod { from: string; domains: string[] }
export type Timeline = Map<string, LinkPeriod[]>;   // conta → períodos em ordem crescente de data

export async function loadTimeline(accountIds?: string[], c?: PoolClient): Promise<Timeline> {
  const rows = await q<{ account_id: string; from: string; domains: string[] }>(
    `SELECT account_id::text, valid_from::text AS "from", domain_ids::text[] AS domains FROM account_domain_history
      ${accountIds ? 'WHERE account_id = ANY($1::bigint[])' : ''} ORDER BY account_id, valid_from`, accountIds ? [accountIds] : [], c);
  const tl: Timeline = new Map();
  for (const r of rows) tl.set(r.account_id, [...(tl.get(r.account_id) ?? []), { from: r.from, domains: r.domains ?? [] }]);
  return tl;
}

/** Sites que a conta pagava no dia (null = conta sem histórico). */
export function domainsAt(tl: Timeline, accountId: string, date: string): string[] | null {
  const list = tl.get(accountId);
  if (!list?.length) return null;
  let cur: LinkPeriod | null = null;
  for (const p of list) { if (p.from <= date) cur = p; else break; }
  return cur ? cur.domains : null;   // antes do 1º período: sem vínculo registrado → como sempre foi
}

/** Site da despesa da conta no dia, a partir do site que o sync achou (ver regra no topo). */
export function siteForDay(tl: Timeline, accountId: string, date: string, found: string | null): string | null {
  const ds = domainsAt(tl, accountId, date);
  if (!ds || !ds.length) return found;
  if (ds.length === 1) return ds[0];
  return found && ds.includes(found) ? found : ds[0];
}

/**
 * Grava o vínculo ATUAL da conta (domain_accounts) como vigente a partir de `from`.
 * Linhas com data depois de `from` saem (a mudança nova vale daí em diante). Sem linha anterior e com sites no vínculo,
 * nada antes de `from` muda (dias anteriores seguem a regra antiga, pelo link da campanha).
 */
export async function snapshotAccount(c: PoolClient, accountId: string, from: string, userId: string | null) {
  const cur = (await q<{ id: string }>('SELECT domain_id::text AS id FROM domain_accounts WHERE account_id = $1 ORDER BY domain_id', [accountId], c)).map((r) => r.id);
  const prev = await one<{ domains: string[] }>('SELECT domain_ids::text[] AS domains FROM account_domain_history WHERE account_id = $1 AND valid_from < $2 ORDER BY valid_from DESC LIMIT 1', [accountId, from], c);
  await c.query('DELETE FROM account_domain_history WHERE account_id = $1 AND valid_from > $2', [accountId, from]);
  // nada mudou em relação ao período anterior: não cria linha nova (e apaga a do mesmo dia, se houver)
  if (prev && same(prev.domains, cur)) { await c.query('DELETE FROM account_domain_history WHERE account_id = $1 AND valid_from = $2', [accountId, from]); return false; }
  // conta sem histórico e sem site: não há o que registrar
  if (!prev && !cur.length && !(await one('SELECT 1 FROM account_domain_history WHERE account_id = $1', [accountId], c))) return false;
  await c.query(`INSERT INTO account_domain_history (account_id, valid_from, domain_ids, created_by) VALUES ($1, $2, $3::bigint[], $4)
                 ON CONFLICT (account_id, valid_from) DO UPDATE SET domain_ids = EXCLUDED.domain_ids, created_by = EXCLUDED.created_by, created_at = now()`,
    [accountId, from, cur, userId]);
  return true;
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** Depois de editar/excluir períodos: domain_accounts volta a ser o período vigente hoje. */
export async function applyCurrent(c: PoolClient, accountId: string) {
  const cur = await one<{ domains: string[] }>('SELECT domain_ids::text[] AS domains FROM account_domain_history WHERE account_id = $1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1', [accountId, today()], c);
  if (!cur) return;
  await c.query('DELETE FROM domain_accounts WHERE account_id = $1', [accountId]);
  for (const d of cur.domains) await c.query('INSERT INTO domain_accounts (domain_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d, accountId]);
}

/**
 * 0.18.8 · Vínculos só em Usuários & Squads: domain_accounts da conta = domínios em que algum gestor a usa
 * (domain_manager_accounts). Grava o histórico a partir de `from` (padrão hoje) quando muda. Devolve as contas que mudaram.
 */
export async function deriveAccounts(c: PoolClient, accountIds: string[], userId: string | null, from: string = today()): Promise<string[]> {
  const changed: string[] = [];
  for (const a of [...new Set(accountIds)]) {
    const acc = await one<{ provider: string }>('SELECT provider FROM integration_accounts WHERE id = $1', [a], c);
    if (!acc || (acc.provider !== 'google-ads' && acc.provider !== 'meta')) continue;
    const want = (await q<{ id: string }>(`SELECT DISTINCT x.domain_id::text AS id FROM domain_manager_accounts x JOIN domains d ON d.id = x.domain_id AND NOT d.is_technical
                                           WHERE x.account_id = $1 ORDER BY 1`, [a], c)).map((r) => r.id);
    const cur = (await q<{ id: string }>('SELECT domain_id::text AS id FROM domain_accounts WHERE account_id = $1', [a], c)).map((r) => r.id);
    if (same(want, cur)) continue;
    await c.query('DELETE FROM domain_accounts WHERE account_id = $1', [a]);
    for (const d of want) await c.query('INSERT INTO domain_accounts (domain_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d, a]);
    await snapshotAccount(c, a, from, userId);
    changed.push(a);
  }
  return changed;
}

/** Contas Google/Meta afetadas por uma lista de ids (para disparar o sync certo). */
export async function providersOf(accountIds: string[]): Promise<Set<'google-ads' | 'meta'>> {
  if (!accountIds.length) return new Set();
  return new Set((await q<{ provider: 'google-ads' | 'meta' }>(`SELECT DISTINCT provider FROM integration_accounts WHERE id = ANY($1::bigint[]) AND provider IN ('google-ads', 'meta')`, [accountIds])).map((r) => r.provider));
}
