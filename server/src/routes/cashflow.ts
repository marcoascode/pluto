/**
 * 0.18.14 · Fluxo de caixa por faturas de cartão de crédito.
 * Montado em /cashflow atrás de requireCashflow (flag can_use_cashflow, atribuída só pelo SuperAdmin).
 * O fluxo de caixa é POR USUÁRIO: toda consulta filtra por req.user.id (id de outro usuário = 404).
 *
 *   GET    /cashflow/status
 *   GET    /cashflow/cards                POST /cashflow/cards           PUT/DELETE /cashflow/cards/:id
 *   GET    /cashflow/entries?month=YYYY-MM[&card=<id>|none]   lançamentos do mês (pela data da compra) + totais
 *   POST   /cashflow/entries              PUT/DELETE /cashflow/entries/:id
 *   GET    /cashflow/months?to=YYYY-MM&n=12                    totais mês a mês (despesas, créditos, líquido)
 *
 * Sinal dos valores (amount é sempre positivo no banco): purchase/fee/iof/interest somam como despesa,
 * refund subtrai (estorno/crédito) e payment (pagamento da fatura) fica fora das somas para não contar o gasto duas vezes.
 *
 * 0.18.16: faturas em PDF → routes/cashflowStatements.ts. Próxima etapa: agrupamento por origem/mês com regras do usuário.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { conflict, notFound, parse } from '../lib/http.js';
import { lastMonths, monthBounds, today } from '../lib/dates.js';
import { merchantKey } from '../services/cashflowMerchant.js';
import { cashflowStatementsRouter } from './cashflowStatements.js';

export const cashflowRouter = Router();
/** 0.18.16: faturas em PDF (upload, revisão, confirmação, retenção do PDF) — routes/cashflowStatements.ts */
cashflowRouter.use(cashflowStatementsRouter);

const ID = z.string().regex(/^\d+$/);
const YM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'data inválida');
const KINDS = ['purchase', 'refund', 'fee', 'iof', 'interest', 'payment'] as const;
const opt = (s: z.ZodString) => s.nullable().optional().transform((v) => (v ? v : null));

/** Valor com sinal para as somas (ver cabeçalho). */
const SIGNED = `CASE e.kind WHEN 'refund' THEN -e.amount WHEN 'payment' THEN 0 ELSE e.amount END`;
const uid = (req: Request) => req.user!.id;

/** Confirma que o módulo está liberado para o usuário (o middleware já respondeu 403 se não estiver). */
cashflowRouter.get('/status', (_req, res) => {
  res.json({ enabled: true });
});

/* ---------------- cartões ---------------- */
const cardBody = z.object({
  issuer: z.string().trim().min(1).max(60),
  nickname: opt(z.string().trim().max(60)),
  last4: z.string().regex(/^\d{4}$/, 'informe só os 4 últimos dígitos').nullable().optional().transform((v) => v ?? null),
});
const CARD_COLS = `c.id::text, c.issuer, c.nickname, c.last4, (SELECT count(*)::int FROM cashflow_entries e WHERE e.card_id = c.id) AS "entryCount"`;
const loadCard = (userId: string, id: string) => one(`SELECT ${CARD_COLS} FROM cashflow_cards c WHERE c.user_id = $1 AND c.id = $2`, [userId, id]);

cashflowRouter.get('/cards', async (req, res) => {
  res.json({ cards: await q(`SELECT ${CARD_COLS} FROM cashflow_cards c WHERE c.user_id = $1 ORDER BY lower(c.issuer), c.nickname NULLS FIRST, c.last4`, [uid(req)]) });
});

const saveCard = async (req: Request, id?: string) => {
  const b = parse(cardBody, req.body);
  try {
    const r = id
      ? await one<{ id: string }>(`UPDATE cashflow_cards SET issuer = $3, nickname = $4, last4 = $5, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING id::text`, [uid(req), id, b.issuer, b.nickname, b.last4])
      : await one<{ id: string }>(`INSERT INTO cashflow_cards (user_id, issuer, nickname, last4) VALUES ($1, $2, $3, $4) RETURNING id::text`, [uid(req), b.issuer, b.nickname, b.last4]);
    if (!r) throw notFound('Cartão não encontrado.');
    return loadCard(uid(req), r.id);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('card_exists', 'Você já tem um cartão com esse emissor, apelido e final.');
    throw e;
  }
};
cashflowRouter.post('/cards', async (req, res) => { res.status(201).json(await saveCard(req)); });
cashflowRouter.put('/cards/:id', async (req, res) => { res.json(await saveCard(req, parse(ID, req.params.id))); });
/** Os lançamentos do cartão continuam (ficam "sem cartão"). */
cashflowRouter.delete('/cards/:id', async (req, res) => {
  const r = await one('DELETE FROM cashflow_cards WHERE user_id = $1 AND id = $2 RETURNING id', [uid(req), parse(ID, req.params.id)]);
  if (!r) throw notFound('Cartão não encontrado.');
  res.status(204).end();
});

/* ---------------- lançamentos ---------------- */
const entryBody = z.object({
  date: DATE,
  description: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS),
  amount: z.number().positive().max(1e10).transform((v) => Math.round(v * 100) / 100),
  cardId: ID.nullable().optional().transform((v) => v ?? null),
  installmentN: z.number().int().min(1).max(99).nullable().optional().transform((v) => v ?? null),
  installmentTotal: z.number().int().min(1).max(99).nullable().optional().transform((v) => v ?? null),
  amountOriginal: z.number().positive().max(1e10).nullable().optional().transform((v) => v ?? null),
  currencyOriginal: z.string().regex(/^[A-Z]{3}$/).nullable().optional().transform((v) => v ?? null),
  category: opt(z.string().trim().max(60)),
  note: opt(z.string().trim().max(300)),
  excluded: z.boolean().optional().default(false),
}).refine((b) => (b.installmentN == null) === (b.installmentTotal == null) && (b.installmentN == null || b.installmentN <= b.installmentTotal!), { message: 'Parcela inválida: informe "n de N" com n ≤ N.', path: ['installmentN'] })
  .refine((b) => (b.amountOriginal == null) === (b.currencyOriginal == null), { message: 'Informe valor e moeda originais juntos.', path: ['amountOriginal'] });

const ENTRY_COLS = `e.id::text, e.date, e.description, e.description_raw AS "descriptionRaw", e.merchant_key AS "merchantKey", e.kind,
  e.amount, ${SIGNED} AS "signedAmount", e.amount_original AS "amountOriginal", e.currency_original AS "currencyOriginal",
  e.installment_n AS "installmentN", e.installment_total AS "installmentTotal", e.category, e.note, e.excluded, e.source,
  e.card_id::text AS "cardId", e.created_at AS "createdAt"`;

const assertCard = async (userId: string, cardId: string | null) => {
  if (cardId && !(await one('SELECT 1 FROM cashflow_cards WHERE user_id = $1 AND id = $2', [userId, cardId]))) throw notFound('Cartão não encontrado.');
};

cashflowRouter.get('/entries', async (req, res) => {
  const month = parse(YM, req.query.month ?? today().slice(0, 7));
  const [from, to] = monthBounds(month);
  const card = typeof req.query.card === 'string' && req.query.card ? req.query.card : null;
  if (card && card !== 'none') parse(ID, card);
  const params: unknown[] = [uid(req), from, to];
  let where = 'e.user_id = $1 AND e.date BETWEEN $2 AND $3';
  if (card === 'none') where += ' AND e.card_id IS NULL';
  else if (card) { params.push(card); where += ` AND e.card_id = $${params.length}`; }
  const entries = await q(`SELECT ${ENTRY_COLS} FROM cashflow_entries e WHERE ${where} ORDER BY e.date DESC, e.id DESC`, params);
  const t = await one(`SELECT
      COALESCE(sum(e.amount) FILTER (WHERE NOT e.excluded AND e.kind NOT IN ('refund', 'payment')), 0)::float AS expenses,
      COALESCE(sum(e.amount) FILTER (WHERE NOT e.excluded AND e.kind = 'refund'), 0)::float AS credits,
      COALESCE(sum(${SIGNED}) FILTER (WHERE NOT e.excluded), 0)::float AS net,
      COALESCE(sum(e.amount) FILTER (WHERE NOT e.excluded AND e.kind = 'payment'), 0)::float AS payments,
      count(*) FILTER (WHERE NOT e.excluded)::int AS count,
      count(*) FILTER (WHERE e.excluded)::int AS "excludedCount"
    FROM cashflow_entries e WHERE ${where}`, params);
  res.json({ month, entries, totals: t });
});

const saveEntry = async (req: Request, id?: string) => {
  const b = parse(entryBody, req.body);
  await assertCard(uid(req), b.cardId);
  const cols = [b.cardId, b.date, b.description, b.kind, b.amount, b.amountOriginal, b.currencyOriginal, b.installmentN, b.installmentTotal, b.category, b.note, b.excluded];
  // a origem vem do texto original da fatura quando houver (importados); nos manuais, da descrição
  const r = id
    ? await one<{ id: string }>(`UPDATE cashflow_entries SET card_id = $3, date = $4, description = $5, kind = $6, amount = $7, amount_original = $8, currency_original = $9,
          installment_n = $10, installment_total = $11, category = $12, note = $13, excluded = $14, merchant_key = $15, updated_at = now()
        WHERE user_id = $1 AND id = $2 RETURNING id::text`,
        [uid(req), id, ...cols, merchantKey((await one<{ raw: string | null }>('SELECT description_raw AS raw FROM cashflow_entries WHERE user_id = $1 AND id = $2', [uid(req), id]))?.raw ?? b.description)])
    : await one<{ id: string }>(`INSERT INTO cashflow_entries (user_id, card_id, date, description, kind, amount, amount_original, currency_original, installment_n, installment_total, category, note, excluded, merchant_key, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'manual') RETURNING id::text`,
        [uid(req), ...cols, merchantKey(b.description)]);
  if (!r) throw notFound('Lançamento não encontrado.');
  return one(`SELECT ${ENTRY_COLS} FROM cashflow_entries e WHERE e.id = $1`, [r.id]);
};
cashflowRouter.post('/entries', async (req, res) => { res.status(201).json(await saveEntry(req)); });
cashflowRouter.put('/entries/:id', async (req, res) => { res.json(await saveEntry(req, parse(ID, req.params.id))); });
cashflowRouter.delete('/entries/:id', async (req, res) => {
  const r = await one('DELETE FROM cashflow_entries WHERE user_id = $1 AND id = $2 RETURNING id', [uid(req), parse(ID, req.params.id)]);
  if (!r) throw notFound('Lançamento não encontrado.');
  res.status(204).end();
});

/* ---------------- totais mês a mês ---------------- */
cashflowRouter.get('/months', async (req, res) => {
  const to = parse(YM, req.query.to ?? today().slice(0, 7));
  const n = parse(z.coerce.number().int().min(1).max(36), req.query.n ?? 12);
  const months = lastMonths(n, monthBounds(to)[1]).reverse();          // do mais antigo ao mais recente
  const rows = await q<{ month: string; expenses: number; credits: number; net: number; count: number }>(`
    SELECT to_char(date_trunc('month', e.date), 'YYYY-MM') AS month,
           COALESCE(sum(e.amount) FILTER (WHERE e.kind NOT IN ('refund', 'payment')), 0)::float AS expenses,
           COALESCE(sum(e.amount) FILTER (WHERE e.kind = 'refund'), 0)::float AS credits,
           COALESCE(sum(${SIGNED}), 0)::float AS net, count(*)::int AS count
      FROM cashflow_entries e
     WHERE e.user_id = $1 AND NOT e.excluded AND e.date BETWEEN $2 AND $3
     GROUP BY 1`, [uid(req), monthBounds(months[0])[0], monthBounds(to)[1]]);
  const by = new Map(rows.map((r) => [r.month, r]));
  res.json({ months: months.map((m) => by.get(m) ?? { month: m, expenses: 0, credits: 0, net: 0, count: 0 }) });
});
