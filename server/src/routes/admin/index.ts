import { Router } from 'express';
import { z } from 'zod';
import { q } from '../../db.js';
import { parse } from '../../lib/http.js';
import { currentDiscount, discountHistory } from '../../services/fx.js';
import { today } from '../../lib/dates.js';
import { requireAdmin } from '../../auth/session.js';
import { usersRouter } from './users.js';
import { squadsRouter } from './squads.js';
import { domainsRouter } from './domains.js';
import { integrationsRouter } from './integrations.js';
import { companiesRouter } from './companies.js';
import campaignsRouter from './campaigns.js'; // <-- Nova importação

/** /admin/* — só Admin e SuperAdmin (403 para Gestor e Gerente), além do requireAuth global. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use(usersRouter);
adminRouter.use(squadsRouter);
adminRouter.use(domainsRouter);
adminRouter.use(integrationsRouter);
adminRouter.use(companiesRouter);
adminRouter.use('/campaigns', campaignsRouter); // <-- Adição do novo roteador de campanhas

/** UTMs globais (uma estrutura por plataforma). */
adminRouter.put('/utm-templates', async (req, res) => {
  const b = parse(z.object({ google: z.string().trim().min(10).max(1000), meta: z.string().trim().min(10).max(1000) }), req.body);
  await q(`INSERT INTO app_settings (key, value, updated_at) VALUES ('utm_templates', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(b)]);
  res.json(b);
});

/* ---------------- deságio do câmbio (Moedas) ----------------
   R$ descontado da cotação USD/BRL na receita do Ad Manager. O primeiro valor vale para todo o histórico;
   os seguintes valem a partir de validFrom (padrão: hoje). */
adminRouter.get('/fx-discount', async (_req, res) => { res.json({ current: await currentDiscount(), history: await discountHistory() }); });
adminRouter.put('/fx-discount', async (req, res) => {
  const b = parse(z.object({ amount: z.number().min(0).max(4.9999), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  const first = !(await q('SELECT 1 FROM fx_discounts LIMIT 1')).length;
  const from = b.validFrom ?? (first ? '2000-01-01' : today());
  await q(`INSERT INTO fx_discounts (valid_from, amount_brl, created_by) VALUES ($1, $2, $3)
           ON CONFLICT (valid_from) DO UPDATE SET amount_brl = EXCLUDED.amount_brl, created_by = EXCLUDED.created_by, created_at = now()`, [from, b.amount, req.user!.id]);
  res.json({ current: await currentDiscount(), history: await discountHistory() });
});
