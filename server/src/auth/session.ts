import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { HttpError } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { capsOf, type Capability } from './permissions.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'gestor' | 'total';
  squadId: string | null;
  status: 'active' | 'invited' | 'disabled';
  mustChangePassword: boolean;
  isMainAdmin: boolean;
  permissions: Capability[];
}
declare global {
  namespace Express { interface Request { user?: SessionUser; sessionHash?: string } }
}

export const USER_SQL = `
  SELECT u.id::text, u.name, u.email, u.role, u.status, u.must_change_password AS "mustChangePassword", u.is_main_admin AS "isMainAdmin",
         su.squad_id::text AS "squadId"
    FROM users u LEFT JOIN squad_users su ON su.user_id = u.id`;

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

/** /admin/* é só Acesso Total, sempre. */
export const requireAdmin = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.role === 'total' ? next() : next(new HttpError(403, 'forbidden', 'Área exclusiva de Acesso Total.'));

/** Senha nova precisa: 10+ caracteres, letra e número. */
export function checkPasswordStrength(p: string) {
  if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(422, 'weak_password', 'A senha precisa de 10 caracteres ou mais, com letras e números.');
}
