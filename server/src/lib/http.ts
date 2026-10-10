import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

/** Erro com status HTTP e código estável. Sai como { error: { code, message } }. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const notFound = (msg = 'Não encontrado.') => new HttpError(404, 'not_found', msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const forbidden = (code: string, msg: string) => new HttpError(403, code, msg);

/** Valida o corpo/consulta com zod; erro vira 422 com a primeira mensagem. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) { const i = r.error.issues[0]; throw new HttpError(422, 'invalid_input', `${i.path.join('.') || 'corpo'}: ${i.message}`); }
  return r.data;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new HttpError(404, 'not_found', `Rota não encontrada: ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) return res.status(422).json({ error: { code: 'invalid_input', message: err.issues[0]?.message ?? 'Dados inválidos.' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'JSON inválido.' } });
  // Violação de unicidade/FK do Postgres → mensagem amigável
  if (err?.code === '23505') return res.status(409).json({ error: { code: 'duplicate', message: 'Já existe um registro com esses dados.' } });
  if (err?.code === '23514' && /technical_domain/.test(err?.message ?? '')) return res.status(409).json({ error: { code: 'technical_domain', message: 'O domínio técnico "Sem domínio" não pode ser vinculado a Squad, gestor, conta ou campanha.' } });
  if (err?.code === '23503') return res.status(409).json({ error: { code: 'in_use', message: 'Registro em uso por outros dados.' } });
  console.error(`[erro] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: { code: 'internal', message: 'Erro interno. Tente de novo.' } });
};
