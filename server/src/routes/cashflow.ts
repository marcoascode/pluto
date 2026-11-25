/**
 * 0.18.14 · Fluxo de caixa por faturas de cartão de crédito.
 * Montado em /cashflow atrás de requireCashflow (flag can_use_cashflow, atribuída só pelo SuperAdmin).
 * O fluxo de caixa é POR USUÁRIO: toda consulta filtra por req.user.id.
 *
 * Etapa 1: só a permissão. As próximas etapas trazem faturas (upload do PDF em memória, texto com dados
 * pessoais mascarados antes de ir ao Claude), lançamentos e o agrupamento por origem/mês.
 */
import { Router } from 'express';

export const cashflowRouter = Router();

/** Confirma que o módulo está liberado para o usuário (o middleware já respondeu 403 se não estiver). */
cashflowRouter.get('/status', (_req, res) => {
  res.json({ enabled: true });
});
