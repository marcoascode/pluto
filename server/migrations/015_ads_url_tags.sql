-- 0.18 · Auditoria do sufixo de UTM dos anúncios Meta.
-- O sync de estrutura da Meta grava aqui o campo url_tags do criativo ("Parâmetros de URL" do anúncio).
-- NULL = ainda não lido (anúncios do Google Ads e anúncios Meta antes do próximo sync de estrutura); '' = lido e vazio.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS url_tags TEXT;
