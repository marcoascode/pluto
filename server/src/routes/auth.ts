import argon2 from 'argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, q } from '../db.js';
import { HttpError, parse } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { resetEmail, sendMail } from '../lib/mailer.js';
import { checkPasswordStrength, endSession, killSessions, loadUser, requireAuth, startSession } from '../auth/session.js';

export const authRouter = Router();

// 10 tentativas ERRADAS por 15 min por IP (o Nginx repassa o IP real; ver app.set('trust proxy')).
// Logins certos não contam: várias pessoas no mesmo escritório (mesmo IP) entram normalmente.
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts', message: 'Muitas tentativas. Espere alguns minutos.' } }) });
// "Esqueci a senha" sempre responde 204 (não revela e-mails), então conta todas as chamadas.
const forgotLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts', message: 'Muitas tentativas. Espere alguns minutos.' } }) });

// hash descartável para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails existem)
const DUMMY = argon2.hash(randomToken(16), { type: argon2.argon2id });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body);
  const row = await one<{ id: string; password_hash: string | null; status: string }>('SELECT id::text, password_hash, status FROM users WHERE lower(email) = $1', [b.email]);
  const ok = row?.password_hash ? await argon2.verify(row.password_hash, b.password).catch(() => false) : (await argon2.verify(await DUMMY, b.password).catch(() => false), false);
  if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
  if (row.status === 'disabled') throw new HttpError(403, 'user_disabled', 'Usuário desativado. Fale com o administrador.');
  await startSession(req, res, row.id);
  res.json({ user: await loadUser(row.id) });
});

authRouter.post('/logout', requireAuth, async (req, res) => { await endSession(req, res); res.status(204).end(); });

authRouter.get('/me', requireAuth, (req, res) => { res.json({ user: req.user }); });

/** Troca de senha. No primeiro acesso (senha temporária) não pede a atual. Encerra as outras sessões. */
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().max(200).nullable().optional(), newPassword: z.string().max(200) }), req.body);
  checkPasswordStrength(b.newPassword);
  const u = req.user!;
  const row = await one<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!u.mustChangePassword) {
    if (!b.currentPassword || !row?.password_hash || !(await argon2.verify(row.password_hash, b.currentPassword).catch(() => false)))
      throw new HttpError(422, 'wrong_password', 'A senha atual não confere.');
  }
  const hash = await argon2.hash(b.newPassword, { type: argon2.argon2id });
  await q(`UPDATE users SET password_hash = $2, must_change_password = false, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE id = $1`, [u.id, hash]);
  await killSessions(u.id, req.sessionHash);
  res.status(204).end();
});

/** Sempre responde 204 (não revela se o e-mail existe). Envia link de 1 h. */
authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
  const u = await one<{ id: string; name: string; email: string }>(`SELECT id::text, name, email FROM users WHERE lower(email) = $1 AND status <> 'disabled'`, [b.email]);
  if (u) {
    const token = randomToken(32);
    await q(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha256(token), u.id]);
    const m = resetEmail(u.name, token);
    await sendMail(u.email, m.subject, m.html, m.text);
  }
  res.status(204).end();
});

authRouter.post('/reset-password', loginLimiter, async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), newPassword: z.string().max(200) }), req.body);
  checkPasswordStrength(b.newPassword);
  const r = await one<{ user_id: string }>(`UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id::text`, [sha256(b.token)]);
  if (!r) throw new HttpError(422, 'invalid_token', 'Link inválido ou expirado. Peça outro.');
  const hash = await argon2.hash(b.newPassword, { type: argon2.argon2id });
  await q(`UPDATE users SET password_hash = $2, must_change_password = false, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE id = $1`, [r.user_id, hash]);
  await killSessions(r.user_id);
  res.status(204).end();
});
