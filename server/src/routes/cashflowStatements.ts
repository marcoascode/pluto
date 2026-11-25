/**
 * 0.18.16 · Fluxo de caixa — faturas de cartão em PDF. Montado dentro do cashflowRouter (já atrás de requireCashflow).
 * Tudo por usuário: toda consulta filtra por req.user.id (fatura de outro usuário = 404).
 *
 *   POST   /cashflow/statements                 multipart: pdf (até 10 MB), password?, retentionDays (7|30|60|90|365|never), cardId?
 *          PDF em memória → texto → dados pessoais mascarados → Claude → fatura em 'review' (nada entra no caixa ainda)
 *   GET    /cashflow/statements                 lista
 *   GET    /cashflow/statements/:id             detalhe para a revisão (lançamentos lidos + os que já existem no caixa)
 *   POST   /cashflow/statements/:id/confirm     { cardId, items[] } grava os lançamentos marcados (sem duplicar)
 *   PUT    /cashflow/statements/:id/retention   { retentionDays } muda quando o PDF é apagado
 *   GET    /cashflow/statements/:id/pdf         abre o PDF guardado
 *   DELETE /cashflow/statements/:id/pdf         apaga só o PDF (fatura e lançamentos ficam)
 *   DELETE /cashflow/statements/:id             apaga a fatura, o PDF e os lançamentos que vieram dela
 */
import { createHash } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { conflict, HttpError, notFound, parse } from '../lib/http.js';
import { pdfLines } from '../services/cashflowPdf.js';
import { maskPersonalData, type MaskCounts } from '../services/cashflowMask.js';
import { fingerprints, KINDS, parseStatement, signedSum, type StatementItem } from '../services/cashflowParser.js';
import { merchantKey } from '../services/cashflowMerchant.js';
import { purgeExpiredPdfs } from '../services/cashflowRetention.js';

export const cashflowStatementsRouter = Router();

const ID = z.string().regex(/^\d+$/);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 200_000;
const RETENTION = ['7', '30', '60', '90', '365', 'never'] as const;
const retentionDays = (v: (typeof RETENTION)[number]) => (v === 'never' ? null : Number(v));
const uid = (req: Request) => req.user!.id;

interface Extraction { items: StatementItem[]; warnings: string[]; maskCounts: MaskCounts; dropped: number }
interface Row {
  id: string; status: 'review' | 'confirmed'; filename: string; size: number; pages: number | null; cardId: string | null;
  issuer: string | null; cardLast4: string | null; closingDate: string | null; dueDate: string | null; totalAmount: number | null;
  extraction: Extraction; hasPdf: boolean; pdfRetentionDays: number | null; pdfPurgeAt: string | null; pdfPurgedAt: string | null;
  model: string | null; inputTokens: number | null; outputTokens: number | null; createdAt: string; confirmedAt: string | null; entryCount: number;
}
const COLS = `s.id::text, s.status, s.filename, s.size, s.pages, s.card_id::text AS "cardId", s.issuer, s.card_last4 AS "cardLast4",
  s.closing_date AS "closingDate", s.due_date AS "dueDate", s.total_amount AS "totalAmount", s.extraction,
  (s.pdf_data IS NOT NULL) AS "hasPdf", s.pdf_retention_days AS "pdfRetentionDays", s.pdf_purge_at AS "pdfPurgeAt", s.pdf_purged_at AS "pdfPurgedAt",
  s.model, s.input_tokens AS "inputTokens", s.output_tokens AS "outputTokens", s.created_at AS "createdAt", s.confirmed_at AS "confirmedAt",
  (SELECT count(*)::int FROM cashflow_entries e WHERE e.statement_id = s.id) AS "entryCount"`;

const load = async (userId: string, id: string) => {
  const r = await one<Row>(`SELECT ${COLS} FROM cashflow_statements s WHERE s.user_id = $1 AND s.id = $2`, [userId, id]);
  if (!r) throw notFound('Fatura não encontrada.');
  return r;
};

/** Chave do cartão no fingerprint: o final do cartão (do cadastro ou o lido na fatura) — não muda se o cartão for trocado/recriado. */
const cardKeyOf = async (userId: string, cardId: string | null, detectedLast4: string | null) => {
  const c = cardId ? await one<{ last4: string | null }>('SELECT last4 FROM cashflow_cards WHERE user_id = $1 AND id = $2', [userId, cardId]) : null;
  if (cardId && !c) throw notFound('Cartão não encontrado.');
  return c?.last4 ? `final:${c.last4}` : detectedLast4 ? `final:${detectedLast4}` : cardId ? `card:${cardId}` : 'none';
};

/** Lista resumida (sem os lançamentos). */
const summary = ({ extraction, ...r }: Row) => ({
  ...r, itemCount: extraction.items.length, extractedSum: signedSum(extraction.items),
});

/** Detalhe para a revisão: cada lançamento lido + se ele já está no caixa (vindo de outra fatura). */
async function detail(userId: string, r: Row) {
  const fps = fingerprints(userId, await cardKeyOf(userId, r.cardId, r.cardLast4), r.extraction.items);
  const dup = new Set((await q<{ fp: Buffer }>(
    'SELECT fingerprint AS fp FROM cashflow_entries WHERE user_id = $1 AND fingerprint = ANY($2) AND statement_id IS DISTINCT FROM $3', [userId, fps, r.id],
  )).map((x) => x.fp.toString('hex')));
  return {
    ...summary(r),
    warnings: r.extraction.warnings, maskCounts: r.extraction.maskCounts,
    items: r.extraction.items.map((it, i) => ({ ...it, merchantKey: merchantKey(it.description), duplicate: dup.has(fps[i].toString('hex')) })),
  };
}

/* ---------------- upload ---------------- */
const uploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => `cf:${req.user?.id ?? 'anon'}`, validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Muitas faturas enviadas na última hora. Aguarde um pouco.' } }); } });

// memória, nunca disco: o buffer vai para o extrator de texto e para o banco
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_BYTES, fields: 5, parts: 6 } }).single('pdf');
const runUpload = (req: Request, res: Response, next: NextFunction) => upload(req, res, (err: unknown) => {
  if (err instanceof multer.MulterError) {
    return next(err.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'file_too_large', 'O PDF passa de 10 MB.') : new HttpError(400, 'bad_upload', 'Envie um único arquivo PDF no campo "pdf".'));
  }
  next(err as Error | undefined);
});

const uploadBody = z.object({
  password: z.string().max(100).optional().transform((v) => v || null),
  retentionDays: z.enum(RETENTION),
  cardId: z.string().optional().transform((v) => v || null).pipe(ID.nullable()),
});

cashflowStatementsRouter.post('/statements', uploadLimiter, runUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'no_file', 'Envie o PDF da fatura.');
  const b = parse(uploadBody, req.body ?? {});
  const userId = uid(req);
  if (b.cardId && !(await one('SELECT 1 FROM cashflow_cards WHERE user_id = $1 AND id = $2', [userId, b.cardId]))) throw notFound('Cartão não encontrado.');

  const sha = createHash('sha256').update(file.buffer).digest();
  const prev = await one<{ id: string }>('SELECT id::text FROM cashflow_statements WHERE user_id = $1 AND file_sha256 = $2', [userId, sha]);
  if (prev) throw new HttpError(409, 'statement_exists', `Esta fatura já foi enviada (fatura nº ${prev.id}).`);

  const { pages, lines } = await pdfLines(file.buffer, b.password);
  const masked = maskPersonalData(lines, [req.user!.name]);
  if (masked.text.length > MAX_TEXT) throw new HttpError(422, 'pdf_too_long', 'A fatura tem texto demais para ser lida de uma vez.');
  const parsed = await parseStatement(masked.text);

  // cartão: o escolhido no envio ou, se não houver, o único cadastrado com o mesmo final
  let cardId = b.cardId;
  if (!cardId && parsed.cardLast4) {
    const m = await q<{ id: string }>('SELECT id::text FROM cashflow_cards WHERE user_id = $1 AND last4 = $2', [userId, parsed.cardLast4]);
    if (m.length === 1) cardId = m[0].id;
  }
  const warnings = [...parsed.warnings];
  if (parsed.totalAmount != null) {
    const diff = Math.round((signedSum(parsed.items) - parsed.totalAmount) * 100) / 100;
    if (Math.abs(diff) >= 0.01) warnings.push(`A soma dos lançamentos lidos difere do total da fatura em ${diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Pode ser saldo anterior, pagamento parcial ou uma linha não lida — confira antes de confirmar.`);
  }
  const extraction: Extraction = { items: parsed.items, warnings, maskCounts: masked.counts, dropped: parsed.dropped };
  const days = retentionDays(b.retentionDays);
  const filename = (file.originalname || 'fatura.pdf').replace(/[\r\n"]/g, '').slice(0, 200) || 'fatura.pdf';
  let r: { id: string } | null;
  try {
    r = await one<{ id: string }>(`INSERT INTO cashflow_statements (user_id, card_id, filename, size, pages, file_sha256, pdf_data, pdf_retention_days, pdf_purge_at,
        issuer, card_last4, closing_date, due_date, total_amount, extraction, model, input_tokens, output_tokens)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::smallint, CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(days => $8::int) END,
        $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id::text`,
      [userId, cardId, filename, file.size, pages, sha, file.buffer, days, parsed.issuer, parsed.cardLast4, parsed.closingDate, parsed.dueDate, parsed.totalAmount,
        JSON.stringify(extraction), parsed.model, parsed.usage.inputTokens, parsed.usage.outputTokens]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('statement_exists', 'Esta fatura já foi enviada.');
    throw e;
  }
  res.status(201).json(await detail(userId, await load(userId, r!.id)));
});

/* ---------------- consulta ---------------- */
cashflowStatementsRouter.get('/statements', async (req, res) => {
  const rows = await q<Row>(`SELECT ${COLS} FROM cashflow_statements s WHERE s.user_id = $1 ORDER BY COALESCE(s.closing_date, s.created_at::date) DESC, s.id DESC`, [uid(req)]);
  res.json({ statements: rows.map(summary) });
});
cashflowStatementsRouter.get('/statements/:id', async (req, res) => {
  res.json(await detail(uid(req), await load(uid(req), parse(ID, req.params.id))));
});

/* ---------------- confirmação ---------------- */
const confirmItem = z.object({
  include: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'data inválida'),
  description: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS),
  amount: z.number().positive().max(1e10).transform((v) => Math.round(v * 100) / 100),
  category: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
});
const confirmBody = z.object({ cardId: ID.nullable(), items: z.array(confirmItem).max(2000) });

cashflowStatementsRouter.post('/statements/:id/confirm', async (req, res) => {
  const userId = uid(req);
  const s = await load(userId, parse(ID, req.params.id));
  if (s.status !== 'review') throw conflict('already_confirmed', 'Esta fatura já foi confirmada.');
  const b = parse(confirmBody, req.body);
  const orig = s.extraction.items;
  if (b.items.length !== orig.length) throw new HttpError(422, 'items_mismatch', 'A lista de lançamentos não confere com a fatura. Recarregue a revisão.');
  // fingerprint pelo lançamento ORIGINAL (mesma fatura enviada de novo cai nos mesmos, mesmo com edições na revisão)
  const fps = fingerprints(userId, await cardKeyOf(userId, b.cardId, s.cardLast4), orig);

  const result = await tx(async (c) => {
    let inserted = 0, duplicates = 0;
    const items: StatementItem[] = orig.map((o, i) => ({ ...o, date: b.items[i].date, description: b.items[i].description, kind: b.items[i].kind, amount: b.items[i].amount }));
    for (let i = 0; i < orig.length; i++) {
      const e = b.items[i], o = orig[i];
      if (!e.include) continue;
      const r = await c.query(`INSERT INTO cashflow_entries (user_id, card_id, statement_id, date, description, description_raw, merchant_key, kind, amount,
            amount_original, currency_original, installment_n, installment_total, category, source, fingerprint)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'import', $15)
          ON CONFLICT (user_id, fingerprint) WHERE fingerprint IS NOT NULL DO NOTHING`,
        [userId, b.cardId, s.id, e.date, e.description, o.description.slice(0, 300), merchantKey(o.description), e.kind, e.amount,
          o.amountOriginal, o.currencyOriginal, o.installmentN, o.installmentTotal, e.category, fps[i]]);
      if (r.rowCount) inserted++; else duplicates++;
    }
    await c.query(`UPDATE cashflow_statements SET status = 'confirmed', confirmed_at = now(), card_id = $3, extraction = jsonb_set(extraction, '{items}', $4::jsonb)
      WHERE user_id = $1 AND id = $2`, [userId, s.id, b.cardId, JSON.stringify(items)]);
    return { inserted, duplicates };
  });
  res.json({ ...result, statement: summary(await load(userId, s.id)) });
});

/* ---------------- PDF guardado ---------------- */
const retentionBody = z.object({ retentionDays: z.union([z.literal(7), z.literal(30), z.literal(60), z.literal(90), z.literal(365), z.null()]) });
cashflowStatementsRouter.put('/statements/:id/retention', async (req, res) => {
  const userId = uid(req), id = parse(ID, req.params.id);
  const b = parse(retentionBody, req.body);
  const s = await load(userId, id);
  if (!s.hasPdf) throw conflict('pdf_gone', 'O PDF desta fatura já foi apagado.');
  // o prazo conta a partir do envio; se já venceu, o PDF é apagado agora
  await q(`UPDATE cashflow_statements SET pdf_retention_days = $3::smallint,
      pdf_purge_at = CASE WHEN $3::int IS NULL THEN NULL ELSE created_at + make_interval(days => $3::int) END WHERE user_id = $1 AND id = $2`, [userId, id, b.retentionDays]);
  await purgeExpiredPdfs();
  res.json(summary(await load(userId, id)));
});

cashflowStatementsRouter.get('/statements/:id/pdf', async (req, res) => {
  const a = await one<{ filename: string; data: Buffer | null }>('SELECT filename, pdf_data AS data FROM cashflow_statements WHERE user_id = $1 AND id = $2', [uid(req), parse(ID, req.params.id)]);
  if (!a) throw notFound('Fatura não encontrada.');
  if (!a.data) throw new HttpError(410, 'pdf_gone', 'O PDF desta fatura já foi apagado (prazo de retenção ou exclusão manual).');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(a.data);
});

cashflowStatementsRouter.delete('/statements/:id/pdf', async (req, res) => {
  const r = await one(`UPDATE cashflow_statements SET pdf_data = NULL, pdf_purged_at = now() WHERE user_id = $1 AND id = $2 AND pdf_data IS NOT NULL RETURNING id`, [uid(req), parse(ID, req.params.id)]);
  if (!r) throw notFound('PDF não encontrado.');
  res.status(204).end();
});

cashflowStatementsRouter.delete('/statements/:id', async (req, res) => {
  const r = await one('DELETE FROM cashflow_statements WHERE user_id = $1 AND id = $2 RETURNING id', [uid(req), parse(ID, req.params.id)]);
  if (!r) throw notFound('Fatura não encontrada.');
  res.status(204).end();
});
