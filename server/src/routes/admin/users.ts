import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { today } from '../../lib/dates.js';
import { snapshotAccount } from '../../services/accountLinks.js';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { tempPassword } from '../../lib/crypto.js';
import { inviteEmail, sendMail } from '../../lib/mailer.js';
import { killSessions, loadUser, USER_SQL, type SessionUser } from '../../auth/session.js';
import { CAPABILITIES, clearPermCache, GESTOR_ALLOWED, rolesMatrix, type Capability } from '../../auth/permissions.js';

export const usersRouter = Router();

/* Admin e SuperAdmin chegam aqui (requireAdmin). As regras de SuperAdmin estão em guardSuper(). */

const id = z.string().regex(/^\d+$/, 'id inválido');
const role = z.enum(['gestor', 'gerente', 'admin', 'superadmin']);
const ids = z.array(z.string().regex(/^\d+$/)).max(200);
/** Gestor: domínio + contas Google Ads + contas Meta Ads que ele usa nesse domínio. */
const domainLink = z.object({ domain: z.string().trim().toLowerCase().min(3).max(190), googleAccounts: ids.default([]), metaAccounts: ids.default([]) });
const links = { squadIds: ids.optional(), companyIds: ids.optional(), domains: z.array(domainLink).max(300).optional() };

/** Só o SuperAdmin cria, edita, exclui ou promove alguém a SuperAdmin. */
function guardSuper(actor: SessionUser, target: { role: string } | null, newRole?: string) {
  if (actor.role === 'superadmin') return;
  if (target?.role === 'superadmin') throw new HttpError(403, 'superadmin_only', 'Só um SuperAdmin pode alterar outro SuperAdmin.');
  if (newRole === 'superadmin') throw new HttpError(403, 'superadmin_only', 'Só um SuperAdmin pode dar a permissão SuperAdmin.');
}

type C = Parameters<Parameters<typeof tx>[0]>[0];
/**
 * Vínculos do usuário (substitui os que existiam quando o campo vem):
 * - squadIds: só Gerente (vê esses Squads inteiros). Outros papéis ficam sem Squad.
 * - companyIds: Empresas em que é sócio (qualquer papel) — sócio vê a Empresa inteira.
 * - domains: só Gestor — domínio + contas que ele usa ali. As contas entram também na lista de contas do domínio.
 */
async function saveLinks(c: C, uid: string, newRole: string, b: { squadIds?: string[]; companyIds?: string[]; domains?: z.infer<typeof domainLink>[] }, roleChanged: boolean) {
  if (b.squadIds !== undefined || roleChanged) {
    await c.query('DELETE FROM squad_users WHERE user_id = $1', [uid]);
    const sq = newRole === 'gerente' ? [...new Set(b.squadIds ?? [])] : [];
    if (sq.length) {
      const ok = await q<{ id: string }>('SELECT id::text FROM squads WHERE id = ANY($1::bigint[])', [sq], c);
      if (ok.length !== sq.length) throw notFound('Algum Squad da lista não existe.');
      for (const s of sq) await c.query('INSERT INTO squad_users (squad_id, user_id) VALUES ($1, $2)', [s, uid]);
    }
  }
  if (b.companyIds !== undefined) {
    const co = [...new Set(b.companyIds)];
    const ok = await q<{ id: string }>('SELECT id::text FROM companies WHERE id = ANY($1::bigint[])', [co], c);
    if (ok.length !== co.length) throw notFound('Alguma Empresa da lista não existe.');
    await c.query('DELETE FROM company_users WHERE user_id = $1', [uid]);
    for (const x of co) await c.query('INSERT INTO company_users (company_id, user_id) VALUES ($1, $2)', [x, uid]);
  }
  if (b.domains !== undefined || roleChanged) {
    await c.query('DELETE FROM domain_managers WHERE user_id = $1', [uid]);   // contas saem em cascata
    if (newRole !== 'gestor') return;
    const seen = new Set<string>();
    for (const l of b.domains ?? []) {
      if (seen.has(l.domain)) throw conflict('duplicate_domain', `O domínio ${l.domain} está repetido.`);
      seen.add(l.domain);
      const d = await one<{ id: string }>('SELECT id::text FROM domains WHERE hostname = $1', [l.domain], c);
      if (!d) throw notFound(`Domínio ${l.domain} não cadastrado.`);
      await c.query('INSERT INTO domain_managers (domain_id, user_id) VALUES ($1, $2)', [d.id, uid]);
      for (const [prov, list] of [['google-ads', l.googleAccounts], ['meta', l.metaAccounts]] as const) {
        const acc = [...new Set(list)];
        if (!acc.length) continue;
        const ok = await q<{ id: string }>('SELECT id::text FROM integration_accounts WHERE provider = $1 AND id = ANY($2::bigint[])', [prov, acc], c);
        if (ok.length !== acc.length) throw conflict('unknown_account', 'Alguma conta da lista não existe.');
        for (const a of acc) {
          await c.query('INSERT INTO domain_manager_accounts (domain_id, user_id, account_id) VALUES ($1, $2, $3)', [d.id, uid, a]);
          await c.query('INSERT INTO manager_accounts (user_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, a]);   // 0.17
          const r = await c.query('INSERT INTO domain_accounts (domain_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d.id, a]);
          if (r.rowCount) await snapshotAccount(c, a, today(), null);   // 0.17: vínculo novo vale a partir de hoje
        }
      }
    }
  }
}

usersRouter.get('/users', async (_req, res) => {
  const users = await q(`${USER_SQL} ORDER BY u.is_main_admin DESC, u.name`);
  res.json({ users });
});

/** Cria com senha temporária (hash argon2id) e envia o convite por e-mail. A senha nunca volta na resposta. */
usersRouter.post('/users', async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200), role, ...links }), req.body);
  guardSuper(req.user!, null, b.role);
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [b.email])) throw conflict('email_taken', 'Já existe um usuário com esse e-mail.');
  const pw = tempPassword();
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  const uid = await tx(async (c) => {
    const r = await one<{ id: string }>(`INSERT INTO users (name, email, password_hash, role, status, must_change_password) VALUES ($1, $2, $3, $4, 'invited', true) RETURNING id::text`, [b.name, b.email, hash, b.role], c);
    await saveLinks(c, r!.id, b.role, b, false);
    return r!.id;
  });
  const m = inviteEmail(b.name, b.email, pw);
  const inviteSent = await sendMail(b.email, m.subject, m.html, m.text);
  res.status(201).json({ user: await loadUser(uid), inviteSent });
});

usersRouter.patch('/users/:id', async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), role: role.optional(), status: z.enum(['active', 'disabled']).optional(), ...links }), req.body);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  guardSuper(req.user!, t, b.role);
  const self = t.id === req.user!.id;
  if (self && ((b.role && b.role !== t.role) || b.status === 'disabled')) throw conflict('self', 'Você não pode mudar a sua própria permissão ou se desativar.');
  if (t.isMainAdmin && ((b.role && b.role !== 'superadmin') || b.status === 'disabled')) throw conflict('main_admin', 'O admin principal é sempre SuperAdmin e fica ativo.');
  if (b.status && t.status === 'invited') throw conflict('invited', 'O usuário ainda não ativou o convite.');
  const newRole = b.role ?? t.role;
  await tx(async (c) => {
    await c.query(`UPDATE users SET name = COALESCE($2, name), role = $3, status = COALESCE($4, status), updated_at = now() WHERE id = $1`, [uid, b.name ?? null, newRole, b.status ?? null]);
    await saveLinks(c, uid, newRole, b, newRole !== t.role);
  });
  if (b.status === 'disabled') await killSessions(uid);
  res.json(await loadUser(uid));
});

usersRouter.delete('/users/:id', async (req, res) => {
  const uid = parse(id, req.params.id);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  guardSuper(req.user!, t);
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
  guardSuper(req.user!, t);
  if (t.status !== 'invited') throw conflict('not_invited', 'Esse usuário já ativou o acesso.');
  const pw = tempPassword();
  await q('UPDATE users SET password_hash = $2, must_change_password = true, updated_at = now() WHERE id = $1', [uid, await argon2.hash(pw, { type: argon2.argon2id })]);
  await killSessions(uid);
  const m = inviteEmail(t.name, t.email, pw);
  res.json({ inviteSent: await sendMail(t.email, m.subject, m.html, m.text) });
});

/* ---------------- permissões por papel ---------------- */
usersRouter.get('/permissions', async (_req, res) => {
  res.json({ capabilities: CAPABILITIES, roles: await rolesMatrix() });
});

/** Só módulos de visualização podem ir para Gestor e Gerente; os de administração são ignorados por segurança. */
usersRouter.put('/permissions', async (req, res) => {
  const b = parse(z.object({ gestor: z.array(z.string()).max(50).optional(), gerente: z.array(z.string()).max(50).optional() }), req.body);
  await tx(async (c) => {
    for (const r of ['gestor', 'gerente'] as const) {
      const list = b[r];
      if (!list) continue;
      const caps = [...new Set(list)].filter((x): x is Capability => GESTOR_ALLOWED.has(x as Capability));
      await c.query(`DELETE FROM role_permissions WHERE role = $1`, [r]);
      for (const cap of caps) await c.query(`INSERT INTO role_permissions (role, capability) VALUES ($1, $2)`, [r, cap]);
    }
  });
  clearPermCache();
  res.json({ capabilities: CAPABILITIES, roles: await rolesMatrix() });
});
