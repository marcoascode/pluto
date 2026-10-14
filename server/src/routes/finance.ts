/**
 * Finance (menu Finance → Caixa Empresa e Custos).
 * Quem acessa: Admin/SuperAdmin (todas as Empresas) e os sócios de cada Empresa (company_users), só as Empresas deles.
 * Gestor e Gerente que não são sócios recebem 403. ?company=<id> = uma Empresa; vazio = todas as que o usuário vê.
 *
 *   GET    /finance/overview?company&from=YYYY-MM&to=YYYY-MM&currency   caixa + fechamento mês a mês
 *   GET    /finance/costs?company&month=YYYY-MM&currency                 custos lançados (e quanto pesam no mês)
 *   POST   /finance/costs            PUT /finance/costs/:id            DELETE /finance/costs/:id
 *   POST   /finance/cash             (saldo conferido, aporte ou retirada)  DELETE /finance/cash/:id
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { today } from '../lib/dates.js';
import { isAdminRole } from '../auth/permissions.js';
import { aggregate, type Currency } from '../services/metrics.js';
import { appliesIn, CATEGORIES, cashPosition, fxTable, loadCosts, monthEnd, monthlyClose, monthsBetween } from '../services/finance.js';

export const financeRouter = Router();

const YM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const CUR = z.enum(['BRL', 'USD', 'EUR']);
const currencyOf = (req: Request) => (CUR.safeParse(req.query.currency).success ? req.query.currency : 'BRL') as Currency;

/** Empresas que o usuário pode ver no Finance. */
async function financeCompanies(req: Request) {
  const u = req.user!;
  const rows = isAdminRole(u.role)
    ? await q<{ id: string; name: string }>('SELECT id::text, name FROM companies ORDER BY name')
    : await q<{ id: string; name: string }>('SELECT c.id::text, c.name FROM companies c JOIN company_users cu ON cu.company_id = c.id WHERE cu.user_id = $1 ORDER BY c.name', [u.id]);
  if (!isAdminRole(u.role) && !rows.length) throw new HttpError(403, 'forbidden_finance', 'O Finance é só para Admin e sócios das Empresas.');
  return rows;
}
/** Empresas da consulta: ?company= (precisa ser uma das dele) ou todas. */
async function scopeCompanies(req: Request) {
  const all = await financeCompanies(req);
  const c = req.query.company;
  if (typeof c === 'string' && c) {
    const hit = all.find((x) => x.id === c);
    if (!hit) throw new HttpError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
    return { all, sel: [hit] };
  }
  return { all, sel: all };
}
async function assertCompany(req: Request, id: string) {
  if (!(await financeCompanies(req)).some((c) => c.id === id)) throw new HttpError(403, 'forbidden_company', 'Você não tem acesso a esta Empresa.');
}

financeRouter.get('/overview', async (req, res) => {
  const { all, sel } = await scopeCompanies(req);
  const currency = currencyOf(req);
  const t = today();
  const cur = t.slice(0, 7);
  const prev = monthsBetween(`${Number(cur.slice(0, 4)) - 1}-12`, cur).slice(-2)[0];   // mês anterior
  const from = req.query.from ? parse(YM, req.query.from) : prev;
  const to = req.query.to ? parse(YM, req.query.to) : cur;
  if (from > to) throw new HttpError(422, 'invalid_period', '"from" depois de "to".');
  const months = monthsBetween(from, to);
  if (months.length > 36) throw new HttpError(422, 'period_too_long', 'Escolha no máximo 36 meses.');
  const ids = sel.map((c) => c.id);
  const [close, cash] = await Promise.all([monthlyClose(ids, months, currency), cashPosition(sel, currency)]);
  const sum = (k: 'revenue' | 'googleSpend' | 'metaSpend' | 'iva' | 'adSpend' | 'costs' | 'result') => close.reduce((a, m) => a + m[k], 0);
  const totals = { revenue: sum('revenue'), googleSpend: sum('googleSpend'), metaSpend: sum('metaSpend'), iva: sum('iva'), adSpend: sum('adSpend'), costs: sum('costs'), result: sum('result') };
  // Admin, "todas": o que ficou fora do Finance (domínios sem Empresa, inclusive "Sem domínio")
  let outside: { revenue: number; adSpend: number } | null = null;
  if (isAdminRole(req.user!.role) && !req.query.company) {
    const out = await q<{ id: string }>(`SELECT d.id::text FROM domains d WHERE d.active AND NOT EXISTS (SELECT 1 FROM squad_domains sd JOIN squads s ON s.id = sd.squad_id WHERE sd.domain_id = d.id AND s.company_id IS NOT NULL)`);
    if (out.length) {
      const m = (await aggregate({ from: `${from}-01`, to: [monthEnd(to), t].sort()[0], domainIds: out.map((x) => x.id), filter: null, currency })).get('');
      if (m && (m.revenue || m.spend)) outside = { revenue: m.revenue, adSpend: m.spend };
    }
  }
  res.json({
    currency, from, to, companies: all, selected: req.query.company || null,
    cash: { total: cash.some((c) => c.balance != null) ? cash.reduce((a, c) => a + (c.balance ?? 0), 0) : null, companies: cash },
    months: close, totals: { ...totals, margin: totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : null },
    outside,
  });
});

/* ---------- custos ---------- */
const costBody = z.object({
  companyId: z.string().regex(/^\d+$/),
  name: z.string().trim().min(2).max(120),
  category: z.enum(CATEGORIES),
  amount: z.number().positive().max(1e10),
  currency: CUR.default('BRL'),
  recurrence: z.enum(['monthly', 'once']).default('monthly'),
  startMonth: YM,
  endMonth: YM.nullable().optional(),
  payDay: z.number().int().min(1).max(28).default(1),
  notes: z.string().trim().max(500).nullable().optional(),
}).refine((b) => !b.endMonth || b.endMonth >= b.startMonth, { message: 'O fim não pode ser antes do início.', path: ['endMonth'] });

const costOut = (c: Awaited<ReturnType<typeof loadCosts>>[number]) => ({
  id: c.id, companyId: c.company_id, companyName: c.company_name, name: c.name, category: c.category, amount: c.amount, currency: c.currency,
  recurrence: c.recurrence, startMonth: c.start_month.slice(0, 7), endMonth: c.end_month ? c.end_month.slice(0, 7) : null, payDay: c.pay_day, notes: c.notes,
});

financeRouter.get('/costs', async (req, res) => {
  const { all, sel } = await scopeCompanies(req);
  const currency = currencyOf(req);
  const t = today();
  const month = req.query.month ? parse(YM, req.query.month) : t.slice(0, 7);
  const costs = await loadCosts(sel.map((c) => c.id));
  const day = [monthEnd(month), t].sort()[0];
  const conv = await fxTable(day, day);
  const rows = costs.map((c) => {
    const applies = appliesIn(c, month);
    return { ...costOut(c), appliesInMonth: applies, monthAmount: applies ? conv(c.amount, c.currency, currency, day) : 0 };
  });
  const byCategory: Record<string, number> = {};
  for (const r of rows) if (r.appliesInMonth) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.monthAmount;
  res.json({
    currency, month, companies: all, costs: rows,
    totals: {
      month: rows.reduce((a, r) => a + r.monthAmount, 0),
      recurring: rows.filter((r) => r.appliesInMonth && r.recurrence === 'monthly').reduce((a, r) => a + r.monthAmount, 0),
      once: rows.filter((r) => r.appliesInMonth && r.recurrence === 'once').reduce((a, r) => a + r.monthAmount, 0),
      byCategory,
    },
  });
});

async function getCost(id: string) {
  const c = await one<{ id: string; company_id: string }>('SELECT id::text, company_id::text FROM finance_costs WHERE id = $1', [id]);
  if (!c) throw notFound('Custo não encontrado.');
  return c;
}
const save = async (b: z.infer<typeof costBody>, userId: string, id?: string) => {
  const end = b.recurrence === 'once' ? null : b.endMonth ? `${b.endMonth}-01` : null;
  const vals = [b.companyId, b.name, b.category, b.amount, b.currency, b.recurrence, `${b.startMonth}-01`, end, b.payDay, b.notes || null];
  const r = id
    ? await one<{ id: string }>(`UPDATE finance_costs SET company_id = $1, name = $2, category = $3, amount = $4, currency = $5, recurrence = $6, start_month = $7, end_month = $8, pay_day = $9, notes = $10, updated_at = now() WHERE id = $11 RETURNING id::text`, [...vals, id])
    : await one<{ id: string }>(`INSERT INTO finance_costs (company_id, name, category, amount, currency, recurrence, start_month, end_month, pay_day, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text`, [...vals, userId]);
  const row = (await loadCosts([b.companyId])).find((x) => x.id === r!.id)!;
  return costOut(row);
};

financeRouter.post('/costs', async (req, res) => {
  const b = parse(costBody, req.body);
  await assertCompany(req, b.companyId);
  res.status(201).json(await save(b, req.user!.id));
});
financeRouter.put('/costs/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  const b = parse(costBody, req.body);
  await assertCompany(req, b.companyId);
  res.json(await save(b, req.user!.id, id));
});
financeRouter.delete('/costs/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  await q('DELETE FROM finance_costs WHERE id = $1', [id]);
  res.status(204).end();
});

/* ---------- caixa: saldo conferido, aporte, retirada ---------- */
const cashBody = z.object({
  companyId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['balance', 'deposit', 'withdrawal']),
  amount: z.number().min(-1e11).max(1e11),
  currency: CUR.default('BRL'),
  note: z.string().trim().max(300).nullable().optional(),
}).refine((b) => b.kind === 'balance' || b.amount > 0, { message: 'Aporte e retirada precisam de valor maior que zero.', path: ['amount'] });

financeRouter.post('/cash', async (req, res) => {
  const b = parse(cashBody, req.body);
  await assertCompany(req, b.companyId);
  if (b.date > today()) throw new HttpError(422, 'future_date', 'A data não pode ser depois de hoje.');
  const r = await one<{ id: string }>(`INSERT INTO finance_cash_entries (company_id, date, kind, amount, currency, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
    [b.companyId, b.date, b.kind, b.amount, b.currency, b.note || null, req.user!.id]);
  res.status(201).json({ id: r!.id });
});
financeRouter.delete('/cash/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const e = await one<{ company_id: string }>('SELECT company_id::text FROM finance_cash_entries WHERE id = $1', [id]);
  if (!e) throw notFound('Lançamento não encontrado.');
  await assertCompany(req, e.company_id);
  await q('DELETE FROM finance_cash_entries WHERE id = $1', [id]);
  res.status(204).end();
});
