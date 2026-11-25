/**
 * 0.18.16 · Fluxo de caixa — texto da fatura em PDF, extraído no próprio servidor e em memória (nada vai para o disco).
 * Remonta as linhas pela posição dos trechos na página (mesma altura = mesma linha), para que cada lançamento
 * da fatura ("12/03  FACEBK *2X8Y  150,00") chegue inteiro ao passo seguinte (mascaramento → Claude).
 */
import { extractTextItems, getDocumentProxy } from 'unpdf';
import { HttpError } from '../lib/http.js';

export const MAX_PAGES = 40;

export async function pdfLines(buf: Buffer, password?: string | null): Promise<{ pages: number; lines: string[] }> {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(422, 'pdf_invalid', 'O arquivo não é um PDF.');
  let doc;
  try {
    // cópia: o PDF.js pode "consumir" o ArrayBuffer, e o original ainda vai ser guardado
    doc = await getDocumentProxy(new Uint8Array(buf), { password: password || undefined } as Parameters<typeof getDocumentProxy>[1]);
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'PasswordException') {
      throw err.code === 2
        ? new HttpError(422, 'pdf_password_wrong', 'Senha do PDF incorreta.')
        : new HttpError(422, 'pdf_password_required', 'Este PDF é protegido por senha. Informe a senha (muitos bancos usam dígitos do CPF).');
    }
    throw new HttpError(422, 'pdf_invalid', 'Não foi possível abrir o PDF. Confira se o arquivo não está corrompido.');
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new HttpError(422, 'pdf_too_many_pages', `A fatura tem ${doc.numPages} páginas; o limite é ${MAX_PAGES}.`);
    const { totalPages, items } = await extractTextItems(doc);
    const lines: string[] = [];
    for (const page of items) {
      const rows: { y: number; parts: { x: number; s: string; w: number }[] }[] = [];
      for (const it of page) {
        const s = it.str.replace(/\s+/g, ' ');
        if (!s.trim()) continue;
        let row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.height * 0.4));
        if (!row) rows.push((row = { y: it.y, parts: [] }));
        row.parts.push({ x: it.x, s, w: it.width });
      }
      rows.sort((a, b) => b.y - a.y);   // de cima para baixo
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        let line = '', end = -Infinity;
        for (const p of r.parts) {
          // espaço largo entre colunas vira dois espaços (ajuda a separar descrição e valor)
          line += line ? (p.x - end > 12 ? '  ' : p.x - end > 1 ? ' ' : '') + p.s : p.s;
          end = p.x + p.w;
        }
        lines.push(line.trim());
      }
      lines.push('');                   // quebra de página
    }
    if (!lines.some((l) => /\d/.test(l))) {
      throw new HttpError(422, 'pdf_no_text', 'Não há texto no PDF (provavelmente é uma imagem escaneada). Baixe a fatura em PDF pelo app ou site do banco.');
    }
    return { pages: totalPages, lines };
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}
