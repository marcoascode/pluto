-- 002 · Papéis SuperAdmin/Admin/Gestor · IVA da Meta · revShare por domínio · origem das linhas de métricas

/* ---------------- papéis ----------------
   "Acesso Total" vira "admin". O admin principal vira "superadmin" (único que conecta integrações
   e muda a frequência do sync). */
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'admin' WHERE role = 'total';
UPDATE users SET role = 'superadmin' WHERE is_main_admin;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('gestor', 'admin', 'superadmin'));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
DELETE FROM role_permissions WHERE role = 'total';
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check CHECK (role IN ('gestor', 'admin', 'superadmin'));

/* ---------------- revShare por domínio (com histórico) ----------------
   Percentual da receita bruta do Ad Manager retido pela Network (ex.: Publeno).
   Receita líquida = receita bruta × (1 − rev_share vigente no dia). Não aparece nos relatórios. */
CREATE TABLE domain_rev_shares (
  domain_id  BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  rev_share  NUMERIC(6,5) NOT NULL CHECK (rev_share >= 0 AND rev_share < 1),   -- 0.2 = 20%
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (domain_id, valid_from)
);

/* ---------------- daily_metrics ----------------
   source: quem gravou a linha. Cada worker apaga e regrava só as linhas dele na janela (idempotente).
   revenue_usd passa a ser a receita BRUTA do Ad Manager (o revShare é aplicado na consulta).
   iva_usd: IVA sobre o gasto da Meta (gravado na importação com a alíquota vigente). */
ALTER TABLE daily_metrics ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'
  CHECK (source IN ('google-ads', 'meta', 'gam', 'legacy'));
ALTER TABLE daily_metrics ADD COLUMN iva_usd NUMERIC(14,4) NOT NULL DEFAULT 0;

UPDATE daily_metrics SET revenue_usd = gross_revenue_usd WHERE gross_revenue_usd > revenue_usd;
ALTER TABLE daily_metrics DROP COLUMN gross_revenue_usd;
UPDATE daily_metrics SET iva_usd = round(spend_usd * 0.1383, 4) WHERE platform = 'meta';

DROP INDEX IF EXISTS daily_metrics_grain_uq;
CREATE UNIQUE INDEX daily_metrics_grain_uq ON daily_metrics
  (source, date, domain_id, COALESCE(url_id, 0), platform, COALESCE(campaign_id, 0), COALESCE(ad_group_id, 0), COALESCE(ad_id, 0), country, COALESCE(unattributed_reason, ''));
CREATE INDEX daily_metrics_source_date_idx ON daily_metrics (source, date);

/* ---------------- estrutura: destino dos anúncios ---------------- */
ALTER TABLE ads ADD COLUMN final_url TEXT;
ALTER TABLE ads ADD COLUMN status TEXT;
ALTER TABLE ad_groups ADD COLUMN status TEXT;
ALTER TABLE domains ADD COLUMN created_by_sync BOOLEAN NOT NULL DEFAULT FALSE;   -- site visto no Ad Manager e ainda não cadastrado

/* ---------------- configurações ---------------- */
INSERT INTO app_settings (key, value) VALUES ('meta_iva_rate', '{"rate": 0.1383}'::jsonb)
  ON CONFLICT (key) DO NOTHING;
