import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Senha temporária legível (sem 0/O/1/l). */
export function tempPassword(len = 12): string {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(len);
  return Array.from(b, (x) => cs[x % cs.length]).join('');
}

const KEY = Buffer.from(config.tokenEncKey, 'base64');
if (KEY.length !== 32) throw new Error('TOKEN_ENC_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32).');

/** AES-256-GCM: [iv 12][tag 16][dados]. Para refresh/access tokens do OAuth. */
export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
export function decrypt(buf: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
