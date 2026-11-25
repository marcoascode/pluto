-- 026 · v0.18.15 · Fluxo de caixa por faturas de cartão — Etapa 2: cartões e lançamentos
/* O fluxo de caixa é POR USUÁRIO: toda tabela tem user_id e toda consulta filtra por ele (id de outro usuário = 404).
   Nesta etapa os lançamentos são manuais; a Etapa 3 liga cada lançamento importado à sua fatura (statement_id)
   e usa o fingerprint para não importar a mesma compra duas vezes. */

/* ---------------- cartões ----------------
   Só o emissor, o apelido e os 4 últimos dígitos (nunca o número completo). */
CREATE TABLE cashflow_cards (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer      TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 60),        -- Nubank, Itaú, Inter…
  nickname    TEXT CHECK (nickname IS NULL OR length(nickname) <= 60),       -- ex.: "Black da empresa"
  last4       CHAR(4) CHECK (last4 IS NULL OR last4 ~ '^\d{4}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cashflow_cards_uq ON cashflow_cards (user_id, lower(issuer), COALESCE(last4, ''), lower(COALESCE(nickname, '')));
CREATE INDEX cashflow_cards_user_idx ON cashflow_cards (user_id);

/* ---------------- lançamentos ----------------
   date: data da COMPRA (é por ela que o mês é organizado).
   amount: sempre positivo, em BRL; o sinal vem do kind:
     purchase/fee/iof/interest = despesa (+) · refund = estorno/crédito (−) · payment = pagamento da fatura (fora das somas,
     para não contar o mesmo gasto duas vezes).
   merchant_key: a "origem" normalizada a partir da descrição (ex.: "FACEBK *2X8Y" → "FACEBK"), base do agrupamento mensal.
   excluded: o usuário tira o lançamento das somas sem apagá-lo. */
CREATE TABLE cashflow_entries (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id           BIGINT REFERENCES cashflow_cards(id) ON DELETE SET NULL,
  date              DATE NOT NULL,
  description       TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  description_raw   TEXT CHECK (description_raw IS NULL OR length(description_raw) <= 300),   -- como veio na fatura
  merchant_key      TEXT NOT NULL CHECK (length(merchant_key) BETWEEN 1 AND 120),
  kind              TEXT NOT NULL CHECK (kind IN ('purchase', 'refund', 'fee', 'iof', 'interest', 'payment')),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  amount_original   NUMERIC(14,2) CHECK (amount_original IS NULL OR amount_original > 0),    -- compra internacional
  currency_original CHAR(3) CHECK (currency_original IS NULL OR currency_original ~ '^[A-Z]{3}$'),
  installment_n     SMALLINT CHECK (installment_n IS NULL OR installment_n >= 1),
  installment_total SMALLINT CHECK (installment_total IS NULL OR installment_total >= 1),
  category          TEXT CHECK (category IS NULL OR length(category) <= 60),
  note              TEXT CHECK (note IS NULL OR length(note) <= 300),
  excluded          BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  fingerprint       BYTEA,                                                        -- só nos importados (Etapa 3)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((installment_n IS NULL) = (installment_total IS NULL)),
  CHECK (installment_n IS NULL OR installment_n <= installment_total),
  CHECK ((amount_original IS NULL) = (currency_original IS NULL))
);
CREATE INDEX cashflow_entries_user_date_idx ON cashflow_entries (user_id, date);
CREATE INDEX cashflow_entries_user_merchant_idx ON cashflow_entries (user_id, merchant_key, date);
CREATE UNIQUE INDEX cashflow_entries_fingerprint_uq ON cashflow_entries (user_id, fingerprint) WHERE fingerprint IS NOT NULL;
