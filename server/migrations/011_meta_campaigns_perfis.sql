-- 011 · v0.18.0 · Criação automatizada de campanhas Meta — Etapa 1
--       permissão por usuário (só o SuperAdmin atribui) + Perfis/BMs de contingência por gestor

/* ---------------- permissão ----------------
   can_create_meta_campaigns: libera o módulo de criação de campanhas Meta para o usuário.
   Só o SuperAdmin liga/desliga (PUT /admin/users/:id/meta-campaigns); granted_* guarda quem e quando. */
ALTER TABLE users ADD COLUMN can_create_meta_campaigns BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN meta_campaigns_granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN meta_campaigns_granted_at TIMESTAMPTZ;

/* ---------------- Perfis / BMs (contingência) ----------------
   Cada gestor cadastra os próprios Perfis (um por BM/System User). Um Perfil é só do dono: toda consulta filtra por user_id.
   O System User Access Token fica criptografado (AES-256-GCM, TOKEN_ENC_KEY) e nunca volta para a tela — só os 4 últimos caracteres.
   Contas de anúncio, Páginas, Datasets e Pixels NÃO são copiados: são lidos na Graph API com o token do Perfil e
   cruzados com as contas/sites que os admins já atribuíram ao gestor (manager_accounts, domain_manager_accounts). */
CREATE TABLE meta_profiles (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,                              -- apelido do Perfil/BM (ex.: "BM Contingência 02")
  business_id       TEXT,                                       -- id do Business Manager (opcional; usado em Datasets)
  system_user_id    TEXT,                                       -- id do System User devolvido pela Meta na validação
  system_user_name  TEXT,
  token_enc         BYTEA NOT NULL,                             -- System User Access Token (AES-256-GCM)
  token_last4       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'invalid')),
  message           TEXT,                                       -- motivo da última falha de validação
  scopes            TEXT[] NOT NULL DEFAULT '{}',               -- permissões concedidas ao token (granted)
  last_validated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (business_id IS NULL OR business_id ~ '^\d+$')
);
CREATE UNIQUE INDEX meta_profiles_user_name_uq ON meta_profiles (user_id, lower(name));
CREATE INDEX meta_profiles_user_idx ON meta_profiles (user_id);
