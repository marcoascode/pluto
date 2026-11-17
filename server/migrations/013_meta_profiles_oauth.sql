-- 013 · v0.18.2 · Perfis Meta via Facebook Login (OAuth 2.0) + ativos sincronizados
--       Substitui o cadastro manual de System User Token: cada gestor conecta um ou mais Perfis do Facebook
--       (contingência). O token é um Long-Lived User Access Token (~60 dias), criptografado (AES-256-GCM).
--       Perfis antigos (System User Token) continuam funcionando e aparecem como "legado".

ALTER TABLE meta_profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'system_user' CHECK (source IN ('system_user', 'oauth'));
ALTER TABLE meta_profiles ADD COLUMN fb_user_id TEXT;                 -- id do Perfil do Facebook (app-scoped) que autorizou
ALTER TABLE meta_profiles ADD COLUMN fb_email TEXT;
ALTER TABLE meta_profiles ADD COLUMN token_expires_at TIMESTAMPTZ;   -- NULL = não expira (System User "Nunca")
ALTER TABLE meta_profiles ADD COLUMN declined_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE meta_profiles ADD COLUMN last_synced_at TIMESTAMPTZ;
ALTER TABLE meta_profiles ADD COLUMN sync_error TEXT;                 -- avisos da última sincronização (bordas que falharam)
ALTER TABLE meta_profiles ALTER COLUMN token_last4 DROP NOT NULL;

-- dois Perfis do Facebook podem ter o mesmo nome: a unicidade passa a ser pelo id do Facebook
DROP INDEX IF EXISTS meta_profiles_user_name_uq;
CREATE UNIQUE INDEX meta_profiles_user_fb_uq ON meta_profiles (user_id, fb_user_id) WHERE fb_user_id IS NOT NULL;

/* Ativos acessíveis pelo token do Perfil, copiados da Graph API na conexão e em "Sincronizar Ativos".
   kind: business (BM) · ad_account · page · dataset (Pixel/Conjunto de Dados — na Meta é o mesmo objeto).
   data: campos extras (moeda, fuso, BM dono, contas/BMs em que o dataset aparece…). Nada sensível. */
CREATE TABLE meta_profile_assets (
  profile_id  BIGINT NOT NULL REFERENCES meta_profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('business', 'ad_account', 'page', 'dataset')),
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}',
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, kind, external_id)
);
