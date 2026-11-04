-- 0.11.0 · Finance: Caixa Empresa 100% manual
-- O caixa deixa de usar a receita/gasto do sync das campanhas. Quem cuida do financeiro lança à mão:
--   income  = receita recebida (caiu na conta)  · category: adx (Google Ad Manager / AdX), adsense, other_income
--   expense = gasto pago                         · category: google_ads, meta_ads, other_expense
-- Os custos da aba Custos (finance_costs) continuam entrando sozinhos no caixa e no fechamento.
ALTER TABLE finance_cash_entries DROP CONSTRAINT IF EXISTS finance_cash_entries_kind_check;
ALTER TABLE finance_cash_entries ADD CONSTRAINT finance_cash_entries_kind_check
  CHECK (kind IN ('balance', 'deposit', 'withdrawal', 'income', 'expense'));
ALTER TABLE finance_cash_entries ADD COLUMN category TEXT;
ALTER TABLE finance_cash_entries ADD CONSTRAINT finance_cash_entries_category_check CHECK (
  (kind = 'income'  AND category IN ('adx', 'adsense', 'other_income')) OR
  (kind = 'expense' AND category IN ('google_ads', 'meta_ads', 'other_expense')) OR
  (kind IN ('balance', 'deposit', 'withdrawal') AND category IS NULL)
);
CREATE INDEX finance_cash_month_idx ON finance_cash_entries (company_id, kind, date);

-- Comprovantes (NF, recibo, fatura) ligados a um gasto/receita do caixa ou a um custo da aba Custos.
--   kind 'link': link do Google Drive (ou outro https) · kind 'file': PDF/JPG/PNG enviado (até 10 MB, guardado no banco)
--   amount/doc_number/doc_date: valor, número e data da NF, para conferir com o valor lançado
--   month: num custo mensal, de qual mês é o comprovante (cada mês tem a sua NF)
CREATE TABLE finance_attachments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id    BIGINT REFERENCES finance_cash_entries(id) ON DELETE CASCADE,
  cost_id     BIGINT REFERENCES finance_costs(id) ON DELETE CASCADE,
  month       DATE CHECK (month IS NULL OR extract(day FROM month) = 1),
  kind        TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  url         TEXT CHECK (url IS NULL OR (url ~ '^https://' AND length(url) <= 1000)),
  filename    TEXT CHECK (filename IS NULL OR length(filename) <= 200),
  mime        TEXT CHECK (mime IS NULL OR mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  size        INT CHECK (size IS NULL OR size BETWEEN 1 AND 10485760),
  data        BYTEA,
  amount      NUMERIC(14,2) CHECK (amount IS NULL OR amount > 0),
  currency    CHAR(3) CHECK (currency IS NULL OR currency IN ('BRL', 'USD', 'EUR')),
  doc_number  TEXT CHECK (doc_number IS NULL OR length(doc_number) <= 60),
  doc_date    DATE,
  note        TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((entry_id IS NULL) <> (cost_id IS NULL)),
  CHECK ((kind = 'link' AND url IS NOT NULL AND data IS NULL) OR (kind = 'file' AND data IS NOT NULL AND filename IS NOT NULL AND mime IS NOT NULL))
);
CREATE INDEX finance_attachments_entry_idx ON finance_attachments (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX finance_attachments_cost_idx ON finance_attachments (cost_id, month) WHERE cost_id IS NOT NULL;
