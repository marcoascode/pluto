/**
 * Finance (menu Finance → Caixa Empresa e Custos).
 * Quem acessa: Admin/SuperAdmin (todas as Empresas) e os sócios de cada Empresa (company_users), só as Empresas deles.
 * Gestor e Gerente que não são sócios recebem 403. ?company=<id> = uma Empresa; vazio = todas as que o usuário vê.
 *
 *   GET    /finance/overview?company&from=YYYY-MM&to=YYYY-MM&currency   caixa + fechamento mês a mês (só lançamentos manuais + custos)
 *   GET    /finance/costs?company&month=YYYY-MM&currency                 custos lançados (e quanto pesam no mês)
 *   POST   /finance/costs            PUT /finance/costs/:id            DELETE /finance/costs/:id
 *   PUT    /finance/costs/:id/months/:month   { amount, note? }   valor real do mês pela fatura/NF ("fechar o mês")
 *   DELETE /finance/costs/:id/months/:month                       reabre: volta a usar o valor do plano
 *   POST   /finance/costs/:id/prices          { fromMonth, amount, note? }   mudança de plano (upgrade/downgrade) a partir do mês
 *   DELETE /finance/costs/:id/prices/:priceId
 *   POST   /finance/cash             PUT /finance/cash/:id             DELETE /finance/cash/:id
 *          lançamento manual do caixa: receita recebida, gasto, aporte, retirada ou saldo conferido.
 *          O caixa NÃO lê o sync das campanhas: receita e gastos são os que foram de fato recebidos/pagos.
 *   GET    /finance/attachments?entryId= | ?costId=[&month=]           comprovantes (NF, recibo) de um lançamento ou custo
 *   POST   /finance/attachments                                          { entryId|costId, url, month?, amount?, currency?, docNumber?, docDate?, note? } (link do Drive)
 *   POST   /finance/attachments/file?entryId|costId&month&amount&…        corpo = o arquivo (PDF/JPG/PNG, até 10 MB), cabeçalho X-Filename
 *   GET    /finance/attachments/:id/file                                 abre o arquivo enviado
 *   DELETE /finance/attachments/:id
 *   0.14 → routes/financeCommissions.ts: /finance/sites, /commissions, /assignments, /commission-rule
 *          Receita e gasto do caixa podem ter site e mês de referência (site + competence): é daí que sai o resultado de cada site.
 */
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { today } from '../lib/dates.js';
import { isAdminRole } from '../auth/permissions.js';
import { normSite } from '../services/financeSources.js';
import { financeCommissionsRouter } from './financeCommissions.js';
import { amountIn, appliesIn, CATEGORIES, plannedIn, cashPosition, EXPENSE_CATEGORIES, fxTable, INCOME_CATEGORIES, loadCosts, monthEnd, monthlyClose, monthsBetween } from '../services/finance.js';

type Currency = 'BRL' | 'USD' | 'EUR';

export const financeRouter = Router();
/** 0.14: Comissões dos gestores, sites e regra (routes/financeCommissions.ts). */
financeRouter.use(financeCommissionsRouter);

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
  type K = 'income' | 'googleAds' | 'metaAds' | 'otherExpense' | 'expenses' | 'costs' | 'deposits' | 'withdrawals' | 'result';
  const sum = (k: K) => close.reduce((a, m) => a + m[k], 0);
  const totals = { income: sum('income'), googleAds: sum('googleAds'), metaAds: sum('metaAds'), otherExpense: sum('otherExpense'), expenses: sum('expenses'), costs: sum('costs'), deposits: sum('deposits'), withdrawals: sum('withdrawals'), result: sum('result') };
  res.json({
    currency, from, to, companies: all, selected: req.query.company || null,
    cash: { total: cash.some((c) => c.balance != null) ? cash.reduce((a, c) => a + (c.balance ?? 0), 0) : null, companies: cash },
    months: close, totals: { ...totals, margin: totals.income > 0 ? (totals.result / totals.income) * 100 : null },
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
  site: z.string().trim().max(120).nullable().optional(),   // custo atribuído a um site (0.14)
}).refine((b) => !b.endMonth || b.endMonth >= b.startMonth, { message: 'O fim não pode ser antes do início.', path: ['endMonth'] });

const costOut = (c: Awaited<ReturnType<typeof loadCosts>>[number]) => ({
  id: c.id, companyId: c.company_id, companyName: c.company_name, name: c.name, category: c.category, amount: c.amount, currency: c.currency,
  recurrence: c.recurrence, startMonth: c.start_month.slice(0, 7), endMonth: c.end_month ? c.end_month.slice(0, 7) : null, payDay: c.pay_day, notes: c.notes, attachments: c.attachments,
  prices: c.prices, site: c.site,
});

financeRouter.get('/costs', async (req, res) => {
  const { all, sel } = await scopeCompanies(req);
  const currency = currencyOf(req);
  const t = today();
  const month = req.query.month ? parse(YM, req.query.month) : t.slice(0, 7);
  const costs = await loadCosts(sel.map((c) => c.id));
  const day = [monthEnd(month), t].sort()[0];
  const conv = await fxTable(day, day);
  // comprovantes do mês escolhido (custo mensal tem uma NF por mês; avulso conta todos)
  const atts = new Map((await q<{ id: string; n: number }>(`SELECT cost_id::text AS id, count(*)::int AS n FROM finance_attachments
    WHERE cost_id = ANY($1::bigint[]) AND (month IS NULL OR month = $2::date) GROUP BY cost_id`, [costs.map((c) => c.id), `${month}-01`])).map((r) => [r.id, r.n]));
  const rows = costs.map((c) => {
    const applies = appliesIn(c, month);
    const planned = plannedIn(c, month);
    const actual = c.actuals[month] ?? null;
    const prevPlan = c.prices.some((p) => p.from === month) ? plannedIn(c, prevMonth(month)) : null;
    return {
      ...costOut(c), attachments: atts.get(c.id) ?? 0, appliesInMonth: applies,
      plannedAmount: planned,                       // valor do plano no mês (moeda do custo)
      planChangedFrom: prevPlan,                    // o plano mudou neste mês: valor anterior
      actualAmount: actual?.amount ?? null,         // valor real lançado pela NF (moeda do custo)
      actualNote: actual?.note ?? null,
      monthAmount: applies ? conv(amountIn(c, month), c.currency, currency, day) : 0,
    };
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

const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

async function getCost(id: string) {
  const c = await one<{ id: string; company_id: string; recurrence: 'monthly' | 'once'; start_month: string; end_month: string | null }>(
    'SELECT id::text, company_id::text, recurrence, start_month::text, end_month::text FROM finance_costs WHERE id = $1', [id]);
  if (!c) throw notFound('Custo não encontrado.');
  return c;
}
const save = async (b: z.infer<typeof costBody>, userId: string, id?: string) => {
  const end = b.recurrence === 'once' ? null : b.endMonth ? `${b.endMonth}-01` : null;
  const site = b.site ? normSite(b.site) : null;
  if (b.site && !site) throw new HttpError(422, 'invalid_site', 'Site inválido. Use o domínio, ex.: dominiox.com');
  const vals = [b.companyId, b.name, b.category, b.amount, b.currency, b.recurrence, `${b.startMonth}-01`, end, b.payDay, b.notes || null, site];
  const r = id
    ? await one<{ id: string }>(`UPDATE finance_costs SET company_id = $1, name = $2, category = $3, amount = $4, currency = $5, recurrence = $6, start_month = $7, end_month = $8, pay_day = $9, notes = $10, site = $11, updated_at = now() WHERE id = $12 RETURNING id::text`, [...vals, id])
    : await one<{ id: string }>(`INSERT INTO finance_costs (company_id, name, category, amount, currency, recurrence, start_month, end_month, pay_day, notes, site, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text`, [...vals, userId]);
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

/* ---------- valor real do mês (fatura/NF) e mudança de plano ---------- */
const ID = z.string().regex(/^\d+$/);
const monthBody = z.object({ amount: z.number().min(0).max(1e10), note: z.string().trim().max(300).nullable().optional() });
const priceBody = z.object({ fromMonth: YM, amount: z.number().positive().max(1e10), note: z.string().trim().max(200).nullable().optional() });

/** Fecha o mês com o valor real cobrado (pode ser diferente do plano: uso, proporcional de upgrade, logins a menos…). */
financeRouter.put('/costs/:id/months/:month', async (req, res) => {
  const id = parse(ID, req.params.id), month = parse(YM, req.params.month);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  if (!appliesIn(c, month)) throw new HttpError(422, 'month_out_of_range', 'Este custo não vale neste mês.');
  if (month > today().slice(0, 7)) throw new HttpError(422, 'future_month', 'Só dá para lançar o valor real de meses que já começaram.');
  const b = parse(monthBody, req.body);
  await q(`INSERT INTO finance_cost_months (cost_id, month, amount, note, created_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cost_id, month) DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, created_by = EXCLUDED.created_by, updated_at = now()`,
    [id, `${month}-01`, b.amount, b.note || null, req.user!.id]);
  res.json({ costId: id, month, amount: b.amount, note: b.note || null });
});
financeRouter.delete('/costs/:id/months/:month', async (req, res) => {
  const id = parse(ID, req.params.id), month = parse(YM, req.params.month);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  await q('DELETE FROM finance_cost_months WHERE cost_id = $1 AND month = $2', [id, `${month}-01`]);
  res.status(204).end();
});

/** Mudança de plano: o novo valor vale do mês escolhido em diante (os meses de antes ficam com o valor antigo). */
financeRouter.post('/costs/:id/prices', async (req, res) => {
  const id = parse(ID, req.params.id);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  const b = parse(priceBody, req.body);
  if (c.recurrence !== 'monthly') throw new HttpError(422, 'not_monthly', 'Só custos mensais mudam de plano. Num avulso, edite o valor.');
  if (b.fromMonth <= c.start_month.slice(0, 7)) throw new HttpError(422, 'before_start', 'A mudança precisa ser depois do mês de início. Para mudar o valor inicial, edite o custo.');
  if (c.end_month && b.fromMonth > c.end_month.slice(0, 7)) throw new HttpError(422, 'after_end', 'O custo já terminou antes deste mês.');
  const r = await one<{ id: string }>(`INSERT INTO finance_cost_prices (cost_id, from_month, amount, note, created_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cost_id, from_month) DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note RETURNING id::text`,
    [id, `${b.fromMonth}-01`, b.amount, b.note || null, req.user!.id]);
  res.status(201).json({ id: r!.id, from: b.fromMonth, amount: b.amount, note: b.note || null });
});
financeRouter.delete('/costs/:id/prices/:priceId', async (req, res) => {
  const id = parse(ID, req.params.id), pid = parse(ID, req.params.priceId);
  const c = await getCost(id);
  await assertCompany(req, c.company_id);
  const r = await q('DELETE FROM finance_cost_prices WHERE id = $1 AND cost_id = $2 RETURNING id', [pid, id]);
  if (!r.length) throw notFound('Mudança de plano não encontrada.');
  res.status(204).end();
});

/* ---------- caixa (manual): receita recebida, gasto, aporte, retirada, saldo conferido ---------- */
const cashBody = z.object({
  companyId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['balance', 'deposit', 'withdrawal', 'income', 'expense']),
  category: z.enum([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]).nullable().optional(),
  amount: z.number().min(-1e11).max(1e11),
  currency: CUR.default('BRL'),
  note: z.string().trim().max(300).nullable().optional(),
  site: z.string().trim().max(120).nullable().optional(),   // receita/gasto de um site (vai para Comissões)
  competence: YM.nullable().optional(),                     // mês de referência; vazio = mês da data
  revsharePct: z.number().min(0).max(99.999).nullable().optional(),   // receita SEM o revshare descontado: o dash desconta este %
}).refine((b) => b.kind === 'balance' || b.amount > 0, { message: 'O valor precisa ser maior que zero.', path: ['amount'] })
  .refine((b) => b.kind !== 'income' || (INCOME_CATEGORIES as readonly string[]).includes(b.category ?? ''), { message: 'Escolha de onde veio a receita.', path: ['category'] })
  .refine((b) => b.kind !== 'expense' || (EXPENSE_CATEGORIES as readonly string[]).includes(b.category ?? ''), { message: 'Escolha o tipo do gasto.', path: ['category'] });

const checkCash = async (req: Request) => {
  const b = parse(cashBody, req.body);
  await assertCompany(req, b.companyId);
  if (b.date > today()) throw new HttpError(422, 'future_date', 'A data não pode ser depois de hoje.');
  const flow = b.kind === 'income' || b.kind === 'expense';
  const site = flow && b.site ? normSite(b.site) : null;
  if (flow && b.site && !site) throw new HttpError(422, 'invalid_site', 'Site inválido. Use o domínio, ex.: dominiox.com');
  if (flow && b.competence && b.competence > b.date.slice(0, 7)) throw new HttpError(422, 'future_competence', 'O mês de referência não pode ser depois da data do lançamento.');
  // receita informada sem o desconto do parceiro: guarda o bruto e o %, e o caixa recebe o líquido
  const rs = b.kind === 'income' && b.revsharePct != null && b.amount > 0;
  const net = rs ? Math.round(b.amount * (1 - b.revsharePct! / 100) * 100) / 100 : b.amount;
  return { ...b, amount: net, grossAmount: rs ? b.amount : null, revsharePct: rs ? b.revsharePct! : null,
    category: flow ? b.category! : null, site, competence: flow && b.competence ? `${b.competence}-01` : null };
};
async function getEntry(req: Request) {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const e = await one<{ company_id: string }>('SELECT company_id::text FROM finance_cash_entries WHERE id = $1', [id]);
  if (!e) throw notFound('Lançamento não encontrado.');
  await assertCompany(req, e.company_id);
  return id;
}

financeRouter.post('/cash', async (req, res) => {
  const b = await checkCash(req);
  const r = await one<{ id: string }>(`INSERT INTO finance_cash_entries (company_id, date, kind, category, amount, currency, note, created_by, site, competence, gross_amount, revshare_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text`,
    [b.companyId, b.date, b.kind, b.category, b.amount, b.currency, b.note || null, req.user!.id, b.site, b.competence, b.grossAmount, b.revsharePct]);
  res.status(201).json({ id: r!.id, amount: b.amount, grossAmount: b.grossAmount, revsharePct: b.revsharePct });
});
financeRouter.put('/cash/:id', async (req, res) => {
  const id = await getEntry(req);
  const b = await checkCash(req);
  await q(`UPDATE finance_cash_entries SET company_id = $2, date = $3, kind = $4, category = $5, amount = $6, currency = $7, note = $8, site = $9, competence = $10, gross_amount = $11, revshare_pct = $12 WHERE id = $1`,
    [id, b.companyId, b.date, b.kind, b.category, b.amount, b.currency, b.note || null, b.site, b.competence, b.grossAmount, b.revsharePct]);
  res.json({ id });
});
financeRouter.delete('/cash/:id', async (req, res) => {
  const id = await getEntry(req);
  await q('DELETE FROM finance_cash_entries WHERE id = $1', [id]);
  res.status(204).end();
});

/* ---------- comprovantes (NF, recibo, fatura) de gastos, receitas e custos ---------- */
const MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const MAX_FILE = 10 * 1024 * 1024;
const attMeta = z.object({
  entryId: z.string().regex(/^\d+$/).optional(),
  costId: z.string().regex(/^\d+$/).optional(),
  month: YM.optional(),                                    // custo mensal: de qual mês é a NF
  amount: z.coerce.number().positive().max(1e10).optional(), // valor da NF, para conferir com o lançamento
  currency: CUR.optional(),
  docNumber: z.string().trim().max(60).optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).optional(),
}).refine((b) => !!b.entryId !== !!b.costId, { message: 'Informe o lançamento (entryId) ou o custo (costId).' });

/** Empresa dona do lançamento/custo + checagem de acesso. */
type AttOwner = { entryId?: string; costId?: string };
const ownerCol = (b: AttOwner) => (b.entryId ? 'entry_id' : 'cost_id');
const ownerId = (b: AttOwner) => b.entryId ?? b.costId;
async function ownerOf(req: Request, b: AttOwner) {
  const sql = b.entryId ? 'SELECT company_id::text FROM finance_cash_entries WHERE id = $1'
    : 'SELECT company_id::text FROM finance_costs WHERE id = $1';
  const r = await one<{ company_id: string }>(sql, [ownerId(b)]);
  if (!r) throw notFound(b.entryId ? 'Lançamento não encontrado.' : 'Custo não encontrado.');
  await assertCompany(req, r.company_id);
  return r.company_id;
}
const ATT_COLS = `a.id::text, a.kind, a.url, a.filename, a.mime, a.size, a.amount::float AS amount, a.currency, a.doc_number AS "docNumber", a.doc_date::text AS "docDate",
  to_char(a.month, 'YYYY-MM') AS month, a.note, a.entry_id::text AS "entryId", a.cost_id::text AS "costId",
  u.name AS "createdBy", a.created_at AS "createdAt"`;
const insertAtt = async (req: Request, cid: string, b: z.infer<typeof attMeta>, f: { kind: 'link' | 'file'; url?: string; filename?: string; mime?: string; size?: number; data?: Buffer }) => {
  const r = await one<{ id: string }>(`INSERT INTO finance_attachments (company_id, entry_id, cost_id, month, kind, url, filename, mime, size, data, amount, currency, doc_number, doc_date, note, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id::text`,
    [cid, b.entryId ?? null, b.costId ?? null, b.month ? `${b.month}-01` : null, f.kind, f.url ?? null, f.filename ?? null, f.mime ?? null, f.size ?? null, f.data ?? null,
      b.amount ?? null, b.amount ? b.currency ?? 'BRL' : null, b.docNumber || null, b.docDate ?? null, b.note || null, req.user!.id]);
  return one(`SELECT ${ATT_COLS} FROM finance_attachments a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`, [r!.id]);
};

financeRouter.get('/attachments', async (req, res) => {
  const b = parse(attMeta, req.query);
  await ownerOf(req, b);
  const rows = await q(`SELECT ${ATT_COLS} FROM finance_attachments a LEFT JOIN users u ON u.id = a.created_by
    WHERE a.${ownerCol(b)} = $1 ${b.month ? "AND (a.month IS NULL OR a.month = $2)" : ''} ORDER BY a.month DESC NULLS LAST, a.created_at DESC`,
    b.month ? [ownerId(b), `${b.month}-01`] : [ownerId(b)]);
  res.json({ attachments: rows });
});

/** Link (Google Drive ou outro https). */
financeRouter.post('/attachments', async (req, res) => {
  const b = parse(attMeta, req.body);
  const url = parse(z.string().trim().url('link inválido').max(1000).refine((u) => u.startsWith('https://'), 'Use um link https (ex.: do Google Drive).'), req.body?.url);
  const cid = await ownerOf(req, b);
  res.status(201).json(await insertAtt(req, cid, b, { kind: 'link', url }));
});

/** Arquivo (corpo cru). Exige client_max_body_size ≥ 11m no Nginx para esta rota. */
const rawFile = express.raw({ type: [...MIMES], limit: MAX_FILE });
/** Lê o arquivo; acima de 10 MB responde 413 com mensagem clara (em vez do erro genérico do body-parser). */
const readFile: express.RequestHandler = (req, res, next) => rawFile(req, res, (err?: unknown) => {
  if ((err as { type?: string } | undefined)?.type === 'entity.too.large') return next(new HttpError(413, 'file_too_large', 'Arquivo acima de 10 MB. Para arquivos maiores, use o link do Drive.'));
  next(err as Error | undefined);
});
financeRouter.post('/attachments/file', readFile, async (req, res) => {
  const b = parse(attMeta, req.query);
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!(MIMES as readonly string[]).includes(mime) || !Buffer.isBuffer(req.body)) throw new HttpError(415, 'unsupported_file', 'Envie um PDF, JPG ou PNG.');
  const data = req.body as Buffer;
  if (!data.length) throw new HttpError(422, 'empty_file', 'Arquivo vazio.');
  // confere a assinatura do arquivo (não confia só no Content-Type)
  const sig = data.subarray(0, 8);
  const okSig = mime === 'application/pdf' ? sig.subarray(0, 5).toString('latin1') === '%PDF-' : mime === 'image/png' ? sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : sig[0] === 0xff && sig[1] === 0xd8;
  if (!okSig) throw new HttpError(415, 'unsupported_file', 'O arquivo não parece ser um PDF, JPG ou PNG válido.');
  let filename = 'comprovante';
  try { filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'comprovante')); } catch { /* nome inválido: usa o padrão */ }
  filename = filename.replace(/[\\/\r\n"]+/g, '_').slice(0, 200) || 'comprovante';
  const cid = await ownerOf(req, b);
  res.status(201).json(await insertAtt(req, cid, b, { kind: 'file', filename, mime, size: data.length, data }));
});

financeRouter.get('/attachments/:id/file', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const a = await one<{ company_id: string; filename: string; mime: string; data: Buffer | null }>('SELECT company_id::text, filename, mime, data FROM finance_attachments WHERE id = $1 AND kind = \'file\'', [id]);
  if (!a || !a.data) throw notFound('Comprovante não encontrado.');
  await assertCompany(req, a.company_id);
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(a.data);
});

financeRouter.delete('/attachments/:id', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const a = await one<{ company_id: string }>('SELECT company_id::text FROM finance_attachments WHERE id = $1', [id]);
  if (!a) throw notFound('Comprovante não encontrado.');
  await assertCompany(req, a.company_id);
  await q('DELETE FROM finance_attachments WHERE id = $1', [id]);
  res.status(204).end();
});
