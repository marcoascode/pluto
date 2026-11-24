-- 023 · 0.18.12 · Quem cadastrou o usuário (Admin vê os usuários que cadastrou + os dos Squads das Empresas em que é sócio).
-- Usuários antigos ficam sem autor (NULL): o Admin os vê só se estiverem num Squad/Empresa dele.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_created_by_idx ON users (created_by) WHERE created_by IS NOT NULL;
