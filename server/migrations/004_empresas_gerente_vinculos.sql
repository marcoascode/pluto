-- 004 · Empresas (sócios) · papel Gerente · vínculo domínio + gestor(es) + contas · conta Ad Manager por domínio
--       deságio do câmbio · janela editável do sync · limpeza de conjuntos/anúncios antigos

/* ---------------- papel Gerente ----------------
   Gerente: vê os relatórios de vários Squads (os que forem dados a ele + os das Empresas em que é sócio),
   sem acesso à administração. Os módulos dele são configuráveis em Permissões, como os do Gestor. */
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('gestor', 'gerente', 'admin', 'superadmin'));
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check CHECK (role IN ('gestor', 'gerente', 'admin', 'superadmin'));
INSERT INTO role_permissions (role, capability)
  SELECT 'gerente', c FROM unnest(ARRAY['reports.view','urls.view','campaigns.google.view','campaigns.meta.view','gam.view','attribution.view','utm.debug']) c
  ON CONFLICT DO NOTHING;

/* Um usuário pode estar em vários Squads (Gerente). */
ALTER TABLE squad_users DROP CONSTRAINT IF EXISTS squad_users_user_id_key;

/* ---------------- Empresas ----------------
   Empresa = sociedade (ex.: "Empresa do Lucas" com os sócios Lucas e Fabricio). Agrupa Squads → domínios.
   Sócios veem todos os Squads/domínios da Empresa. O seletor "Empresa" do topo filtra o painel inteiro. */
CREATE TABLE companies (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_name_uq ON companies (lower(name));
CREATE TABLE company_users (                                   -- sócios (um usuário pode ser sócio de várias Empresas)
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, user_id)
);
ALTER TABLE squads ADD COLUMN company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;   -- um Squad pertence a uma Empresa

/* ---------------- domínio + gestor(es) + contas ----------------
   Um domínio pode ter vários gestores; cada gestor usa uma ou mais contas Google Ads / Meta Ads naquele domínio.
   O Gestor vê só as campanhas das contas dele em cada domínio. */
CREATE TABLE domain_managers (
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (domain_id, user_id)
);
CREATE TABLE domain_manager_accounts (
  domain_id  BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  account_id BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (domain_id, user_id, account_id),
  FOREIGN KEY (domain_id, user_id) REFERENCES domain_managers(domain_id, user_id) ON DELETE CASCADE
);
CREATE INDEX domain_managers_user_idx ON domain_managers (user_id);

-- quem já era Gestor continua vendo o mesmo: vira gestor dos domínios do Squad dele, com as contas ligadas a cada domínio
INSERT INTO domain_managers (domain_id, user_id)
  SELECT sd.domain_id, su.user_id FROM squad_users su JOIN users u ON u.id = su.user_id AND u.role = 'gestor' JOIN squad_domains sd ON sd.squad_id = su.squad_id
  ON CONFLICT DO NOTHING;
INSERT INTO domain_manager_accounts (domain_id, user_id, account_id)
  SELECT dm.domain_id, dm.user_id, da.account_id FROM domain_managers dm JOIN domain_accounts da ON da.domain_id = dm.domain_id
  ON CONFLICT DO NOTHING;

/* ---------------- um domínio = uma conta do Ad Manager ---------------- */
ALTER TABLE domains ADD COLUMN gam_account_id BIGINT REFERENCES integration_accounts(id) ON DELETE SET NULL;
UPDATE domains SET gam_account_id = (SELECT id FROM integration_accounts WHERE provider = 'gam' ORDER BY imported DESC, id LIMIT 1)
  WHERE gam_account_id IS NULL AND EXISTS (SELECT 1 FROM daily_metrics m WHERE m.domain_id = domains.id AND m.source = 'gam');

/* Status da conta na própria plataforma (Google: ENABLED/CANCELED/SUSPENDED… · Meta: ACTIVE/DISABLED/CLOSED…).
   O sync só busca dados das contas ativas. */
ALTER TABLE integration_accounts ADD COLUMN platform_status TEXT;

/* ---------------- deságio (USD/BRL) ----------------
   Valor em R$ descontado da cotação USD/BRL na receita do Google Ad Manager (ex.: 4,9881 − 0,06 = 4,9281).
   Histórico por data, como o revShare: mudar o deságio não reescreve os dias anteriores. */
CREATE TABLE fx_discounts (
  valid_from DATE PRIMARY KEY,
  amount_brl NUMERIC(10,4) NOT NULL CHECK (amount_brl >= 0 AND amount_brl < 5),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------- janela editável e limpeza de estrutura ----------------
   window_mode: 'days' = D-X → hoje (gam.close: D-X → D-4) · 'incremental' = desde a última execução com sucesso
                'fixed' = sem janela (estrutura, câmbio, limpeza)
   retention_days: só nos jobs *.cleanup — exclui conjuntos/anúncios não vistos há mais de X dias (null = desligado). */
ALTER TABLE sync_settings ADD COLUMN window_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (window_mode IN ('days', 'incremental', 'fixed'));
ALTER TABLE sync_settings ADD COLUMN window_days INT CHECK (window_days BETWEEN 0 AND 400);
ALTER TABLE sync_settings ADD COLUMN retention_days INT CHECK (retention_days BETWEEN 7 AND 3650);
UPDATE sync_settings SET window_mode = 'days', window_days = 3 WHERE id IN ('google-ads.metrics', 'meta.metrics', 'gam.revenue', 'google-ads.placements', 'gam.placements');
UPDATE sync_settings SET window_mode = 'days', window_days = 7 WHERE id = 'gam.close';
ALTER TABLE sync_settings DROP CONSTRAINT IF EXISTS sync_settings_every_minutes_check;
ALTER TABLE sync_settings ADD CONSTRAINT sync_settings_every_minutes_check CHECK (every_minutes BETWEEN 15 AND 10080);
INSERT INTO sync_settings (id, provider, label, window_desc, every_minutes, enabled, next_run_at, window_mode) VALUES
  ('google-ads.cleanup', 'google-ads', 'Limpeza de grupos e anúncios antigos', '—', 1440, true, now(), 'fixed'),
  ('meta.cleanup',       'meta',       'Limpeza de conjuntos e anúncios antigos', '—', 1440, true, now(), 'fixed')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE ad_groups ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ads ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX ads_last_seen_idx ON ads (last_seen_at);
CREATE INDEX ad_groups_last_seen_idx ON ad_groups (last_seen_at);
CREATE INDEX daily_metrics_ad_idx ON daily_metrics (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX daily_metrics_ad_group_idx ON daily_metrics (ad_group_id) WHERE ad_group_id IS NOT NULL;
