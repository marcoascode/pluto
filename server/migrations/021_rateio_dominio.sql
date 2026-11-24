-- 021 · 0.18.9 · Rateio do site entre gestores (Admin → Domínios → editar → Rateio)
-- share_pct = % da receita do domínio que vai para o gestor no ROI/comissão. Vale quando TODOS os gestores do domínio
-- têm % e a soma é 100; senão a receita é dividida igualmente. Quando entra ou sai gestor do domínio, o rateio é zerado.
-- Os períodos com datas e rateio de "Gestores e sites" (finance_manager_assignments, editados na edição do gestor em
-- Usuários & Squads) continuam valendo por cima do rateio do domínio nos dias que cobrem.
ALTER TABLE domain_managers ADD COLUMN IF NOT EXISTS share_pct NUMERIC(6,3) CHECK (share_pct IS NULL OR (share_pct > 0 AND share_pct <= 100));
