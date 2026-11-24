/** 0.18.13 · Meio de recebimento da comissão do usuário (colunas payout_* de users, migration 024). */
import { q } from '../db.js';

export type PayoutMethod = 'pix' | 'dolafy' | 'other';
export interface PayoutRow { payout_method: PayoutMethod | null; payout_method_other: string | null; payout_key: string | null }
export interface Payout { method: PayoutMethod | null; methodOther: string | null; key: string | null; label: string | null }

const LABEL: Record<Exclude<PayoutMethod, 'other'>, string> = { pix: 'Chave PIX', dolafy: 'Dolafy' };
export function payoutOut(r: PayoutRow | null | undefined): Payout {
  const method = r?.payout_method ?? null;
  const methodOther = method === 'other' ? r?.payout_method_other ?? null : null;
  return { method, methodOther, key: method ? r?.payout_key ?? null : null, label: method ? (method === 'other' ? methodOther || 'Outro' : LABEL[method]) : null };
}

/** Meio de recebimento de vários usuários (cards de Comissões). */
export async function payoutsOf(userIds: string[]): Promise<Map<string, Payout>> {
  if (!userIds.length) return new Map();
  const rows = await q<PayoutRow & { id: string }>('SELECT id::text, payout_method, payout_method_other, payout_key FROM users WHERE id = ANY($1::bigint[])', [userIds]);
  return new Map(rows.map((r) => [r.id, payoutOut(r)]));
}
