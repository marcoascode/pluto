-- 022 · 0.18.10 · Faixas da comissão progressiva no cadastro de cada gestor (Usuários & Squads), como a % da fixa.
--   commission_tiers         = [{ "from": 0, "pct": 10 }, …] na moeda commission_tier_currency (só na modalidade progressiva)
--   padrão progressiva       = até US$ 19.999,99 → 10% · US$ 20.000,00 a 39.999,99 → 12% · a partir de US$ 40.000,00 → 15%
--   padrão fixa              = 10%
-- Os gestores que já estavam na progressiva recebem as faixas que valiam no painel de Comissões (finance_commission_rules),
-- que deixa de ser editável e fica só como histórico.
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_tiers JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_tier_currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (commission_tier_currency IN ('BRL', 'USD', 'EUR'));

UPDATE users u SET
  commission_tiers = COALESCE((SELECT r.tiers FROM finance_commission_rules r ORDER BY r.id LIMIT 1), '[{"from": 0, "pct": 10}, {"from": 20000, "pct": 12}, {"from": 40000, "pct": 15}]'::jsonb),
  commission_tier_currency = COALESCE((SELECT r.tier_currency FROM finance_commission_rules r ORDER BY r.id LIMIT 1), 'USD')
 WHERE u.commission_mode = 'progressive' AND u.commission_tiers IS NULL;
