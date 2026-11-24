import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { adminScope } from '../../auth/scope.js';
import { requireSuperAdmin } from '../../auth/session.js';

/**
 * Empresas (sociedades): nome + sócios (usuários) + Squads. Ex.: "Empresa do Lucas" com Lucas e Fabricio.
 * Sócio vê todos os Squads e domínios da Empresa. Um Squad pertence a uma Empresa só.
 */
export const companiesRouter = Router();

const ids = z.array(z.string().regex(/^\d+$/)).max(500);
const body = z.object({ name: z.string().trim().min(2).max(80), partnerIds: ids.default([]), squadIds: ids.default([]) });
export const COMPANY_SQL = `
  SELECT c.id::text, c.name,
         COALESCE((SELECT array_agg(cu.user_id::text ORDER BY cu.user_id) FROM company_users cu WHERE cu.company_id = c.id), '{}') AS "partnerIds",
         COALESCE((SELECT array_agg(s.id::text ORDER BY s.name) FROM squads s WHERE s.company_id = c.id), '{}') AS "squadIds"
    FROM companies c`;

/* 0.18.11: o Admin só vê e edita as Empresas em que é sócio (Squads só dessas Empresas; não sai da
   própria sociedade). Criar e excluir Empresa: só SuperAdmin. */
companiesRouter.get('/companies', async (req, res) => {
  const sc = await adminScope(req);
  res.json({ companies: sc ? await q(`${COMPANY_SQL} WHERE c.id = ANY($1::bigint[]) ORDER BY c.name`, [sc.companyIds]) : await q(`${COMPANY_SQL} ORDER BY c.name`) });
});

async function save(id: string | null, b: z.infer<typeof body>) {
  return tx(async (c) => {
    if (await one('SELECT 1 FROM companies WHERE lower(name) = lower($1) AND ($2::bigint IS NULL OR id <> $2)', [b.name, id], c)) throw conflict('company_exists', 'Já existe uma Empresa com esse nome.');
    const cid = id
      ? (await one<{ id: string }>('UPDATE companies SET name = $2 WHERE id = $1 RETURNING id::text', [id, b.name], c))?.id
      : (await one<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id::text', [b.name], c))!.id;
    if (!cid) throw notFound('Empresa não encontrada.');
    const partners = [...new Set(b.partnerIds)], squads = [...new Set(b.squadIds)];
    if ((await q('SELECT 1 FROM users WHERE id = ANY($1::bigint[])', [partners], c)).length !== partners.length) throw notFound('Algum sócio não existe.');
    if ((await q('SELECT 1 FROM squads WHERE id = ANY($1::bigint[])', [squads], c)).length !== squads.length) throw notFound('Algum Squad não existe.');
    await c.query('DELETE FROM company_users WHERE company_id = $1', [cid]);
    for (const u of partners) await c.query('INSERT INTO company_users (company_id, user_id) VALUES ($1, $2)', [cid, u]);
    // Squads: os da lista passam para esta Empresa; os que saíram da lista ficam sem Empresa
    await c.query('UPDATE squads SET company_id = NULL WHERE company_id = $1 AND NOT (id = ANY($2::bigint[]))', [cid, squads]);
    await c.query('UPDATE squads SET company_id = $1 WHERE id = ANY($2::bigint[])', [cid, squads]);
    return one(`${COMPANY_SQL} WHERE c.id = $1`, [cid], c);
  });
}
companiesRouter.post('/companies', requireSuperAdmin, async (req, res) => { res.status(201).json(await save(null, parse(body, req.body))); });
companiesRouter.put('/companies/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id), b = parse(body, req.body);
  const sc = await adminScope(req);
  if (sc) {
    if (!sc.companyIds.includes(id)) throw new HttpError(403, 'forbidden_company', 'Você só edita as Empresas em que é sócio.');
    if (!b.partnerIds.includes(req.user!.id)) throw conflict('self_partner', 'Você não pode se tirar da sociedade (perderia o acesso à Empresa). Peça a um SuperAdmin.');
    const free = (await q<{ id: string }>('SELECT id::text FROM squads WHERE id = ANY($1::bigint[]) AND company_id = ANY($2::bigint[])', [b.squadIds, sc.companyIds])).map((r) => r.id);
    if (free.length !== new Set(b.squadIds).size) throw new HttpError(403, 'forbidden_squad', 'Algum Squad pertence a uma Empresa da qual você não é sócio.');
  }
  res.json(await save(id, b));
});
companiesRouter.delete('/companies/:id', requireSuperAdmin, async (req, res) => {
  const r = await q('DELETE FROM companies WHERE id = $1 RETURNING id', [parse(z.string().regex(/^\d+$/), req.params.id)]);   // Squads ficam sem Empresa
  if (!r.length) throw notFound('Empresa não encontrada.');
  res.status(204).end();
});
