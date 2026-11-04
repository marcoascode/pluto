-- 0.14.0 · Finance: receita e gasto POR SITE no Caixa Empresa + Comissões dos gestores
--
-- O Caixa continua 100% manual. Agora a receita recebida e o gasto pago podem dizer de qual SITE são
-- e a qual MÊS se referem (ex.: o AdX de outubro que caiu em 21/11 → referente a outubro).
-- Os valores do Caixa já vêm com o revshare do parceiro descontado (o que caiu no banco): nada é descontado de novo.
-- Comissões: por gestor, Empresa e mês fechado = soma do resultado dos sites dele (receitas − gastos do Caixa
-- daquele mês − custos do site na aba Custos). Site negativo desconta da comissão. A comissão é paga por fora:
-- aqui só se aprova e marca como paga (não gera lançamento no Caixa).
--
-- Substitui a 009 da versão 0.13 (que não foi para produção). Se ela chegou a rodar, os comandos abaixo limpam o que criou.
DROP TABLE IF EXISTS finance_audit_logs, finance_closings, finance_commission_payments, finance_commission_periods,
  finance_manager_assignments, finance_commission_rules, finance_ads_spend, finance_revenue_settlements, finance_revshare_rules CASCADE;
ALTER TABLE finance_attachments DROP CONSTRAINT IF EXISTS finance_attachments_owner_chk;
-- comprovantes de receitas AdX / pagamentos da 0.13 (sem lançamento nem custo) saem junto
DELETE FROM finance_attachments WHERE entry_id IS NULL AND cost_id IS NULL;
ALTER TABLE finance_attachments DROP COLUMN IF EXISTS settlement_id;
ALTER TABLE finance_attachments DROP COLUMN IF EXISTS payment_id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'finance_attachments'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%entry_id IS NULL%cost_id IS NULL%') THEN
    ALTER TABLE finance_attachments ADD CONSTRAINT finance_attachments_owner_chk CHECK ((entry_id IS NULL) <> (cost_id IS NULL));
  END IF;
END $$;
DROP INDEX IF EXISTS finance_cash_entries_source_uq;
ALTER TABLE finance_cash_entries DROP CONSTRAINT IF EXISTS finance_cash_entries_source_chk;
ALTER TABLE finance_cash_entries DROP COLUMN IF EXISTS source_id;
ALTER TABLE finance_cash_entries DROP COLUMN IF EXISTS source;
DELETE FROM finance_cash_entries WHERE category = 'commission';
ALTER TABLE finance_cash_entries DROP CONSTRAINT IF EXISTS finance_cash_entries_category_check;
ALTER TABLE finance_cash_entries ADD CONSTRAINT finance_cash_entries_category_check CHECK (
  (kind = 'income'  AND category IN ('adx', 'adsense', 'other_income')) OR
  (kind = 'expense' AND category IN ('google_ads', 'meta_ads', 'other_expense')) OR
  (kind IN ('balance', 'deposit', 'withdrawal') AND category IS NULL)
);

-- 1) Caixa: site (hostname, ex.: 'dominiox.com') e mês de referência da receita/gasto
ALTER TABLE finance_cash_entries ADD COLUMN IF NOT EXISTS site TEXT CHECK (site IS NULL OR site ~ '^[a-z0-9.-]+$');
ALTER TABLE finance_cash_entries ADD COLUMN IF NOT EXISTS competence DATE CHECK (competence IS NULL OR extract(day FROM competence) = 1);
ALTER TABLE finance_cash_entries DROP CONSTRAINT IF EXISTS finance_cash_entries_site_kind_chk;
ALTER TABLE finance_cash_entries ADD CONSTRAINT finance_cash_entries_site_kind_chk CHECK (kind IN ('income', 'expense') OR (site IS NULL AND competence IS NULL));
-- Revshare na receita: quando o valor informado ainda NÃO tinha o desconto do parceiro, o dash desconta.
--   gross_amount = valor informado (bruto) · revshare_pct = % descontado · amount = o que entra no caixa (líquido).
--   Os dois vazios = o valor já veio descontado (é o que caiu no banco).
ALTER TABLE finance_cash_entries ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(14,2) CHECK (gross_amount IS NULL OR gross_amount > 0);
ALTER TABLE finance_cash_entries ADD COLUMN IF NOT EXISTS revshare_pct NUMERIC(6,3) CHECK (revshare_pct IS NULL OR (revshare_pct >= 0 AND revshare_pct < 100));
ALTER TABLE finance_cash_entries DROP CONSTRAINT IF EXISTS finance_cash_entries_revshare_chk;
ALTER TABLE finance_cash_entries ADD CONSTRAINT finance_cash_entries_revshare_chk CHECK ((gross_amount IS NULL) = (revshare_pct IS NULL) AND (revshare_pct IS NULL OR kind = 'income'));
CREATE INDEX IF NOT EXISTS finance_cash_site_idx ON finance_cash_entries (company_id, site, competence) WHERE site IS NOT NULL;

-- 2) Custos: custo de um site só (plugin, tema, domínio dele…) entra no resultado do site
ALTER TABLE finance_costs ADD COLUMN IF NOT EXISTS site TEXT CHECK (site IS NULL OR site ~ '^[a-z0-9.-]+$');

-- 3) Regra de comissão. Padrão "Meritocracia": sem lucro sem comissão;
--    lucro do gestor no mês até US$ 20K = 10%, acima de US$ 20K = 12%, a partir de US$ 40K = 15% (a faixa vale para o lucro todo).
CREATE TABLE finance_commission_rules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  tiers         JSONB NOT NULL,                 -- [{ "from": 0, "pct": 10 }, …] em tier_currency
  tier_currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (tier_currency IN ('BRL', 'USD', 'EUR')),
  updated_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO finance_commission_rules (name, tiers, tier_currency)
VALUES ('Meritocracia', '[{"from": 0, "pct": 10}, {"from": 20000, "pct": 12}, {"from": 40000, "pct": 15}]', 'USD');

-- 4) Gestor responsável por site, com início e fim (trocar o responsável não muda os meses anteriores).
--    share_pct = rateio quando dois gestores dividem o mesmo site no período.
CREATE TABLE finance_manager_assignments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site        TEXT NOT NULL CHECK (site ~ '^[a-z0-9.-]+$'),
  start_date  DATE NOT NULL,
  end_date    DATE CHECK (end_date IS NULL OR end_date >= start_date),
  share_pct   NUMERIC(6,3) NOT NULL DEFAULT 100 CHECK (share_pct > 0 AND share_pct <= 100),
  note        TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX finance_assignments_idx ON finance_manager_assignments (company_id, site, start_date);
CREATE INDEX finance_assignments_user_idx ON finance_manager_assignments (user_id);

-- 5) Comissão aprovada (base congelada) e marcada como paga (pagamento feito por fora)
CREATE TABLE finance_commission_periods (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month           DATE NOT NULL CHECK (extract(day FROM month) = 1),
  base            JSONB NOT NULL,                -- sites, receitas, gastos, %, regra no momento da aprovação
  calculated      NUMERIC(14,2) NOT NULL,
  adjustments     NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_note TEXT CHECK (adjustment_note IS NULL OR length(adjustment_note) <= 300),
  approved_amount NUMERIC(14,2) NOT NULL CHECK (approved_amount >= 0),
  approved_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         DATE,
  paid_note       TEXT CHECK (paid_note IS NULL OR length(paid_note) <= 300),
  paid_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, company_id, month)
);

-- 6) Registro de quem aprovou, pagou, reabriu e mexeu nos vínculos e na regra
CREATE TABLE finance_audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  company_id  BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  note        TEXT
);
CREATE INDEX finance_audit_idx ON finance_audit_logs (company_id, at DESC);
