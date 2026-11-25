/**
 * 0.18.15 · Fluxo de caixa — "origem" de um lançamento a partir da descrição da fatura.
 *
 * A origem (merchant_key) é o que junta, no mesmo mês, despesas de faturas/cartões diferentes:
 *   "FACEBK *2X8YZ9ABC2"  → "FACEBK"        (tudo depois do * é código da transação)
 *   "UBER *TRIP HELP.UBER" → "UBER"
 *   "PAG*JoaoDaSilva"      → "JOAODASILVA"   (PAG*, MP*, PG *… são intermediadores: a origem vem depois do *)
 *   "NETFLIX.COM 03/12"    → "NETFLIX.COM"   (parcela e números saem)
 * É uma normalização genérica; a Etapa 4 traz as regras do usuário (ex.: "FACEBK" → "Facebook Ads").
 */

/** Intermediadores de pagamento: a origem real é o que vem depois do "*". */
const ACQUIRERS = new Set(['PAG', 'PG', 'MP', 'MERCADOPAGO', 'PAGSEGURO', 'PAGSEG', 'EC', 'SUMUP', 'SUM', 'PICPAY', 'PP', 'PAYPAL', 'EBN', 'EBANX', 'DL', 'DLOCAL', 'ZP', 'STONE', 'CIELO', 'GETNET', 'IZ', 'SQ', 'HTM', 'LIV', 'PIX']);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Parcela no texto: "PARC 03/10", "PARCELA 3 DE 10", "3/10" no fim. */
const INSTALLMENT_RE = /\b(?:PARC(?:ELA)?\.?\s*)?(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\s*$/;

export function parseInstallment(desc: string): { n: number; total: number } | null {
  const m = INSTALLMENT_RE.exec(stripAccents(desc).toUpperCase().trim());
  if (!m) return null;
  const n = Number(m[1]), total = Number(m[2]);
  return n >= 1 && total >= 2 && n <= total ? { n, total } : null;
}

export function merchantKey(desc: string): string {
  let s = stripAccents(desc).toUpperCase().replace(/\s+/g, ' ').trim();
  s = s.replace(INSTALLMENT_RE, '').trim();
  const star = s.indexOf('*');
  if (star >= 0) {
    const before = s.slice(0, star).trim(), after = s.slice(star + 1).trim();
    s = before && !ACQUIRERS.has(before.replace(/[^A-Z]/g, '')) ? before : after || before;
  }
  // tira tokens com dígitos (códigos, nº da loja, datas) e o país no fim; fica com até 4 palavras
  const words = s.split(/[\s*]+/).filter((w) => w && !/\d/.test(w));
  while (words.length > 1 && /^(BR|BRA|BRASIL|US|USA)$/.test(words[words.length - 1])) words.pop();
  const key = words.slice(0, 4).join(' ').replace(/[^A-Z0-9 .&'-]/g, '').trim();
  return (key || s.replace(/[^A-Z0-9]/g, '') || 'OUTROS').slice(0, 120);
}
