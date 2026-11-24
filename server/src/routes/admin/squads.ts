import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { adminScope, type AdminScope } from '../../auth/scope.js';

export const squadsRouter = Router();

const body = z.object({ name: z.string().trim().min(2).max(80), domains: z.array(z.string().trim().toLowerCase()).max(500).default([]), companyId: z.string().regex(/^\d+$/).nullable().optional() });
const SQUAD_SQL = `
  SELECT s.id::text, s.name, s.company_id::text AS "companyId",
         COALESCE((SELECT array_agg(d.hostname ORDER BY d.hostname) FROM squad_domains sd JOIN domains d ON d.id = sd.domain_id WHERE sd.squad_id = s.id), '{}') AS domains,
         COALESCE((SELECT array_agg(su.user_id::text ORDER BY su.user_id) FROM squad_users su WHERE su.squad_id = s.id), '{}') AS "userIds"
    FROM squads s`;

/* 0.18.11: o Admin só vê e mexe nos Squads das Empresas em que é sócio (e só com domínios delas); SuperAdmin: todos. */
squadsRouter.get('/squads', async (req, res) => {
  const sc = await adminScope(req);
  res.json({ squads: sc ? await q(`${SQUAD_SQL} WHERE s.id = ANY($1::bigint[]) ORDER BY s.name`, [sc.squadIds]) : await q(`${SQUAD_SQL} ORDER BY s.name`) });
});
const forbid = (m: string) => new HttpError(403, 'forbidden', m);
async function checkAdmin(sc: AdminScope | null, id: string | null, b: z.infer<typeof body>) {
  if (!sc) return;
  if (id && !sc.squadIds.includes(id)) throw forbid('Este Squad não pertence a uma Empresa da qual você é sócio.');
  if (!b.companyId && (!id || b.companyId === null)) throw new HttpError(422, 'company_required', 'Escolha uma Empresa da qual você é sócio para o Squad.');
  if (b.companyId && !sc.companyIds.includes(b.companyId)) throw forbid('Você só pode pôr Squads nas Empresas em que é sócio.');
  const ids = (await q<{ id: string }>('SELECT id::text FROM domains WHERE hostname = ANY($1)', [b.domains])).map((r) => r.id);
  if (ids.some((d) => !sc.domainIds.includes(d))) throw forbid('Algum domínio da lista não pertence a uma Empresa da qual você é sócio.');
}

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

squadsRouter.post('/squads', async (req, res) => {
  const b = parse(body, req.body);
  await checkAdmin(await adminScope(req), null, b);
  res.status(201).json(await save(null, b));
});
squadsRouter.put('/squads/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id), b = parse(body, req.body);
  await checkAdmin(await adminScope(req), id, b);
  res.json(await save(id, b));
});

squadsRouter.delete('/squads/:id', async (req, res) => {
  const sid = parse(z.string().regex(/^\d+$/), req.params.id);
  if (!(await one('SELECT 1 FROM squads WHERE id = $1', [sid]))) throw notFound('Squad não encontrado.');
  const sc = await adminScope(req);
  if (sc && !sc.squadIds.includes(sid)) throw forbid('Este Squad não pertence a uma Empresa da qual você é sócio.');
  // Gerentes que viam este Squad deixam de ver; domínios ficam sem Squad (gestores continuam pelos vínculos deles)
  await q('DELETE FROM squads WHERE id = $1', [sid]); // squad_domains sai em cascata → domínios ficam sem Squad
  res.status(204).end();
});
