-- 010 · Registro do domínio (registrador, vencimento, hospedagem, acesso WP)
--       · vínculo conta de anúncios → site com data (histórico)
--       · contas de anúncios atribuídas a gestores (o gestor liga as contas dele aos sites dele)

/* ---------------- registro do domínio ----------------
   A senha do WordPress precisa ser lida de volta (é para entrar no painel), então NÃO pode ser hash:
   fica criptografada com AES-256-GCM (mesma chave TOKEN_ENC_KEY dos tokens OAuth) e só é aberta por
   "Mostrar senha", com registro de quem abriu em domain_secret_access. */
ALTER TABLE domains ADD COLUMN IF NOT EXISTS registrar       TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS expires_on      DATE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS hosting         TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS wp_user         TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS wp_password_enc BYTEA;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS wp_updated_at   TIMESTAMPTZ;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS wp_updated_by   BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS domain_secret_access (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action    TEXT NOT NULL CHECK (action IN ('view', 'update', 'clear')),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_secret_access_domain_idx ON domain_secret_access (domain_id, at DESC);

/* ---------------- vínculo conta → site com data ----------------
   Cada linha diz: a partir de valid_from, a conta paga estes sites (domain_ids; vazio = nenhum).
   No dia D vale a linha com o maior valid_from <= D. Assim, quando uma conta sai do site A (ex.: A penalizado no
   Ad Manager) e vai para o site B em 10/11, a despesa até 09/11 continua no A e a partir de 10/11 vai para o B,
   mesmo que o sync reprocesse os dias antigos. domain_accounts continua sendo o vínculo de HOJE (= linha vigente). */
CREATE TABLE IF NOT EXISTS account_domain_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  valid_from  DATE NOT NULL,
  domain_ids  BIGINT[] NOT NULL DEFAULT '{}',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, valid_from)
);
-- vínculos de hoje viram a 1ª linha, valendo desde sempre (nada muda nos números já gravados)
INSERT INTO account_domain_history (account_id, valid_from, domain_ids)
  SELECT da.account_id, DATE '2000-01-01', array_agg(da.domain_id ORDER BY da.domain_id)
    FROM domain_accounts da JOIN integration_accounts a ON a.id = da.account_id AND a.provider IN ('google-ads', 'meta')
   GROUP BY da.account_id
  ON CONFLICT (account_id, valid_from) DO NOTHING;

/* ---------------- contas atribuídas ao gestor ----------------
   Gerente/Admin/SuperAdmin atribuem ao gestor domínios (domain_managers, já existia) e contas de anúncios (aqui).
   O gestor só vê e só liga as contas dele aos domínios dele. */
CREATE TABLE IF NOT EXISTS manager_accounts (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);
INSERT INTO manager_accounts (user_id, account_id)
  SELECT DISTINCT user_id, account_id FROM domain_manager_accounts
  ON CONFLICT DO NOTHING;
