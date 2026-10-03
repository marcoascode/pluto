import { Router } from 'express';
import { z } from 'zod';
import { q } from '../../db.js';
import { parse } from '../../lib/http.js';
import { requireAdmin } from '../../auth/session.js';
import { usersRouter } from './users.js';
import { squadsRouter } from './squads.js';
import { domainsRouter } from './domains.js';
import { integrationsRouter } from './integrations.js';

/** /admin/* — sempre Acesso Total (403 para Gestor), além do requireAuth global. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use(usersRouter);
adminRouter.use(squadsRouter);
adminRouter.use(domainsRouter);
adminRouter.use(integrationsRouter);

/** UTMs globais (uma estrutura por plataforma). */
adminRouter.put('/utm-templates', async (req, res) => {
  const b = parse(z.object({ google: z.string().trim().min(10).max(1000), meta: z.string().trim().min(10).max(1000) }), req.body);
  await q(`INSERT INTO app_settings (key, value, updated_at) VALUES ('utm_templates', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(b)]);
  res.json(b);
});
