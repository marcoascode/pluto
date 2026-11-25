/**
 * 0.18.17 · Fluxo de caixa — soma mensal por origem e regras de origem. Montado dentro do cashflowRouter (atrás de requireCashflow).
 * Tudo por usuário: toda consulta filtra por req.user.id.
 *
 *   GET    /cashflow/origins?month=YYYY-MM[&card=<id>|none]
 *          despesas do mês (pela data da compra) somadas por origem, juntando faturas e cartões diferentes;
 *          cada origem traz os lançamentos, quantas faturas/cartões somou e o total do mês anterior.
 *          Fora da soma: lançamentos marcados "fora das somas" e pagamentos de fatura. Estornos subtraem.
 *   GET    /cashflow/rules            POST /cashflow/rules          PUT/DELETE /cashflow/rules/:id
 *          { match: key|starts|contains, pattern, name, category? } — ex.: key FACEBK → "Facebook Ads (campanhas)"
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { conflict, notFound, parse } from '../lib/http.js';
import { monthBounds, today } from '../lib/dates.js';
import { normText, ruleFor, sortRules, type MerchantRule } from '../services/cashflowMerchant.js';

export const cashflowOriginsRouter = Router();

const ID = z.string().regex(/^\d+$/);
const YM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const uid = (req: Request) => req.user!.id;
const shiftMonth = (ym: string, d: number) => { const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const round2 = (v: number) => Math.round(v * 100) / 100;

const loadRules = (userId: string) => q<MerchantRule>(`SELECT id::text, match, pattern, name, category FROM cashflow_merchant_rules WHERE user_id = $1`, [userId]);

/* ---------------- soma por origem ---------------- */
interface EntryRow {
  id: string; date: string; description: string; descriptionRaw: string | null; merchantKey: string; kind: string; amount: number;
  cardId: string | null; statementId: string | null; statementFilename: string | null; category: string | null;
  installmentN: number | null; installmentTotal: number | null;
}

cashflowOriginsRouter.get('/origins', async (req, res) => {
  const userId = uid(req);
  const month = parse(YM, req.query.month ?? today().slice(0, 7));
  const prev = shiftMonth(month, -1);
  const card = typeof req.query.card === 'string' && req.query.card ? req.query.card : null;
  if (card && card !== 'none') parse(ID, card);
  const params: unknown[] = [userId, monthBounds(prev)[0], monthBounds(month)[1]];
  let where = `e.user_id = $1 AND e.date BETWEEN $2 AND $3 AND NOT e.excluded AND e.kind <> 'payment'`;
  if (card === 'none') where += ' AND e.card_id IS NULL';
  else if (card) { params.push(card); where += ` AND e.card_id = $${params.length}`; }
  const rows = await q<EntryRow>(`SELECT e.id::text, e.date, e.description, e.description_raw AS "descriptionRaw", e.merchant_key AS "merchantKey", e.kind, e.amount,
      e.card_id::text AS "cardId", e.statement_id::text AS "statementId", s.filename AS "statementFilename", e.category,
      e.installment_n AS "installmentN", e.installment_total AS "installmentTotal"
    FROM cashflow_entries e LEFT JOIN cashflow_statements s ON s.id = e.statement_id
    WHERE ${where} ORDER BY e.date, e.id`, params);
  const rules = sortRules(await loadRules(userId));

  type Group = {
    key: string; name: string; ruleId: string | null; rule: { match: string; pattern: string } | null; category: string | null;
    merchantKeys: Set<string>; total: number; expenses: number; credits: number; count: number; prevTotal: number;
    statements: Map<string, string>; cards: Set<string>; manualCount: number; entries: (EntryRow & { signedAmount: number })[];
  };
  const groups = new Map<string, Group>();
  for (const e of rows) {
    const r = ruleFor(rules, e.merchantKey, e.descriptionRaw ?? e.description);
    const key = r ? `rule:${r.id}` : `key:${e.merchantKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r?.name ?? e.merchantKey, ruleId: r?.id ?? null, rule: r ? { match: r.match, pattern: r.pattern } : null, category: r?.category ?? null,
        merchantKeys: new Set(), total: 0, expenses: 0, credits: 0, count: 0, prevTotal: 0, statements: new Map(), cards: new Set(), manualCount: 0, entries: [] };
      groups.set(key, g);
    }
    const signed = e.kind === 'refund' ? -e.amount : e.amount;
    if (e.date.slice(0, 7) !== month) { g.prevTotal += signed; continue; }
    g.merchantKeys.add(e.merchantKey);
    g.total += signed;
    if (e.kind === 'refund') g.credits += e.amount; else g.expenses += e.amount;
    g.count++;
    if (e.statementId) g.statements.set(e.statementId, e.statementFilename ?? `fatura ${e.statementId}`); else g.manualCount++;
    if (e.cardId) g.cards.add(e.cardId);
    g.entries.push({ ...e, signedAmount: signed });
  }
  const out = [...groups.values()].filter((g) => g.count > 0).map((g) => ({
    key: g.key, name: g.name, ruleId: g.ruleId, rule: g.rule, category: g.category, merchantKeys: [...g.merchantKeys].sort(),
    total: round2(g.total), expenses: round2(g.expenses), credits: round2(g.credits), count: g.count, prevTotal: round2(g.prevTotal),
    statements: [...g.statements].map(([id, filename]) => ({ id, filename })), cardIds: [...g.cards], manualCount: g.manualCount,
    entries: g.entries.map(({ descriptionRaw: _r, statementFilename: _f, ...e }) => e),
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = round2(out.reduce((a, g) => a + g.total, 0));
  res.json({
    month, total, prevTotal: round2([...groups.values()].reduce((a, g) => a + g.prevTotal, 0)),
    groupCount: out.length,
    multiSourceCount: out.filter((g) => g.statements.length + (g.manualCount ? 1 : 0) > 1 || g.cardIds.length > 1).length,
    groups: out,
  });
});

/* ---------------- regras de origem ---------------- */
const ruleBody = z.object({
  match: z.enum(['key', 'starts', 'contains']),
  pattern: z.string().transform(normText).pipe(z.string().min(2, 'O padrão precisa de 2 caracteres ou mais.').max(120)),
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
});

/** Regras + quantos lançamentos (de todos os meses) cada uma pega hoje. */
cashflowOriginsRouter.get('/rules', async (req, res) => {
  const userId = uid(req);
  const rules = sortRules(await loadRules(userId));
  const combos = await q<{ key: string; description: string; n: number }>(`SELECT merchant_key AS key, COALESCE(description_raw, description) AS description, count(*)::int AS n
    FROM cashflow_entries WHERE user_id = $1 GROUP BY 1, 2`, [userId]);
  const hits = new Map<string, number>();
  for (const c of combos) { const r = ruleFor(rules, c.key, c.description); if (r) hits.set(r.id, (hits.get(r.id) ?? 0) + c.n); }
  res.json({ rules: rules.map((r) => ({ ...r, matches: hits.get(r.id) ?? 0 })) });
});

const saveRule = async (req: Request, id?: string) => {
  const b = parse(ruleBody, req.body);
  try {
    const r = id
      ? await one<{ id: string }>(`UPDATE cashflow_merchant_rules SET match = $3, pattern = $4, name = $5, category = $6, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING id::text`, [uid(req), id, b.match, b.pattern, b.name, b.category])
      : await one<{ id: string }>(`INSERT INTO cashflow_merchant_rules (user_id, match, pattern, name, category) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, [uid(req), b.match, b.pattern, b.name, b.category]);
    if (!r) throw notFound('Regra não encontrada.');
    return one(`SELECT id::text, match, pattern, name, category FROM cashflow_merchant_rules WHERE id = $1`, [r.id]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('rule_exists', 'Já existe uma regra com esse tipo e padrão.');
    throw e;
  }
};
cashflowOriginsRouter.post('/rules', async (req, res) => { res.status(201).json(await saveRule(req)); });
cashflowOriginsRouter.put('/rules/:id', async (req, res) => { res.json(await saveRule(req, parse(ID, req.params.id))); });
cashflowOriginsRouter.delete('/rules/:id', async (req, res) => {
  const r = await one('DELETE FROM cashflow_merchant_rules WHERE user_id = $1 AND id = $2 RETURNING id', [uid(req), parse(ID, req.params.id)]);
  if (!r) throw notFound('Regra não encontrada.');
  res.status(204).end();
});
