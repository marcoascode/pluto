/**
 * 0.18.16 · Fluxo de caixa — apaga os PDFs de fatura cujo prazo de retenção venceu (7, 30, 60, 90 ou 365 dias após o envio).
 * Só o arquivo sai: a fatura (cabeçalho e o que foi lido) e os lançamentos continuam. Chamado pelo agendador.
 */
import { q } from '../db.js';

export async function purgeExpiredPdfs(): Promise<number> {
  const r = await q(`UPDATE cashflow_statements SET pdf_data = NULL, pdf_purged_at = now()
    WHERE pdf_data IS NOT NULL AND pdf_purge_at IS NOT NULL AND pdf_purge_at <= now() RETURNING id`);
  if (r.length) console.log(`[cashflow] ${r.length} PDF(s) de fatura apagado(s) pelo prazo de retenção`);
  return r.length;
}
