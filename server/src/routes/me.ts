import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { payoutOut, type PayoutRow } from '../services/payout.js';
import { parse } from '../lib/http.js';
import { allowedDomains } from '../auth/scope.js';

export const meRouter = Router();

meRouter.get('/domains', async (req, res) => { res.json({ domains: (await allowedDomains(req)).hosts }); });

meRouter.get('/preferences', async (req, res) => {
  const r = await one<{ preferences: object }>('SELECT preferences FROM users WHERE id = $1', [req.user!.id]);
  res.json(r?.preferences ?? {});
});

// Preferências são livres (métricas escolhidas, densidade…), mas com limite de tamanho.
meRouter.put('/preferences', async (req, res) => {
  const b = parse(z.record(z.string(), z.unknown()), req.body);
  if (JSON.stringify(b).length > 20_000) return res.status(413).json({ error: { code: 'too_large', message: 'Preferências grandes demais.' } });
  const r = await one<{ preferences: object }>('UPDATE users SET preferences = $2::jsonb WHERE id = $1 RETURNING preferences', [req.user!.id, JSON.stringify(b)]);
  res.json(r?.preferences ?? {});
});

/* ---------- 0.18.13 · meio de recebimento da comissão (cada usuário edita o próprio) ---------- */
const PAYOUT_COLS = 'payout_method, payout_method_other, payout_key';
meRouter.get('/payout', async (req, res) => {
  res.json(payoutOut(await one<PayoutRow>(`SELECT ${PAYOUT_COLS} FROM users WHERE id = $1`, [req.user!.id])));
});

const payoutBody = z.object({
  method: z.enum(['pix', 'dolafy', 'other']).nullable(),
  methodOther: z.string().trim().max(60).nullable().optional(),
  key: z.string().trim().max(200).nullable().optional(),
}).superRefine((b, ctx) => {
  if (!b.method) return;
  if (b.method === 'other' && !(b.methodOther ?? '')) ctx.addIssue({ code: 'custom', path: ['methodOther'], message: 'Informe qual é o meio de recebimento.' });
  if (!(b.key ?? '')) ctx.addIssue({ code: 'custom', path: ['key'], message: 'Informe a identificação para recebimento (chave PIX, @ Dolafy ou outra).' });
});
meRouter.put('/payout', async (req, res) => {
  const b = parse(payoutBody, req.body);
  const r = await one<PayoutRow>(
    `UPDATE users SET payout_method = $2, payout_method_other = $3, payout_key = $4, updated_at = now() WHERE id = $1 RETURNING ${PAYOUT_COLS}`,
    [req.user!.id, b.method, b.method === 'other' ? b.methodOther : null, b.method ? b.key : null]);
  res.json(payoutOut(r));
});
