/**
 * Pluto Mídia — API (Node.js + Express 5 + PostgreSQL).
 * Atrás do Nginx: o prefixo /api é removido antes de chegar aqui (rotas sem /api).
 */
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { one, pool, q } from './db.js';
import { migrate } from './migrate.js';
import { errorHandler, HttpError, notFoundHandler } from './lib/http.js';
import { requireAuth } from './auth/session.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { metricsRouter } from './routes/metrics.js';
import { placementsRouter } from './routes/placements.js';
import { companiesReadRouter } from './routes/companies.js';
import { adminRouter } from './routes/admin/index.js';
import { backfillIfEmpty } from './services/fx.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Nginx do host → (container) → Node. Confia em proxies com IP privado/loopback (IP real p/ rate limit, cookie Secure).
  const tp = process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal';
  app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // CSRF: além do cookie SameSite=Lax, requisições que alteram dados precisam vir do próprio app.
  const allowed = new Set([new URL(config.appUrl).origin]);
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return next(new HttpError(403, 'bad_origin', 'Origem não permitida.'));
    next();
  });

  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  app.use('/auth', authRouter);
  app.use(requireAuth); // daqui para baixo, só com sessão válida
  app.use('/me', meRouter);
  app.use('/admin', adminRouter);
  app.use(companiesReadRouter);
  app.use('/placements', placementsRouter);
  app.use(metricsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Primeiro boot: cria o admin principal a partir de ADMIN_EMAIL / ADMIN_PASSWORD (se ainda não houver usuários). */
async function seedAdmin() {
  const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM users');
  if (n && n.n > 0) return;
  const { email, password, name } = config.admin;
  if (!email || !password) { console.warn('[seed] nenhum usuário no banco e ADMIN_EMAIL/ADMIN_PASSWORD não definidos.'); return; }
  if (password.length < 10) throw new Error('ADMIN_PASSWORD precisa de 10+ caracteres.');
  await q(`INSERT INTO users (name, email, password_hash, role, status, must_change_password, is_main_admin) VALUES ($1, lower($2), $3, 'superadmin', 'active', false, true)`,
    [name, email, await argon2.hash(password, { type: argon2.argon2id })]);
  console.log(`[seed] admin principal criado: ${email} (troque ADMIN_PASSWORD do .env depois do primeiro login)`);
}

async function main() {
  await migrate();
  await seedAdmin();
  await q('DELETE FROM sessions WHERE expires_at < now()');
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`[api] ouvindo em :${config.port} (${config.isProd ? 'produção' : 'dev'})`));
  backfillIfEmpty().catch((e) => console.warn('[fx]', e.message));
  if (config.schedulerEnabled) startScheduler();
  const stop = (sig: string) => {
    console.log(`[api] ${sig}: encerrando…`);
    stopScheduler();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((e) => { console.error('[api] falha ao iniciar', e); process.exit(1); });
