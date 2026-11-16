-- 012 · v0.18.0 · Criação automatizada de campanhas Meta — Etapa 3
--       registro de cada publicação (execução) e de cada etapa da cascata Campanha → Conjunto → Criativo → Anúncio.
--       Nada sensível é guardado: o payload salvo nunca contém o token do Perfil.

CREATE TABLE meta_campaign_runs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id       BIGINT REFERENCES meta_profiles(id) ON DELETE SET NULL,
  ad_account_id    TEXT NOT NULL,                                -- sem o prefixo act_
  site             TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  payload          JSONB NOT NULL,                               -- parâmetros resolvidos (sem token)
  meta_campaign_id TEXT,
  meta_adset_id    TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX meta_campaign_runs_user_idx ON meta_campaign_runs (user_id, created_at DESC);

CREATE TABLE meta_campaign_run_steps (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES meta_campaign_runs(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('campaign', 'adset', 'creative', 'ad', 'rollback')),
  label         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'failed', 'skipped')),
  meta_id       TEXT,                                            -- id devolvido pela Meta
  attempts      INT NOT NULL DEFAULT 0,
  rate_limited  BOOLEAN NOT NULL DEFAULT FALSE,                  -- esbarrou no limite de uso da Meta em alguma tentativa
  error_http    INT,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  UNIQUE (run_id, seq)
);
