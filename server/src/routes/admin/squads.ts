import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, notFound, parse } from '../../lib/http.js';

export const squadsRouter = Router();

const body = z.object({ name: z.string().trim().min(2).max(80), domains: z.array(z.string().trim().toLowerCase()).max(500).default([]), companyId: z.string().regex(/^\d+$/).nullable().optional() });
const SQUAD_SQL = `
  SELECT s.id::text, s.name, s.company_id::text AS "companyId",
         COALESCE((SELECT array_agg(d.hostname ORDER BY d.hostname) FROM squad_domains sd JOIN domains d ON d.id = sd.domain_id WHERE sd.squad_id = s.id), '{}') AS domains,
         COALESCE((SELECT array_agg(su.user_id::text ORDER BY su.user_id) FROM squad_users su WHERE su.squad_id = s.id), '{}') AS "userIds"
    FROM squads s`;

squadsRouter.get('/squads', async (_req, res) => { res.json({ squads: await q(`${SQUAD_SQL} ORDER BY s.name`) }); });

/** Salva nome + domínios. Um domínio só pode estar em um Squad: se estava em outro, muda para este. */
async function save(id: string | null, b: z.infer<typeof body>) {
  return tx(async (c) => {
    if (await one('SELECT 1 FROM squads WHERE lower(name) = lower($1) AND ($2::bigint IS NULL OR id <> $2)', [b.name, id], c)) throw conflict('squad_exists', 'Já existe um Squad com esse nome.');
    const sid = id
      ? (await one<{ id: string }>('UPDATE squads SET name = $2 WHERE id = $1 RETURNING id::text', [id, b.name], c))?.id
      : (await one<{ id: string }>('INSERT INTO squads (name) VALUES ($1) RETURNING id::text', [b.name], c))!.id;
    if (sid && b.companyId !== undefined) {
      if (b.companyId && !(await one('SELECT 1 FROM companies WHERE id = $1', [b.companyId], c))) throw notFound('Empresa não encontrada.');
      await c.query('UPDATE squads SET company_id = $2 WHERE id = $1', [sid, b.companyId]);
    }
    if (!sid) throw notFound('Squad não encontrado.');
    const ids = (await q<{ id: string }>('SELECT id::text FROM domains WHERE hostname = ANY($1)', [b.domains], c)).map((r) => r.id);
    if (ids.length !== new Set(b.domains).size) throw conflict('unknown_domain', 'Algum domínio da lista não está cadastrado.');
    await c.query('DELETE FROM squad_domains WHERE squad_id = $1', [sid]);
    await c.query('DELETE FROM squad_domains WHERE domain_id = ANY($1::bigint[])', [ids]);
    for (const d of ids) await c.query('INSERT INTO squad_domains (squad_id, domain_id) VALUES ($1, $2)', [sid, d]);
    return one(`${SQUAD_SQL} WHERE s.id = $1`, [sid], c);
  });
}

squadsRouter.post('/squads', async (req, res) => { res.status(201).json(await save(null, parse(body, req.body))); });
squadsRouter.put('/squads/:id', async (req, res) => { res.json(await save(parse(z.string().regex(/^\d+$/), req.params.id), parse(body, req.body))); });

squadsRouter.delete('/squads/:id', async (req, res) => {
  const sid = parse(z.string().regex(/^\d+$/), req.params.id);
  if (!(await one('SELECT 1 FROM squads WHERE id = $1', [sid]))) throw notFound('Squad não encontrado.');
  // Gerentes que viam este Squad deixam de ver; domínios ficam sem Squad (gestores continuam pelos vínculos deles)
  await q('DELETE FROM squads WHERE id = $1', [sid]); // squad_domains sai em cascata → domínios ficam sem Squad
  res.status(204).end();
});
