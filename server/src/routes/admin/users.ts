import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { accountsOf, clearGestorLinks, resyncAccounts, saveGestorLinks } from '../../services/gestorLinks.js';
import { deriveAccounts } from '../../services/accountLinks.js';
import { DEFAULT_FIXED_PCT, DEFAULT_TIERS } from '../../services/financeResults.js';
import { adminScope, type AdminScope } from '../../auth/scope.js';
import { one, q, tx } from '../../db.js';
import { conflict, HttpError, notFound, parse } from '../../lib/http.js';
import { tempPassword } from '../../lib/crypto.js';
import { inviteEmail, sendMail } from '../../lib/mailer.js';
import { killSessions, loadUser, requireSuperAdmin, USER_SQL, type SessionUser } from '../../auth/session.js';
import { CAPABILITIES, clearPermCache, GESTOR_ALLOWED, rolesMatrix, type Capability } from '../../auth/permissions.js';

export const usersRouter = Router();

/* Admin e SuperAdmin chegam aqui (requireAdmin). As regras de SuperAdmin estão em guardSuper(). */

const id = z.string().regex(/^\d+$/, 'id inválido');
const role = z.enum(['gestor', 'gerente', 'admin', 'superadmin']);
const ids = z.array(z.string().regex(/^\d+$/)).max(200);
/** Gestor: domínio + contas Google Ads + contas Meta Ads que ele usa nesse domínio. */
const domainLink = z.object({ domain: z.string().trim().toLowerCase().min(3).max(190), googleAccounts: ids.default([]), metaAccounts: ids.default([]) });
const links = { squadIds: ids.optional(), companyIds: ids.optional(), domains: z.array(domainLink).max(300).optional() };
/** Comissão do gestor (0.18.10): progressiva (faixas do próprio cadastro) ou fixa (% única), sobre o ROI total do mês. */
const tiersSchema = z.array(z.object({ from: z.number().min(0).max(1e10), pct: z.number().min(0).max(100) })).min(1).max(10)
  .refine((t) => t.some((x) => x.from === 0), { message: 'A primeira faixa da comissão progressiva precisa começar em 0.' })
  .refine((t) => new Set(t.map((x) => x.from)).size === t.length, { message: 'Duas faixas da comissão progressiva não podem começar no mesmo valor.' });
const commission = {
  commissionMode: z.enum(['progressive', 'fixed']).optional(),
  commissionPct: z.number().gt(0).max(100).nullable().optional(),
  commissionTiers: tiersSchema.nullable().optional(),
  commissionTierCurrency: z.enum(['BRL', 'USD', 'EUR']).optional(),
};

async function saveCommission(c: C, uid: string, role: string, b: { commissionMode?: 'progressive' | 'fixed'; commissionPct?: number | null; commissionTiers?: { from: number; pct: number }[] | null; commissionTierCurrency?: 'BRL' | 'USD' | 'EUR' }, isNew = false) {
  if (role !== 'gestor') return;   // só gestor recebe comissão
  if (!isNew && b.commissionMode === undefined && b.commissionPct === undefined && b.commissionTiers === undefined && b.commissionTierCurrency === undefined) return;
  const cur = await one<{ mode: 'progressive' | 'fixed'; pct: number | null; tiers: { from: number; pct: number }[] | null; cur: 'BRL' | 'USD' | 'EUR' }>(
    'SELECT commission_mode AS mode, commission_pct::float AS pct, commission_tiers AS tiers, commission_tier_currency AS cur FROM users WHERE id = $1', [uid], c);
  const mode = b.commissionMode ?? cur?.mode ?? 'progressive';
  if (mode === 'fixed') {
    const pct = (b.commissionPct !== undefined ? b.commissionPct : cur?.pct) ?? DEFAULT_FIXED_PCT;
    await c.query('UPDATE users SET commission_mode = $2, commission_pct = $3, commission_tiers = NULL WHERE id = $1', [uid, mode, pct]);
  } else {
    const tiers = [...((b.commissionTiers !== undefined ? b.commissionTiers : cur?.tiers) ?? DEFAULT_TIERS)].sort((x, y) => x.from - y.from);
    const currency = b.commissionTierCurrency ?? (b.commissionTiers ? undefined : cur?.cur) ?? 'USD';
    await c.query('UPDATE users SET commission_mode = $2, commission_pct = NULL, commission_tiers = $3, commission_tier_currency = $4 WHERE id = $1', [uid, mode, JSON.stringify(tiers), currency]);
  }
}

const resync = resyncAccounts;

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
 * - domains: só Gestor — domínio + contas que ele usa ali. 0.18.8: é o ÚNICO lugar que liga usuário × domínio × conta.
 *   domain_accounts (site em que o sync põe a despesa da conta) e manager_accounts são derivados daqui.
 * Devolve as contas cujo site mudou (para ressincronizar depois do commit).
 */
async function saveLinks(c: C, uid: string, newRole: string, b: { squadIds?: string[]; companyIds?: string[]; domains?: z.infer<typeof domainLink>[] }, roleChanged: boolean, actor: string | null, sc: AdminScope | null = null): Promise<string[]> {
  // 0.18.11: o Admin só mexe nos Squads, Empresas e domínios das Empresas em que é sócio; o resto do usuário fica como está
  if (b.squadIds !== undefined || roleChanged) {
    const sq = newRole === 'gerente' ? [...new Set(b.squadIds ?? [])] : [];
    if (sc && sq.some((x) => !sc.squadIds.includes(x))) throw new HttpError(403, 'forbidden_squad', 'Algum Squad não pertence a uma Empresa da qual você é sócio.');
    if (sc && !(roleChanged && newRole !== 'gerente')) await c.query('DELETE FROM squad_users WHERE user_id = $1 AND squad_id = ANY($2::bigint[])', [uid, sc.squadIds]);
    else await c.query('DELETE FROM squad_users WHERE user_id = $1', [uid]);
    if (sq.length) {
      const ok = await q<{ id: string }>('SELECT id::text FROM squads WHERE id = ANY($1::bigint[])', [sq], c);
      if (ok.length !== sq.length) throw notFound('Algum Squad da lista não existe.');
      for (const s of sq) await c.query('INSERT INTO squad_users (squad_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [s, uid]);
    }
  }
  if (b.companyIds !== undefined) {
    const co = [...new Set(b.companyIds)];
    const ok = await q<{ id: string }>('SELECT id::text FROM companies WHERE id = ANY($1::bigint[])', [co], c);
    if (ok.length !== co.length) throw notFound('Alguma Empresa da lista não existe.');
    if (sc) {
      if (co.some((x) => !sc.companyIds.includes(x))) throw new HttpError(403, 'forbidden_company', 'Você só pode dar sociedade nas Empresas em que é sócio.');
      if (uid === actor && sc.companyIds.some((x) => !co.includes(x))) throw conflict('self_partner', 'Você não pode se tirar da sociedade (perderia o acesso à Empresa). Peça a um SuperAdmin.');
      await c.query('DELETE FROM company_users WHERE user_id = $1 AND company_id = ANY($2::bigint[])', [uid, sc.companyIds]);
    } else await c.query('DELETE FROM company_users WHERE user_id = $1', [uid]);
    for (const x of co) await c.query('INSERT INTO company_users (company_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [x, uid]);
  }
  if (b.domains === undefined && !roleChanged) return [];
  if (newRole !== 'gestor') return clearGestorLinks(c, uid, actor);
  const scope = sc ? { domainIds: new Set(sc.domainIds), accountIds: new Set((await q<{ id: string }>(`SELECT id::text FROM integration_accounts WHERE provider IN ('google-ads', 'meta')`, [], c)).map((r) => r.id)) } : undefined;
  return saveGestorLinks(c, uid, b.domains ?? [], actor, scope);
}

usersRouter.get('/users', async (req, res) => {
  const users = await q<{ domains: { domain: string }[]; companyIds: string[]; squadIds: string[] }>(`${USER_SQL} ORDER BY u.is_main_admin DESC, u.name`);
  const sc = await adminScope(req);
  if (!sc) return res.json({ users });
  // 0.18.11: o Admin só enxerga os domínios, Squads e Empresas das sociedades dele
  const hosts = new Set((await q<{ hostname: string }>('SELECT hostname FROM domains WHERE id = ANY($1::bigint[])', [sc.domainIds])).map((r) => r.hostname));
  res.json({ users: users.map((u) => ({ ...u, domains: u.domains.filter((d) => hosts.has(d.domain)), companyIds: u.companyIds.filter((x) => sc.companyIds.includes(x)), squadIds: u.squadIds.filter((x) => sc.squadIds.includes(x)) })) });
});

/** Cria com senha temporária (hash argon2id) e envia o convite por e-mail. A senha nunca volta na resposta. */
usersRouter.post('/users', async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200), role, ...links, ...commission }), req.body);
  guardSuper(req.user!, null, b.role);
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [b.email])) throw conflict('email_taken', 'Já existe um usuário com esse e-mail.');
  const pw = tempPassword();
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  let moved: string[] = [];
  const sc = await adminScope(req);
  const uid = await tx(async (c) => {
    const r = await one<{ id: string }>(`INSERT INTO users (name, email, password_hash, role, status, must_change_password) VALUES ($1, $2, $3, $4, 'invited', true) RETURNING id::text`, [b.name, b.email, hash, b.role], c);
    moved = await saveLinks(c, r!.id, b.role, b, false, req.user!.id, sc);
    await saveCommission(c, r!.id, b.role, b, true);
    return r!.id;
  });
  if (moved.length) await resync(moved);
  const m = inviteEmail(b.name, b.email, pw);
  const inviteSent = await sendMail(b.email, m.subject, m.html, m.text);
  res.status(201).json({ user: await loadUser(uid), inviteSent });
});

usersRouter.patch('/users/:id', async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), role: role.optional(), status: z.enum(['active', 'disabled']).optional(), ...links, ...commission }), req.body);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  guardSuper(req.user!, t, b.role);
  const self = t.id === req.user!.id;
  if (self && ((b.role && b.role !== t.role) || b.status === 'disabled')) throw conflict('self', 'Você não pode mudar a sua própria permissão ou se desativar.');
  if (t.isMainAdmin && ((b.role && b.role !== 'superadmin') || b.status === 'disabled')) throw conflict('main_admin', 'O admin principal é sempre SuperAdmin e fica ativo.');
  if (b.status && t.status === 'invited') throw conflict('invited', 'O usuário ainda não ativou o convite.');
  const newRole = b.role ?? t.role;
  const sc = await adminScope(req);
  const moved = await tx(async (c) => {
    await c.query(`UPDATE users SET name = COALESCE($2, name), role = $3, status = COALESCE($4, status), updated_at = now() WHERE id = $1`, [uid, b.name ?? null, newRole, b.status ?? null]);
    const m = await saveLinks(c, uid, newRole, b, newRole !== t.role, req.user!.id, sc);
    await saveCommission(c, uid, newRole, b);
    return m;
  });
  if (moved.length) await resync(moved);
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
  const moved = await tx(async (c) => {
    const acc = await accountsOf(c, uid);
    await c.query('DELETE FROM users WHERE id = $1', [uid]); // sessões, squad_users e vínculos saem em cascata
    return deriveAccounts(c, acc, req.user!.id);
  });
  if (moved.length) await resync(moved);
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

/** 0.18: libera/revoga a criação automatizada de campanhas Meta. EXCLUSIVO do SuperAdmin (Admin recebe 403). */
usersRouter.put('/users/:id/meta-campaigns', requireSuperAdmin, async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ enabled: z.boolean() }), req.body);
  const t = await loadUser(uid);
  if (!t) throw notFound('Usuário não encontrado.');
  if (b.enabled && t.status === 'disabled') throw conflict('disabled', 'Usuário desativado não pode receber essa permissão.');
  await q(`UPDATE users SET can_create_meta_campaigns = $2, meta_campaigns_granted_by = $3, meta_campaigns_granted_at = now(), updated_at = now() WHERE id = $1`,
    [uid, b.enabled, req.user!.id]);
  res.json(await loadUser(uid));
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
