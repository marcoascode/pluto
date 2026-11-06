-- 0.10.0 · Métricas de resultado da Meta + Finance (Caixa Empresa e Custos)

-- 1) Meta Ads: ações por anúncio × país × dia (Insights "actions")
--    link_click → Clique · onsite_conversion.messaging_conversation_started_7d → Resultados · lead → Leads
--    CPC-L, CPR e CPL são calculados na consulta (custo Meta ÷ ação), então somam certo em qualquer período.
ALTER TABLE daily_metrics ADD COLUMN meta_link_clicks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN meta_results     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN meta_leads       BIGINT NOT NULL DEFAULT 0;

-- 1b) Origem da receita: utm_source que o site manda ao Ad Manager (key-value utm_source). Valores de retenção
--     colocados à mão na URL (?utm_source=push, ?utm_source=whatsapp…) aparecem como origem própria na tela URLs;
--     o resto fica como Google Ads / Meta Ads (campanha atribuída) ou "Sem origem". Entra no grão da linha.
ALTER TABLE daily_metrics ADD COLUMN utm_source TEXT CHECK (utm_source IS NULL OR utm_source ~ '^[a-z0-9_.-]{1,40}$');
DROP INDEX IF EXISTS daily_metrics_grain_uq;
CREATE UNIQUE INDEX daily_metrics_grain_uq ON daily_metrics
  (source, date, domain_id, COALESCE(url_id, 0), platform, COALESCE(campaign_id, 0), COALESCE(ad_group_id, 0), COALESCE(ad_id, 0), country, COALESCE(unattributed_reason, ''), COALESCE(utm_source, ''));

-- 2) Finance · Custos lançados à mão (ferramentas, domínios, hospedagem, equipe…), sempre de uma Empresa.
--    recurrence 'monthly': vale todo mês de start_month até end_month (aberto = sem fim) · 'once': só em start_month.
--    pay_day: dia do pagamento no mês (o Caixa desconta o custo nesse dia).
CREATE TABLE finance_costs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  category    TEXT NOT NULL CHECK (category IN ('tools', 'domains', 'hosting', 'team', 'taxes', 'services', 'other')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD', 'EUR')),
  recurrence  TEXT NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('monthly', 'once')),
  start_month DATE NOT NULL CHECK (extract(day FROM start_month) = 1),
  end_month   DATE CHECK (end_month IS NULL OR (extract(day FROM end_month) = 1 AND end_month >= start_month)),
  pay_day     SMALLINT NOT NULL DEFAULT 1 CHECK (pay_day BETWEEN 1 AND 28),
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX finance_costs_company_idx ON finance_costs (company_id, start_month);

-- 3) Finance · Caixa: saldo conferido no banco ('balance', vale no fim do dia), aportes e retiradas.
--    Caixa estimado = último saldo conferido + resultado (receita − anúncios) depois dele − custos pagos depois dele
--                     + aportes − retiradas depois dele.
CREATE TABLE finance_cash_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('balance', 'deposit', 'withdrawal')),
  amount      NUMERIC(14,2) NOT NULL CHECK (kind = 'balance' OR amount > 0),
  currency    CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD', 'EUR')),
  note        TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX finance_cash_company_idx ON finance_cash_entries (company_id, date);
