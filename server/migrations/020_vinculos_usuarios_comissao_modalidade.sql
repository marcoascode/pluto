-- 020 · 0.18.8
--   1) Vínculos usuário × domínio × conta de anúncios só em Usuários & Squads (domain_manager_accounts).
--      domain_accounts (usado pelo sync para pôr a despesa da conta no site) passa a ser DERIVADO desses vínculos:
--      conta → domínios em que algum gestor a usa. Aqui ele é reconciliado uma vez; mudanças valem a partir de hoje
--      (o histórico em account_domain_history garante que os dias anteriores não mudam).
--   2) Modalidade de comissão do gestor: progressiva (faixas do painel de Comissões) ou fixa (% do cadastro).

/* ---------------- 1) domain_accounts = vínculos de Usuários ---------------- */
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    WITH acc AS (SELECT id FROM integration_accounts WHERE provider IN ('google-ads', 'meta')),
    want AS (
      SELECT acc.id AS account_id,
             COALESCE((SELECT array_agg(DISTINCT x.domain_id ORDER BY x.domain_id) FROM domain_manager_accounts x JOIN domains d ON d.id = x.domain_id AND NOT d.is_technical
                        WHERE x.account_id = acc.id), '{}') AS ids
        FROM acc),
    cur AS (
      SELECT acc.id AS account_id,
             COALESCE((SELECT array_agg(da.domain_id ORDER BY da.domain_id) FROM domain_accounts da WHERE da.account_id = acc.id), '{}') AS ids
        FROM acc)
    SELECT w.account_id, w.ids FROM want w JOIN cur c ON c.account_id = w.account_id WHERE w.ids <> c.ids
  LOOP
    DELETE FROM domain_accounts WHERE account_id = r.account_id;
    INSERT INTO domain_accounts (domain_id, account_id) SELECT unnest(r.ids), r.account_id;
    DELETE FROM account_domain_history WHERE account_id = r.account_id AND valid_from > CURRENT_DATE;
    INSERT INTO account_domain_history (account_id, valid_from, domain_ids) VALUES (r.account_id, CURRENT_DATE, r.ids)
      ON CONFLICT (account_id, valid_from) DO UPDATE SET domain_ids = EXCLUDED.domain_ids, created_at = now();
  END LOOP;
END $$;

/* ---------------- 2) modalidade de comissão ----------------
   progressive = faixas de finance_commission_rules (editáveis no painel de Comissões)
   fixed       = commission_pct (% única sobre o ROI total do gestor no mês) */
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_mode TEXT NOT NULL DEFAULT 'progressive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(6,3);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_commission_chk;
ALTER TABLE users ADD CONSTRAINT users_commission_chk CHECK (
  commission_mode IN ('progressive', 'fixed')
  AND (commission_mode = 'progressive' OR (commission_pct IS NOT NULL AND commission_pct > 0 AND commission_pct <= 100))
);

-- faixas padrão pedidas: até US$ 19.999,99 = 10% · US$ 20.000 a 39.999,99 = 12% · a partir de US$ 40.000 = 15%
-- (só ajusta a regra se ainda estiver vazia; faixas editadas no painel ficam como estão)
INSERT INTO finance_commission_rules (name, tiers, tier_currency)
SELECT 'Progressiva', '[{"from": 0, "pct": 10}, {"from": 20000, "pct": 12}, {"from": 40000, "pct": 15}]', 'USD'
 WHERE NOT EXISTS (SELECT 1 FROM finance_commission_rules);
