-- 0.9.0 · Domínio técnico "Sem domínio" + mapeamento manual campanha → domínio
--
-- 1) Domínio técnico: o custo de campanhas sem domínio identificável (ex.: Meta de mensagens/chatbot, que não
--    tem link no criativo) é gravado nele em vez de ser descartado. Spend e IVA batem com a fatura da plataforma
--    e o ROI de cada site não fica inflado. Só Admin/SuperAdmin enxergam (scope.ts); não entra em Squad,
--    Empresa, gestor nem rede do Ad Manager. hostname sem ponto: nunca colide com um site de verdade.
ALTER TABLE domains ADD COLUMN is_technical BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX domains_one_technical_uq ON domains (is_technical) WHERE is_technical;
INSERT INTO domains (hostname, active, is_technical) VALUES ('sem-dominio', true, true)
ON CONFLICT (hostname) DO UPDATE SET is_technical = true, active = true;

-- 2) Mapeamento manual: domínio escolhido pelo admin vale mais que o link dos anúncios e não é trocado pelo sync.
ALTER TABLE campaigns ADD COLUMN domain_manual BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN domain_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN domain_set_at TIMESTAMPTZ;
CREATE INDEX campaigns_no_domain_idx ON campaigns (platform) WHERE domain_id IS NULL;

-- O domínio técnico nunca entra em Squad, gestor, conta ou rede do Ad Manager (garantido também no banco)
CREATE FUNCTION forbid_technical_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM domains WHERE id = NEW.domain_id AND is_technical) THEN
    RAISE EXCEPTION 'technical_domain' USING ERRCODE = 'check_violation', DETAIL = 'O domínio técnico "Sem domínio" não pode ser vinculado.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER squad_domains_no_technical BEFORE INSERT OR UPDATE ON squad_domains FOR EACH ROW EXECUTE FUNCTION forbid_technical_domain();
CREATE TRIGGER domain_managers_no_technical BEFORE INSERT OR UPDATE ON domain_managers FOR EACH ROW EXECUTE FUNCTION forbid_technical_domain();
CREATE TRIGGER domain_accounts_no_technical BEFORE INSERT OR UPDATE ON domain_accounts FOR EACH ROW EXECUTE FUNCTION forbid_technical_domain();
CREATE TRIGGER domain_manager_accounts_no_technical BEFORE INSERT OR UPDATE ON domain_manager_accounts FOR EACH ROW EXECUTE FUNCTION forbid_technical_domain();
CREATE TRIGGER campaigns_no_technical BEFORE INSERT OR UPDATE OF domain_id ON campaigns FOR EACH ROW WHEN (NEW.domain_id IS NOT NULL) EXECUTE FUNCTION forbid_technical_domain();
ALTER TABLE domains ADD CONSTRAINT domains_technical_no_gam CHECK (NOT is_technical OR gam_account_id IS NULL);
