-- 028 · v0.18.17 · Fluxo de caixa por faturas de cartão — Etapa 4: regras de origem (por usuário)
/* A soma mensal por origem junta, no mesmo mês da compra, os lançamentos de faturas/cartões diferentes que têm a mesma origem.
   Sem regra, a origem é a merchant_key calculada da descrição (ex.: "FACEBK *2X8Y…" → FACEBK).
   Com regra, o usuário dá um nome e junta origens: ex.: FACEBK → "Facebook Ads (campanhas)"; "UBER" e "99" → "Transporte".
   As regras são aplicadas na consulta (valem também para o passado) e não alteram os lançamentos.
     match = 'key'      : origem exatamente igual ao padrão
             'starts'   : origem ou descrição começa com o padrão
             'contains' : origem ou descrição contém o padrão
   O padrão é guardado em maiúsculas e sem acento (mesma normalização da origem). */
CREATE TABLE cashflow_merchant_rules (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match       TEXT NOT NULL CHECK (match IN ('key', 'starts', 'contains')),
  pattern     TEXT NOT NULL CHECK (length(pattern) BETWEEN 2 AND 120),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category    TEXT CHECK (category IS NULL OR length(category) <= 60),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cashflow_merchant_rules_uq ON cashflow_merchant_rules (user_id, match, pattern);
CREATE INDEX cashflow_merchant_rules_user_idx ON cashflow_merchant_rules (user_id);
