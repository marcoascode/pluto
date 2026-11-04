-- 0.12.0 · Finance → Custos: mudança de plano (upgrade) e valor real de cada mês
-- finance_cost_prices: o valor do plano muda a partir de um mês (ex.: ferramenta US$ 69 → US$ 99 a partir de out/26).
--   O valor de finance_costs.amount vale do start_month até a primeira mudança.
-- finance_cost_months: o valor real cobrado num mês, pela fatura/NF (ex.: Google Workspace previsto R$ 112, out/26 veio R$ 107).
--   Quando existe, substitui o valor do plano naquele mês no fechamento e no caixa ("mês fechado").
CREATE TABLE finance_cost_prices (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cost_id     BIGINT NOT NULL REFERENCES finance_costs(id) ON DELETE CASCADE,
  from_month  DATE NOT NULL CHECK (extract(day FROM from_month) = 1),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note        TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cost_id, from_month)
);
CREATE TABLE finance_cost_months (
  cost_id     BIGINT NOT NULL REFERENCES finance_costs(id) ON DELETE CASCADE,
  month       DATE NOT NULL CHECK (extract(day FROM month) = 1),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  note        TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cost_id, month)
);
