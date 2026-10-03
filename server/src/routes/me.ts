import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
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
