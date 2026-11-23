import { Router } from 'express';
import { z } from 'zod';
import { q } from '../../db.js';
import { parse } from '../../lib/http.js';
import { clearRevenueRateCache, currentDiscount, discountHistory, monthLocks, removeMonthLock, setMonthLock } from '../../services/fx.js';
import { today } from '../../lib/dates.js';
import { requireAdmin } from '../../auth/session.js';
import { usersRouter } from './users.js';
import { squadsRouter } from './squads.js';
import { domainsRouter } from './domains.js';
import { integrationsRouter } from './integrations.js';
import { companiesRouter } from './companies.js';
import { campaignsAdminRouter } from './campaigns.js';
import { utmAuditRouter } from './utmAudit.js';
import { reportsAdminRouter } from './reports.js';

/** /admin/* — só Admin e SuperAdmin (403 para Gestor e Gerente), além do requireAuth global. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use(usersRouter);
adminRouter.use(squadsRouter);
adminRouter.use(domainsRouter);
adminRouter.use(integrationsRouter);
adminRouter.use(companiesRouter);
adminRouter.use(campaignsAdminRouter);
adminRouter.use(utmAuditRouter);
adminRouter.use(reportsAdminRouter);

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
  clearRevenueRateCache();
  res.json({ current: await currentDiscount(), history: await discountHistory() });
});

/* ---------------- cotação travada por mês (0.18.6 · Relatórios → Resultados mensais) ----------------
   Depois do câmbio dos dólares do Ad Manager de um mês, a cotação aplicada vale para o ROI daquele mês e não flutua mais. */
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
adminRouter.get('/fx-locks', async (_req, res) => { res.json({ locks: await monthLocks() }); });
adminRouter.put('/fx-locks/:month', async (req, res) => {
  const month = parse(MONTH, req.params.month);
  const b = parse(z.object({ rate: z.number().gt(0).lt(100), note: z.string().trim().max(300).optional().nullable() }), req.body);
  await setMonthLock(month, b.rate, b.note || null, req.user!.id);
  res.json({ locks: await monthLocks() });
});
adminRouter.delete('/fx-locks/:month', async (req, res) => {
  await removeMonthLock(parse(MONTH, req.params.month));
  res.json({ locks: await monthLocks() });
});
