import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, notFound, parse } from '../../lib/http.js';

export const domainsRouter = Router();

const HOST = z.string().trim().toLowerCase().transform((v) => v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'domínio inválido').max(190));

const DOMAIN_SQL = `
  SELECT d.hostname, d.active, sd.squad_id::text AS "squadId", d.last_data_at AS "lastDataAt",
         COALESCE(array_agg(a.id::text ORDER BY a.name) FILTER (WHERE a.provider = 'google-ads'), '{}') AS "googleAccounts",
         COALESCE(array_agg(a.id::text ORDER BY a.name) FILTER (WHERE a.provider = 'meta'), '{}') AS "metaAccounts"
    FROM domains d
    LEFT JOIN squad_domains sd ON sd.domain_id = d.id
    LEFT JOIN domain_accounts da ON da.domain_id = d.id
    LEFT JOIN integration_accounts a ON a.id = da.account_id`;
const GROUP = ' GROUP BY d.id, sd.squad_id';
const get = (host: string) => one(`${DOMAIN_SQL} WHERE d.hostname = $1${GROUP}`, [host]);

domainsRouter.get('/domains', async (_req, res) => { res.json({ domains: await q(`${DOMAIN_SQL}${GROUP} ORDER BY d.active DESC, d.hostname`) }); });

domainsRouter.post('/domains', async (req, res) => {
  const b = parse(z.object({ hostname: HOST }), req.body);
  if (await one('SELECT 1 FROM domains WHERE hostname = $1', [b.hostname])) throw conflict('domain_exists', 'Esse domínio já está cadastrado.');
  await q('INSERT INTO domains (hostname) VALUES ($1)', [b.hostname]);
  res.status(201).json(await get(b.hostname));
});

domainsRouter.patch('/domains/:hostname', async (req, res) => {
  const host = parse(HOST, req.params.hostname);
  const b = parse(z.object({
    hostname: HOST.optional(), active: z.boolean().optional(), squadId: z.string().regex(/^\d+$/).nullable().optional(),
    googleAccounts: z.array(z.string().regex(/^\d+$/)).max(200).optional(), metaAccounts: z.array(z.string().regex(/^\d+$/)).max(200).optional(),
  }), req.body);
  const d = await one<{ id: string }>('SELECT id::text FROM domains WHERE hostname = $1', [host]);
  if (!d) throw notFound('Domínio não encontrado.');
  await tx(async (c) => {
    if (b.hostname && b.hostname !== host) {
      if (await one('SELECT 1 FROM domains WHERE hostname = $1', [b.hostname], c)) throw conflict('domain_exists', 'Já existe um domínio com esse nome.');
      await c.query('UPDATE domains SET hostname = $2 WHERE id = $1', [d.id, b.hostname]);
    }
    if (b.active !== undefined) await c.query('UPDATE domains SET active = $2 WHERE id = $1', [d.id, b.active]);
    if (b.squadId !== undefined) {
      await c.query('DELETE FROM squad_domains WHERE domain_id = $1', [d.id]);
      if (b.squadId) {
        if (!(await one('SELECT 1 FROM squads WHERE id = $1', [b.squadId], c))) throw notFound('Squad não encontrado.');
        await c.query('INSERT INTO squad_domains (squad_id, domain_id) VALUES ($1, $2)', [b.squadId, d.id]);
      }
    }
    for (const [prov, list] of [['google-ads', b.googleAccounts], ['meta', b.metaAccounts]] as const) {
      if (!list) continue;
      const ok = await q<{ id: string }>('SELECT id::text FROM integration_accounts WHERE provider = $1 AND id = ANY($2::bigint[])', [prov, list], c);
      if (ok.length !== new Set(list).size) throw conflict('unknown_account', 'Alguma conta da lista não existe.');
      await c.query('DELETE FROM domain_accounts da USING integration_accounts a WHERE da.account_id = a.id AND a.provider = $2 AND da.domain_id = $1', [d.id, prov]);
      for (const a of ok) await c.query('INSERT INTO domain_accounts (domain_id, account_id) VALUES ($1, $2)', [d.id, a.id]);
    }
  });
  res.json(await get(b.hostname ?? host));
});

/** Só exclui domínio sem histórico. Com dados, a saída é desativar. */
domainsRouter.delete('/domains/:hostname', async (req, res) => {
  const host = parse(HOST, req.params.hostname);
  const d = await one<{ id: string }>('SELECT id::text FROM domains WHERE hostname = $1', [host]);
  if (!d) throw notFound('Domínio não encontrado.');
  if (await one('SELECT 1 FROM daily_metrics WHERE domain_id = $1 LIMIT 1', [d.id])) throw conflict('domain_has_data', 'Este domínio tem dados históricos. Desative em vez de excluir.');
  await q('DELETE FROM domains WHERE id = $1', [d.id]);
  res.status(204).end();
});
