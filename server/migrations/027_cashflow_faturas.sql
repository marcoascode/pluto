-- 027 · v0.18.16 · Fluxo de caixa por faturas de cartão — Etapa 3: faturas em PDF
/* Uma linha por PDF enviado. Fluxo: upload → texto extraído em memória → dados pessoais mascarados →
   Claude devolve os lançamentos → status 'review' (o usuário confere) → 'confirmed' (lançamentos gravados).
   O PDF original fica no banco (nunca em disco) para consulta e é apagado sozinho em pdf_purge_at, conforme a
   retenção escolhida no upload (7, 30, 60, 90, 365 dias ou nunca = NULL). Apagar o PDF NÃO apaga a fatura nem os lançamentos.
   O texto da fatura não é guardado; extraction guarda só o que a IA leu (cabeçalho + lançamentos) para a revisão. */
CREATE TABLE cashflow_statements (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id            BIGINT REFERENCES cashflow_cards(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'confirmed')),
  filename           TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  size               INT NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  pages              SMALLINT,
  file_sha256        BYTEA NOT NULL,
  pdf_data           BYTEA,                                          -- NULL depois de apagado
  pdf_retention_days SMALLINT CHECK (pdf_retention_days IS NULL OR pdf_retention_days IN (7, 30, 60, 90, 365)),   -- NULL = nunca apagar
  pdf_purge_at       TIMESTAMPTZ,
  pdf_purged_at      TIMESTAMPTZ,
  issuer             TEXT CHECK (issuer IS NULL OR length(issuer) <= 60),
  card_last4         CHAR(4) CHECK (card_last4 IS NULL OR card_last4 ~ '^\d{4}$'),
  closing_date       DATE,
  due_date           DATE,
  total_amount       NUMERIC(14,2),
  extraction         JSONB NOT NULL,                                 -- { items: [...], warnings: [...], maskCounts: {...} }
  model              TEXT,
  input_tokens       INT,
  output_tokens      INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  CHECK ((pdf_retention_days IS NULL) = (pdf_purge_at IS NULL))
);
CREATE UNIQUE INDEX cashflow_statements_file_uq ON cashflow_statements (user_id, file_sha256);
CREATE INDEX cashflow_statements_user_idx ON cashflow_statements (user_id, created_at DESC);
CREATE INDEX cashflow_statements_purge_idx ON cashflow_statements (pdf_purge_at) WHERE pdf_data IS NOT NULL AND pdf_purge_at IS NOT NULL;

-- lançamento importado → a fatura de onde veio (excluir a fatura exclui os lançamentos dela)
ALTER TABLE cashflow_entries ADD COLUMN statement_id BIGINT REFERENCES cashflow_statements(id) ON DELETE CASCADE;
CREATE INDEX cashflow_entries_statement_idx ON cashflow_entries (statement_id) WHERE statement_id IS NOT NULL;
