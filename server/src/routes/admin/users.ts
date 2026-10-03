import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { tempPassword } from '../../lib/crypto.js';
import { inviteEmail, sendMail } from '../../lib/mailer.js';
import { killSessions, loadUser, USER_SQL } from '../../auth/session.js';
import { CAPABILITIES, clearPermCache, GESTOR_ALLOWED, gestorCaps, type Capability } from '../../auth/permissions.js';

export const usersRouter = Router();

const id = z.string().regex(/^\d+$/, 'id inválido');
const role = z.enum(['gestor', 'total']);

async function squadExists(sid: string | null | undefined) {
  if (!sid) return false;
  return !!(await one('SELECT 1 FROM squads WHERE id = $1', [sid]));
}

usersRouter.get('/users', async (_req, res) => {
  const users = await q(`${USER_SQL} ORDER BY u.is_main_admin DESC, u.name`);
  res.json({ users });
});

/** Cria com senha temporária (hash argon2id) e envia o convite por e-mail. A senha nunca volta na resposta. */
usersRouter.post('/users', async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200), role, squadId: z.string().nullable().optional() }), req.body);
  if (b.role === 'gestor' && !(await squadExists(b.squadId))) throw new HttpError(422, 'squad_required', 'Gestor precisa de um Squad válido.');
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [b.email])) throw conflict('email_taken', 'Já existe um usuário com esse e-mail.');
  const pw = tempPassword();
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  const uid = await tx(async (c) => {
    const r = await one<{ id: string }>(`INSERT INTO users (name, email, password_hash, role, status, must_change_password) VALUES ($1, $2, $3, $4, 'invited', true) RETURNING id::text`, [b.name, b.email, hash, b.role], c);
    if (b.role === 'gestor') await c.query('INSERT INTO squad_users (squad_id, user_id) VALUES ($1, $2)', [b.squadId, r!.id]);
    return r!.id;
  });
  const m = inviteEmail(b.name, b.email, pw);
  const inviteSent = await sendMail(b.email, m.subject, m.html, m.text);
  res.status(201).json({ user: await loadUser(uid), inviteSent });
});

usersRouter.patch('/users/:id', async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), role: role.optional(), squadId: z.string().nullable().optional(), status: z.enum(['active', 'disabled']).optional() }), req.body);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  const self = t.id === req.user!.id;
  if (self && ((b.role && b.role !== t.role) || b.status === 'disabled')) throw conflict('self', 'Você não pode mudar a sua própria permissão ou se desativar.');
  if (t.isMainAdmin && ((b.role && b.role !== 'total') || b.status === 'disabled')) throw conflict('main_admin', 'O admin principal sempre tem Acesso Total e fica ativo.');
  if (b.status && t.status === 'invited') throw conflict('invited', 'O usuário ainda não ativou o convite.');
  const newRole = b.role ?? t.role;
  const newSquad = newRole === 'total' ? null : b.squadId !== undefined ? b.squadId : t.squadId;
  if (newRole === 'gestor' && !(await squadExists(newSquad))) throw new HttpError(422, 'squad_required', 'Gestor precisa de um Squad válido.');
  await tx(async (c) => {
    await c.query(`UPDATE users SET name = COALESCE($2, name), role = $3, status = COALESCE($4, status), updated_at = now() WHERE id = $1`, [uid, b.name ?? null, newRole, b.status ?? null]);
    await c.query('DELETE FROM squad_users WHERE user_id = $1', [uid]);
    if (newRole === 'gestor') await c.query('INSERT INTO squad_users (squad_id, user_id) VALUES ($1, $2)', [newSquad, uid]);
  });
  if (b.status === 'disabled') await killSessions(uid);
  res.json(await loadUser(uid));
});

usersRouter.delete('/users/:id', async (req, res) => {
  const uid = parse(id, req.params.id);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  if (t.isMainAdmin) throw conflict('main_admin', 'O admin principal não pode ser excluído.');
  if (t.id === req.user!.id) throw conflict('self', 'Você não pode excluir a si mesmo.');
  await q('DELETE FROM users WHERE id = $1', [uid]); // sessões e squad_users saem em cascata
  res.status(204).end();
});

/** Gera nova senha temporária e reenvia o convite (só para quem ainda não ativou). */
usersRouter.post('/users/:id/resend-invite', async (req, res) => {
  const uid = parse(id, req.params.id);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  if (t.status !== 'invited') throw conflict('not_invited', 'Esse usuário já ativou o acesso.');
  const pw = tempPassword();
  await q('UPDATE users SET password_hash = $2, must_change_password = true, updated_at = now() WHERE id = $1', [uid, await argon2.hash(pw, { type: argon2.argon2id })]);
  await killSessions(uid);
  const m = inviteEmail(t.name, t.email, pw);
  res.json({ inviteSent: await sendMail(t.email, m.subject, m.html, m.text) });
});

/* ---------------- permissões por papel ---------------- */
usersRouter.get('/permissions', async (_req, res) => {
  res.json({ capabilities: CAPABILITIES, roles: { gestor: await gestorCaps(), total: CAPABILITIES.map((c) => c.key) } });
});

/** Só módulos de visualização podem ir para o Gestor; os de administração são ignorados por segurança. */
usersRouter.put('/permissions', async (req, res) => {
  const b = parse(z.object({ gestor: z.array(z.string()).max(50) }), req.body);
  const caps = [...new Set(b.gestor)].filter((c): c is Capability => GESTOR_ALLOWED.has(c as Capability));
  await tx(async (c) => {
    await c.query(`DELETE FROM role_permissions WHERE role = 'gestor'`);
    for (const cap of caps) await c.query(`INSERT INTO role_permissions (role, capability) VALUES ('gestor', $1)`, [cap]);
  });
  clearPermCache();
  res.json({ capabilities: CAPABILITIES, roles: { gestor: await gestorCaps(), total: CAPABILITIES.map((c) => c.key) } });
});
