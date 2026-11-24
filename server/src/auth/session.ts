import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { HttpError } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { capsOf, isAdminRole, type Capability, type Role } from './permissions.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  squadIds: string[];                 // Gerente: Squads que ele vê (vários)
  companyIds: string[];               // Empresas em que é sócio
  /** Gestor: domínios que ele gere e as contas que usa em cada um */
  domains: { domain: string; googleAccounts: string[]; metaAccounts: string[] }[];
  status: 'active' | 'invited' | 'disabled';
  mustChangePassword: boolean;
  isMainAdmin: boolean;
  /** 0.18: libera a criação automatizada de campanhas Meta. Só o SuperAdmin atribui. */
  canCreateMetaCampaigns: boolean;
  /** 0.18.8: Gestor — comissão progressiva (faixas do painel) ou fixa (commissionPct %). */
  commissionMode: 'progressive' | 'fixed';
  commissionPct: number | null;
  /** 0.18.10: faixas da progressiva do próprio gestor (moeda commissionTierCurrency) */
  commissionTiers: { from: number; pct: number }[] | null;
  commissionTierCurrency: 'BRL' | 'USD' | 'EUR';
  permissions: Capability[];
}
declare global {
  namespace Express { interface Request { user?: SessionUser; sessionHash?: string } }
}

export const USER_SQL = `
  SELECT u.id::text, u.name, u.email, u.role, u.status, u.must_change_password AS "mustChangePassword", u.is_main_admin AS "isMainAdmin", u.can_create_meta_campaigns AS "canCreateMetaCampaigns",
         u.commission_mode AS "commissionMode", u.commission_pct::float AS "commissionPct",
         u.commission_tiers AS "commissionTiers", u.commission_tier_currency AS "commissionTierCurrency",
         COALESCE((SELECT array_agg(su.squad_id::text ORDER BY su.squad_id) FROM squad_users su WHERE su.user_id = u.id), '{}') AS "squadIds",
         COALESCE((SELECT array_agg(cu.company_id::text ORDER BY cu.company_id) FROM company_users cu WHERE cu.user_id = u.id), '{}') AS "companyIds",
         COALESCE((SELECT json_agg(json_build_object(
             'domain', d.hostname,
             'googleAccounts', COALESCE((SELECT array_agg(a.id::text ORDER BY a.name) FROM domain_manager_accounts x JOIN integration_accounts a ON a.id = x.account_id WHERE x.domain_id = dm.domain_id AND x.user_id = dm.user_id AND a.provider = 'google-ads'), '{}'),
             'metaAccounts',   COALESCE((SELECT array_agg(a.id::text ORDER BY a.name) FROM domain_manager_accounts x JOIN integration_accounts a ON a.id = x.account_id WHERE x.domain_id = dm.domain_id AND x.user_id = dm.user_id AND a.provider = 'meta'), '{}')
           ) ORDER BY d.hostname) FROM domain_managers dm JOIN domains d ON d.id = dm.domain_id WHERE dm.user_id = u.id), '[]'::json) AS "domains"
    FROM users u`;

export async function loadUser(id: string): Promise<SessionUser | null> {
  const u = await one<Omit<SessionUser, 'permissions'>>(`${USER_SQL} WHERE u.id = $1`, [id]);
  return u ? { ...u, permissions: await capsOf(u.role) } : null;
}

const cookieOpts = () => ({ httpOnly: true, secure: config.session.secure, sameSite: 'lax' as const, path: '/', maxAge: config.session.days * 864e5 });

export async function startSession(req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(token), userId, config.session.days, req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  res.cookie(config.session.cookie, token, cookieOpts());
}
export async function endSession(req: Request, res: Response) {
  if (req.sessionHash) await q('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash]);
  res.clearCookie(config.session.cookie, { ...cookieOpts(), maxAge: undefined });
}
/** Encerra todas as sessões do usuário (troca de senha, desativação, exclusão). */
export async function killSessions(userId: string, exceptHash?: string) {
  await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> COALESCE($2, \'\')', [userId, exceptHash ?? null]);
}

/** Lê o cookie, valida a sessão e carrega req.user. 401 se não houver. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.session.cookie];
  if (!token || typeof token !== 'string') return next(new HttpError(401, 'unauthenticated', 'Sessão expirada. Entre de novo.'));
  const hash = sha256(token);
  const s = await one<{ user_id: string }>('SELECT user_id::text FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hash]);
  if (!s) return next(new HttpError(401, 'unauthenticated', 'Sessão expirada. Entre de novo.'));
  const u = await loadUser(s.user_id);
  if (!u || u.status === 'disabled') return next(new HttpError(401, 'unauthenticated', 'Usuário sem acesso.'));
  req.user = u;
  req.sessionHash = hash;
  next();
}

/** Bloqueia o módulo se o papel do usuário não tiver a permissão. */
export const requireCap = (cap: Capability) => (req: Request, _res: Response, next: NextFunction) =>
  req.user?.permissions.includes(cap) ? next() : next(new HttpError(403, 'forbidden_module', 'Este módulo não está liberado para o seu usuário.'));

/** /admin/* é só Admin ou SuperAdmin, sempre. */
export const requireAdmin = (req: Request, _res: Response, next: NextFunction) =>
  req.user && isAdminRole(req.user.role) ? next() : next(new HttpError(403, 'forbidden', 'Área exclusiva de Admin.'));

/** Conectar integrações e mudar a frequência do sync: só SuperAdmin. */
export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.role === 'superadmin' ? next() : next(new HttpError(403, 'superadmin_only', 'Só o SuperAdmin pode conectar integrações e mudar a frequência de sincronização.'));

/** Criação automatizada de campanhas Meta (0.18): exige a flag can_create_meta_campaigns no usuário (atribuída só pelo SuperAdmin). */
export const requireMetaCampaigns = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.canCreateMetaCampaigns ? next() : next(new HttpError(403, 'meta_campaigns_disabled', 'A criação de campanhas Meta não está liberada para o seu usuário.'));

/** Senha nova precisa: 10+ caracteres, letra e número. */
export function checkPasswordStrength(p: string) {
  if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(422, 'weak_password', 'A senha precisa de 10 caracteres ou mais, com letras e números.');
}
