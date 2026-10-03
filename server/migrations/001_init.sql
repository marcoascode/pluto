-- Pluto Mídia — esquema PostgreSQL 16
-- Dinheiro: NUMERIC(14,4) sempre em USD (convertido na importação pela taxa do dia da conta).
-- Na consulta, converte para a moeda pedida pela taxa de CADA dia (currency_rates) antes de somar.
-- Datas: DATE no timezone da organização (APP_TZ), nunca TIMESTAMPTZ somado direto.

/* ---------------- usuários e sessão ---------------- */
CREATE TABLE users (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  password_hash        TEXT,                                   -- argon2id; NULL só antes do primeiro convite
  role                 TEXT NOT NULL CHECK (role IN ('gestor', 'total')),
  status               TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'disabled')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_main_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  preferences          JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_one_main_admin ON users (is_main_admin) WHERE is_main_admin;

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,                                -- sha256 do token do cookie (o token em si nunca é salvo)
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_exp_idx ON sessions (expires_at);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

/* ---------------- squads, domínios, permissões ---------------- */
CREATE TABLE squads (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX squads_name_uq ON squads (lower(name));

CREATE TABLE squad_users (                                     -- um gestor está em um Squad só
  squad_id BIGINT NOT NULL REFERENCES squads(id) ON DELETE RESTRICT,
  user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (squad_id, user_id)
);

CREATE TABLE domains (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostname     TEXT NOT NULL CHECK (hostname = lower(hostname)),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_data_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX domains_hostname_uq ON domains (hostname);

CREATE TABLE squad_domains (                                   -- um domínio está em um Squad só
  squad_id  BIGINT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  domain_id BIGINT NOT NULL UNIQUE REFERENCES domains(id) ON DELETE CASCADE,
  PRIMARY KEY (squad_id, domain_id)
);

CREATE TABLE role_permissions (                                -- só o Gestor é configurável; Acesso Total tem tudo
  role       TEXT NOT NULL CHECK (role IN ('gestor', 'total')),
  capability TEXT NOT NULL,
  PRIMARY KEY (role, capability)
);

/* ---------------- integrações ---------------- */
CREATE TABLE integration_connections (                          -- uma conexão OAuth por provedor
  provider          TEXT PRIMARY KEY CHECK (provider IN ('google-ads', 'meta', 'gam')),
  account_email     TEXT,                                       -- conta Google / usuário Meta que autorizou
  display_name      TEXT,                                       -- nome da MCC / Business / rede GAM
  external_id       TEXT,                                       -- customer id da MCC / business id / network code
  refresh_token_enc BYTEA,                                      -- AES-256-GCM (chave em TOKEN_ENC_KEY, fora do banco)
  access_token_enc  BYTEA,
  token_expires_at  TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at      TIMESTAMPTZ,
  connected_at      TIMESTAMPTZ
);

CREATE TABLE integration_accounts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     TEXT NOT NULL CHECK (provider IN ('google-ads', 'meta', 'gam')),
  external_id  TEXT NOT NULL,                                   -- normalizado: Google só dígitos, Meta sem "act_"
  name         TEXT NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'BRL', 'EUR')),
  timezone     TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  imported     BOOLEAN NOT NULL DEFAULT TRUE,
  status       TEXT NOT NULL DEFAULT 'ok',
  message      TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE domain_accounts (                                  -- quais contas de tráfego pagam cada domínio
  domain_id  BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (domain_id, account_id)
);

CREATE TABLE sync_settings (                                    -- frequência de cada job (tela de integrações)
  id            TEXT PRIMARY KEY,                               -- ex.: google-ads.metrics
  provider      TEXT NOT NULL CHECK (provider IN ('google-ads', 'meta', 'gam', 'fx')),
  label         TEXT NOT NULL,
  window_desc   TEXT NOT NULL,
  every_minutes INT NOT NULL CHECK (every_minutes BETWEEN 15 AND 1440),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  last_status   TEXT CHECK (last_status IN ('success', 'failed', 'running'))
);

CREATE TABLE sync_jobs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setting_id    TEXT REFERENCES sync_settings(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  window_from   DATE,
  window_to     DATE,
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'retry', 'failed', 'skipped')),
  attempts      INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX sync_jobs_status_idx ON sync_jobs (status, next_retry_at);

/* ---------------- câmbio ---------------- */
CREATE TABLE currency_rates (                                   -- 1 USD = rate_per_usd na moeda; um registro por dia (fim de semana repete a última)
  date         DATE NOT NULL,
  currency     CHAR(3) NOT NULL CHECK (currency IN ('BRL', 'EUR')),
  rate_per_usd NUMERIC(12,6) NOT NULL CHECK (rate_per_usd > 0),
  source       TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, currency)
);

/* ---------------- estrutura das campanhas ---------------- */
CREATE TABLE campaigns (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('google', 'meta')),
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ENABLED' CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  domain_id   BIGINT REFERENCES domains(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX campaigns_domain_idx ON campaigns (domain_id);

CREATE TABLE ad_groups (                                         -- Google: Ad Group · Meta: Ad Set
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  UNIQUE (campaign_id, external_id)
);
CREATE TABLE ads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ad_group_id BIGINT NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  UNIQUE (ad_group_id, external_id)
);
CREATE TABLE urls (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  UNIQUE (domain_id, path)
);

/* ---------------- fatos diários (todas as telas agregam daqui) ----------------
   Uma linha por dia × domínio × URL × campanha/grupo/anúncio × país.
   platform = 'none' → receita sem atribuição (nunca rateada entre campanhas). */
CREATE TABLE daily_metrics (
  date                DATE NOT NULL,
  domain_id           BIGINT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  url_id              BIGINT REFERENCES urls(id) ON DELETE SET NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('google', 'meta', 'none')),
  campaign_id         BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  ad_group_id         BIGINT REFERENCES ad_groups(id) ON DELETE SET NULL,
  ad_id               BIGINT REFERENCES ads(id) ON DELETE SET NULL,
  country             CHAR(2) NOT NULL DEFAULT 'ZZ',
  unattributed_reason TEXT,
  spend_usd           NUMERIC(14,4) NOT NULL DEFAULT 0,
  revenue_usd         NUMERIC(14,4) NOT NULL DEFAULT 0,          -- líquida (Gross − Retenção)
  gross_revenue_usd   NUMERIC(14,4) NOT NULL DEFAULT 0,
  sessions            INT NOT NULL DEFAULT 0,                    -- tracking próprio
  impressions         BIGINT NOT NULL DEFAULT 0,                 -- GAM
  ad_requests         BIGINT NOT NULL DEFAULT 0,
  responses_served    BIGINT NOT NULL DEFAULT 0,                 -- GAM "Responses served" → Drop-off
  ad_clicks           BIGINT NOT NULL DEFAULT 0,
  viewable            BIGINT NOT NULL DEFAULT 0,
  traffic_clicks      BIGINT NOT NULL DEFAULT 0,                 -- Google/Meta
  traffic_impressions BIGINT NOT NULL DEFAULT 0,
  is_final            BOOLEAN NOT NULL DEFAULT FALSE,            -- true depois do fechamento (D-4+)
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX daily_metrics_grain_uq ON daily_metrics
  (date, domain_id, COALESCE(url_id, 0), platform, COALESCE(campaign_id, 0), COALESCE(ad_group_id, 0), COALESCE(ad_id, 0), country, COALESCE(unattributed_reason, ''));
CREATE INDEX daily_metrics_domain_date_idx ON daily_metrics (domain_id, date);
CREATE INDEX daily_metrics_campaign_date_idx ON daily_metrics (campaign_id, date) WHERE campaign_id IS NOT NULL;
CREATE INDEX daily_metrics_date_idx ON daily_metrics (date);

/* ---------------- configurações gerais ---------------- */
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------- dados iniciais ---------------- */
INSERT INTO role_permissions (role, capability) VALUES
  ('gestor', 'reports.view'), ('gestor', 'urls.view'), ('gestor', 'campaigns.google.view'), ('gestor', 'campaigns.meta.view'),
  ('gestor', 'gam.view'), ('gestor', 'attribution.view'), ('gestor', 'utm.debug');

INSERT INTO sync_settings (id, provider, label, window_desc, every_minutes, next_run_at) VALUES
  ('google-ads.metrics',   'google-ads', 'Custo por campanha × país',                     'incremental · D-3 → hoje',      30,   now()),
  ('google-ads.structure', 'google-ads', 'Estrutura: campanhas, grupos, anúncios',        'incremental',                   120,  now()),
  ('meta.metrics',         'meta',       'Insights por anúncio × país',                   'incremental · D-3 → hoje',      30,   now()),
  ('meta.structure',       'meta',       'Estrutura: campanha, conjunto, anúncio',        'incremental',                   120,  now()),
  ('gam.revenue',          'gam',        'Receita e delivery por key-values × país × URL','reprocessa hoje e D-1 a D-3',   60,   now()),
  ('gam.close',            'gam',        'Fechamento de receita',                         'reprocessa D-4 a D-7',          1440, now()),
  ('fx.rates',             'fx',         'Cotações USD → BRL e EUR (Frankfurter)',        'hoje + dias que faltarem',      360,  now());

INSERT INTO integration_connections (provider) VALUES ('google-ads'), ('meta'), ('gam');

INSERT INTO app_settings (key, value) VALUES ('utm_templates', jsonb_build_object(
  'google', 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}_{creative}&utm_term={keyword}&placement={placement}&network={network}&device={device}',
  'meta',   'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{adset.id}}_{{ad.id}}&utm_term={{placement}}'
));
