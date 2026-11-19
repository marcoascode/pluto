-- 017 · v0.18.0 · Criação automatizada de campanhas Meta — campanhas pendentes de envio (rascunhos).
--       Guardam o estado do assistente para a campanha poder ser editada, reenviada ou excluída depois de uma falha
--       (ou de a página ser fechada no meio do envio). Imagens NUNCA são guardadas aqui: só o image_hash/URL devolvidos
--       pela Meta para as que já subiram para a biblioteca da conta de anúncios. Nada sensível (sem token).

CREATE TABLE IF NOT EXISTS meta_campaign_drafts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id    BIGINT REFERENCES meta_profiles(id) ON DELETE SET NULL,
  ad_account_id TEXT,                                            -- sem o prefixo act_
  site          TEXT,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'failed')),
  state         JSONB NOT NULL,                                  -- estado do assistente (sem token, sem imagens)
  last_error    TEXT,
  last_run_id   BIGINT REFERENCES meta_campaign_runs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_campaign_drafts_user_idx ON meta_campaign_drafts (user_id, updated_at DESC);
