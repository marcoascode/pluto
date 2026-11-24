import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../../db.js';
import { conflict, notFound, parse } from '../../lib/http.js';
import { today } from '../../lib/dates.js';
import { config } from '../../config.js';
import { decrypt, encrypt } from '../../lib/crypto.js';

export const domainsRouter = Router();

const HOST = z.string().trim().toLowerCase().transform((v) => v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'domínio inválido').max(190));

/** "Hoje" no fuso da organização (o banco pode estar em UTC). */
const TODAY_SQL = `(now() AT TIME ZONE '${config.appTz.replace(/[^A-Za-z0-9_/+-]/g, '')}')::date`;
const DOMAIN_SQL = `
  SELECT d.hostname, d.active, d.is_technical AS technical, sd.squad_id::text AS "squadId", d.last_data_at AS "lastDataAt", d.created_by_sync AS "createdBySync",
         COALESCE((SELECT round(rs.rev_share * 100, 3) FROM domain_rev_shares rs WHERE rs.domain_id = d.id AND rs.valid_from <= ${TODAY_SQL} ORDER BY rs.valid_from DESC LIMIT 1), 0)::float AS "revShare",
         (SELECT rs.valid_from::text FROM domain_rev_shares rs WHERE rs.domain_id = d.id AND rs.valid_from <= ${TODAY_SQL} ORDER BY rs.valid_from DESC LIMIT 1) AS "revShareFrom",
         COALESCE(array_agg(a.id::text ORDER BY a.name) FILTER (WHERE a.provider = 'google-ads'), '{}') AS "googleAccounts",
         COALESCE(array_agg(a.id::text ORDER BY a.name) FILTER (WHERE a.provider = 'meta'), '{}') AS "metaAccounts",
         d.gam_account_id::text AS "gamAccountId",
         d.registrar, d.expires_on::text AS "expiresOn", d.hosting, d.wp_user AS "wpUser", (d.wp_password_enc IS NOT NULL) AS "hasWpPassword",
         d.wp_updated_at AS "wpUpdatedAt",
         COALESCE((SELECT json_agg(json_build_object('userId', u.id::text, 'name', u.name, 'sharePct', dm.share_pct::float,
             'googleAccounts', COALESCE((SELECT array_agg(x.account_id::text) FROM domain_manager_accounts x JOIN integration_accounts ia ON ia.id = x.account_id WHERE x.domain_id = dm.domain_id AND x.user_id = dm.user_id AND ia.provider = 'google-ads'), '{}'),
             'metaAccounts',   COALESCE((SELECT array_agg(x.account_id::text) FROM domain_manager_accounts x JOIN integration_accounts ia ON ia.id = x.account_id WHERE x.domain_id = dm.domain_id AND x.user_id = dm.user_id AND ia.provider = 'meta'), '{}')
           ) ORDER BY u.name) FROM domain_managers dm JOIN users u ON u.id = dm.user_id WHERE dm.domain_id = d.id), '[]'::json) AS "managers"
    FROM domains d
    LEFT JOIN squad_domains sd ON sd.domain_id = d.id
    LEFT JOIN domain_accounts da ON da.domain_id = d.id
    LEFT JOIN integration_accounts a ON a.id = da.account_id`;
const GROUP = ' GROUP BY d.id, sd.squad_id';
/* Gestores do domínio (e as contas de cada um) são editados em Usuários → gestor → Domínios.
   0.18.8: googleAccounts/metaAccounts = contas que os gestores usam no domínio (só leitura aqui). */
const get = (host: string) => one(`${DOMAIN_SQL} WHERE d.hostname = $1${GROUP}`, [host]);

/** O domínio técnico "Sem domínio" é do sistema: não se edita, renomeia, liga nem exclui. */
async function rejectTechnical(host: string) {
  if (await one('SELECT 1 FROM domains WHERE hostname = $1 AND is_technical', [String(host).toLowerCase()]))
    throw conflict('technical_domain', 'O domínio técnico "Sem domínio" é do sistema e não pode ser alterado. Para tirar campanhas dele, defina o domínio da campanha.');
}

domainsRouter.get('/domains', async (_req, res) => { res.json({ domains: await q(`${DOMAIN_SQL}${GROUP} ORDER BY d.is_technical, d.active DESC, d.hostname`) }); });

const revShare = z.number().min(0).max(99.999);   // percentual (20 = 20%)
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

/** Grava o revShare vigente a partir de uma data (histórico em domain_rev_shares). */
async function setRevShare(c: Parameters<Parameters<typeof tx>[0]>[0], domainId: string, pct: number, from: string, userId: string) {
  await c.query(`INSERT INTO domain_rev_shares (domain_id, valid_from, rev_share, created_by) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (domain_id, valid_from) DO UPDATE SET rev_share = EXCLUDED.rev_share, created_by = EXCLUDED.created_by, created_at = now()`,
    [domainId, from, pct / 100, userId]);
}

domainsRouter.post('/domains', async (req, res) => {
  const b = parse(z.object({ hostname: HOST, revShare: revShare.optional() }), req.body);
  const existing = await one<{ id: string; created_by_sync: boolean }>('SELECT id::text, created_by_sync FROM domains WHERE hostname = $1', [b.hostname]);
  if (existing && !existing.created_by_sync) throw conflict('domain_exists', 'Esse domínio já está cadastrado.');
  await tx(async (c) => {
    // site que o Ad Manager já tinha mostrado: só ativa o registro que o sync criou
    const id = existing
      ? (await c.query(`UPDATE domains SET active = true, created_by_sync = false WHERE id = $1 RETURNING id::text`, [existing.id])).rows[0].id
      : (await c.query(`INSERT INTO domains (hostname) VALUES ($1) RETURNING id::text`, [b.hostname])).rows[0].id;
    if (b.revShare !== undefined) await setRevShare(c, id, b.revShare, '2000-01-01', req.user!.id);
  });
  res.status(201).json(await get(b.hostname));
});

domainsRouter.patch('/domains/:hostname', async (req, res) => {
  await rejectTechnical(req.params.hostname);
  const host = parse(HOST, req.params.hostname);
  const b = parse(z.object({
    hostname: HOST.optional(), active: z.boolean().optional(), squadId: z.string().regex(/^\d+$/).nullable().optional(),
    revShare: revShare.optional(), revShareFrom: ISO.optional(),
    gamAccountId: z.string().regex(/^\d+$/).nullable().optional(),   // um domínio = uma conta do Ad Manager
    // 0.17: registro do domínio
    registrar: z.string().trim().max(120).nullable().optional(), expiresOn: ISO.nullable().optional(),
    hosting: z.string().trim().max(160).nullable().optional(), wpUser: z.string().trim().max(160).nullable().optional(),
    wpPassword: z.string().max(300).nullable().optional(),   // texto = troca · null = apaga · ausente = mantém
    // 0.18.9: rateio da receita do domínio entre os gestores (todos os gestores atuais, soma = 100%; null = dividir igualmente)
    managerShares: z.array(z.object({ userId: z.string().regex(/^\d+$/), sharePct: z.number().gt(0).max(100) })).max(50).nullable().optional(),
  }), req.body);
  const d = await one<{ id: string }>('SELECT id::text FROM domains WHERE hostname = $1', [host]);
  if (!d) throw notFound('Domínio não encontrado.');
  await tx(async (c) => {
    if (b.hostname && b.hostname !== host) {
      if (await one('SELECT 1 FROM domains WHERE hostname = $1', [b.hostname], c)) throw conflict('domain_exists', 'Já existe um domínio com esse nome.');
      await c.query('UPDATE domains SET hostname = $2 WHERE id = $1', [d.id, b.hostname]);
    }
    if (b.active !== undefined) await c.query('UPDATE domains SET active = $2, created_by_sync = false WHERE id = $1', [d.id, b.active]);
    if (b.gamAccountId !== undefined) {
      if (b.gamAccountId && !(await one(`SELECT 1 FROM integration_accounts WHERE id = $1 AND provider = 'gam'`, [b.gamAccountId], c))) throw notFound('Conta do Ad Manager não encontrada.');
      await c.query('UPDATE domains SET gam_account_id = $2 WHERE id = $1', [d.id, b.gamAccountId]);
    }
    // revShare: vale a partir de revShareFrom (padrão: hoje). Dias anteriores continuam com o percentual antigo.
    if (b.revShare !== undefined) {
      const first = !(await one('SELECT 1 FROM domain_rev_shares WHERE domain_id = $1', [d.id], c));
      await setRevShare(c, d.id, b.revShare, b.revShareFrom ?? (first ? '2000-01-01' : today()), req.user!.id);
    }
    if (b.squadId !== undefined) {
      await c.query('DELETE FROM squad_domains WHERE domain_id = $1', [d.id]);
      if (b.squadId) {
        if (!(await one('SELECT 1 FROM squads WHERE id = $1', [b.squadId], c))) throw notFound('Squad não encontrado.');
        await c.query('INSERT INTO squad_domains (squad_id, domain_id) VALUES ($1, $2)', [b.squadId, d.id]);
      }
    }
    if (b.managerShares !== undefined) {
      const cur = (await q<{ id: string }>('SELECT user_id::text AS id FROM domain_managers WHERE domain_id = $1', [d.id], c)).map((r) => r.id);
      if (b.managerShares === null) await c.query('UPDATE domain_managers SET share_pct = NULL WHERE domain_id = $1', [d.id]);
      else {
        const got = b.managerShares.map((x) => x.userId);
        if (got.length !== cur.length || new Set(got).size !== got.length || got.some((u) => !cur.includes(u)))
          throw conflict('share_managers', 'O rateio precisa ter todos os gestores do domínio (e só eles). Recarregue a tela e tente de novo.');
        const sum = b.managerShares.reduce((a, x) => a + x.sharePct, 0);
        if (Math.abs(sum - 100) > 0.001) throw conflict('share_sum', `A soma do rateio precisa ser 100% (está em ${Math.round(sum * 1000) / 1000}%).`);
        for (const x of b.managerShares) await c.query('UPDATE domain_managers SET share_pct = $3 WHERE domain_id = $1 AND user_id = $2', [d.id, x.userId, x.sharePct]);
      }
    }
    // 0.18.8: contas de anúncios NÃO se ligam mais por aqui: só em Usuários & Squads (gestor → domínio → contas).
    // 0.17: registro do domínio
    const reg: [string, unknown][] = [['registrar', b.registrar], ['expires_on', b.expiresOn], ['hosting', b.hosting], ['wp_user', b.wpUser]];
    for (const [col, v] of reg) if (v !== undefined) await c.query(`UPDATE domains SET ${col} = $2 WHERE id = $1`, [d.id, v === '' ? null : v]);
    if (b.wpPassword !== undefined) {
      await c.query('UPDATE domains SET wp_password_enc = $2, wp_updated_at = now(), wp_updated_by = $3 WHERE id = $1', [d.id, b.wpPassword ? encrypt(b.wpPassword) : null, req.user!.id]);
      await c.query('INSERT INTO domain_secret_access (domain_id, user_id, action) VALUES ($1, $2, $3)', [d.id, req.user!.id, b.wpPassword ? 'update' : 'clear']);
    }
  });
  res.json(await get(b.hostname ?? host));
});

/** Só exclui domínio sem histórico. Com dados, a saída é desativar. */
domainsRouter.delete('/domains/:hostname', async (req, res) => {
  await rejectTechnical(req.params.hostname);
  const host = parse(HOST, req.params.hostname);
  const d = await one<{ id: string }>('SELECT id::text FROM domains WHERE hostname = $1', [host]);
  if (!d) throw notFound('Domínio não encontrado.');
  if (await one('SELECT 1 FROM daily_metrics WHERE domain_id = $1 LIMIT 1', [d.id])) throw conflict('domain_has_data', 'Este domínio tem dados históricos. Desative em vez de excluir.');
  await q('DELETE FROM domains WHERE id = $1', [d.id]);
  res.status(204).end();
});

/**
 * 0.17 · Senha do WordPress: só sai daqui, um domínio por vez, e cada leitura fica registrada (domain_secret_access).
 * Fica criptografada (AES-256-GCM, chave TOKEN_ENC_KEY) e não aparece na lista de domínios.
 */
domainsRouter.post('/domains/:hostname/wp-password', async (req, res) => {
  const host = parse(HOST, req.params.hostname);
  const d = await one<{ id: string; enc: Buffer | null; user: string | null }>('SELECT id::text, wp_password_enc AS enc, wp_user AS user FROM domains WHERE hostname = $1', [host]);
  if (!d) throw notFound('Domínio não encontrado.');
  if (!d.enc) throw notFound('Nenhuma senha cadastrada para este domínio.');
  await q('INSERT INTO domain_secret_access (domain_id, user_id, action) VALUES ($1, $2, $3)', [d.id, req.user!.id, 'view']);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: d.user, password: decrypt(d.enc) });
});
