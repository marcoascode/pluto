-- 025 · v0.18.14 · Fluxo de caixa por faturas de cartão — Etapa 1: permissão por usuário
/* can_use_cashflow: libera o módulo Fluxo de caixa (upload de faturas de cartão em PDF, lançamentos e
   agrupamento por origem). O fluxo de caixa é POR USUÁRIO: cada um vê só os próprios dados.
   Só o SuperAdmin liga/desliga (PUT /admin/users/:id/cashflow); granted_* guarda quem e quando. */
ALTER TABLE users ADD COLUMN can_use_cashflow BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN cashflow_granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN cashflow_granted_at TIMESTAMPTZ;
