/** Tokens das integrações para os workers (descriptografados só em memória). */
import { config } from '../../config.js';
import { one, q } from '../../db.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { SyncError } from './http.js';

/** Access token do Google (Ads ou Ad Manager), renovado com o refresh token quando faltar < 1 min. */
export async function googleAccessToken(p: 'google-ads' | 'gam'): Promise<string> {
  const c = await one<{ refresh_token_enc: Buffer | null; access_token_enc: Buffer | null; token_expires_at: string | null }>(
    'SELECT refresh_token_enc, access_token_enc, token_expires_at FROM integration_connections WHERE provider = $1', [p]);
  if (!c?.refresh_token_enc) throw new SyncError('not_connected', `${p} não está conectado (OAuth).`);
  if (c.access_token_enc && c.token_expires_at && Date.parse(c.token_expires_at) > Date.now() + 60_000) return decrypt(c.access_token_enc);
  if (!config.oauth.googleClientId || !config.oauth.googleClientSecret) throw new SyncError('not_configured', 'GOOGLE_CLIENT_ID/SECRET ausentes no .env.');
  const r = await fetch(config.api.googleToken, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ client_id: config.oauth.googleClientId, client_secret: config.oauth.googleClientSecret, refresh_token: decrypt(c.refresh_token_enc), grant_type: 'refresh_token' }),
  });
  const t = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !t.access_token) {
    if (t.error === 'invalid_grant') await q(`UPDATE integration_connections SET status = 'token' WHERE provider = $1`, [p]);
    throw new SyncError('token', `Falha ao renovar o token do Google (${t.error_description ?? t.error ?? r.status}). Reconecte a integração.`);
  }
  await q('UPDATE integration_connections SET access_token_enc = $2, token_expires_at = now() + make_interval(secs => $3), status = \'ok\' WHERE provider = $1',
    [p, encrypt(t.access_token), Number(t.expires_in ?? 3600)]);
  return t.access_token;
}

/** Token de longa duração da Meta (≈60 dias). Marca "token" quando faltam ≤ 7 dias para expirar. */
export async function metaAccessToken(): Promise<string> {
  const c = await one<{ access_token_enc: Buffer | null; token_expires_at: string | null }>(`SELECT access_token_enc, token_expires_at FROM integration_connections WHERE provider = 'meta'`);
  if (!c?.access_token_enc) throw new SyncError('not_connected', 'Meta não está conectada (OAuth).');
  if (c.token_expires_at && Date.parse(c.token_expires_at) < Date.now()) {
    await q(`UPDATE integration_connections SET status = 'token' WHERE provider = 'meta'`);
    throw new SyncError('token', 'O token da Meta expirou. Reconecte a integração.');
  }
  if (c.token_expires_at && Date.parse(c.token_expires_at) < Date.now() + 7 * 864e5) await q(`UPDATE integration_connections SET status = 'token' WHERE provider = 'meta'`);
  return decrypt(c.access_token_enc);
}
