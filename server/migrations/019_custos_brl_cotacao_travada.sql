-- 019 · v0.18.6 · Custos de anúncio (Google Ads e Meta Ads) passam a ser gravados em BRL, na moeda em que as contas pagam.
--       Antes o sync convertia o custo para USD pela cotação do dia e os relatórios convertiam de volta, o que gerava
--       divergência sempre que a cotação do dia mudava depois da importação (ex.: taxa "repetida" substituída pela oficial).
--       Agora: receita (Ad Manager) fica em USD, despesas (Google + Meta + IVA) ficam em BRL, e a conversão só acontece no ROI:
--         ROI (R$) = Receita (US$) × cotação USD/BRL − Despesas (R$)
--       A cotação do ROI é a do mês travada em fx_month_locks; sem trava, a cotação atual com deságio.

-- valores já gravados: USD → BRL pela mesma taxa do dia que o sync usou (a última conhecida até a data)
CREATE TEMP TABLE _brl_rate ON COMMIT DROP AS
  SELECT d.date, (SELECT r.rate_per_usd FROM currency_rates r WHERE r.currency = 'BRL' AND r.date <= d.date ORDER BY r.date DESC LIMIT 1) AS rate
    FROM (SELECT DISTINCT date FROM daily_metrics UNION SELECT DISTINCT date FROM placement_metrics) d;
UPDATE _brl_rate SET rate = (SELECT rate_per_usd FROM currency_rates WHERE currency = 'BRL' ORDER BY date LIMIT 1) WHERE rate IS NULL;

UPDATE daily_metrics m SET spend_usd = round(m.spend_usd * x.rate, 4), iva_usd = round(m.iva_usd * x.rate, 4)
  FROM _brl_rate x WHERE x.date = m.date AND x.rate IS NOT NULL AND (m.spend_usd <> 0 OR m.iva_usd <> 0);
UPDATE placement_metrics m SET spend_usd = round(m.spend_usd * x.rate, 4)
  FROM _brl_rate x WHERE x.date = m.date AND x.rate IS NOT NULL AND m.spend_usd <> 0;

ALTER TABLE daily_metrics RENAME COLUMN spend_usd TO spend_brl;
ALTER TABLE daily_metrics RENAME COLUMN iva_usd TO iva_brl;
ALTER TABLE placement_metrics RENAME COLUMN spend_usd TO spend_brl;

/* Cotação travada por mês (Relatórios → Resultados mensais → Travar cotação).
   Quando a empresa fecha o câmbio dos dólares do Ad Manager de um mês, a cotação aplicada na operação passa a valer
   para o ROI daquele mês e não flutua mais. Sem trava, o ROI do mês usa a cotação atual com deságio. */
CREATE TABLE IF NOT EXISTS fx_month_locks (
  month      DATE PRIMARY KEY CHECK (extract(day FROM month) = 1),   -- primeiro dia do mês
  rate       NUMERIC(10,4) NOT NULL CHECK (rate > 0 AND rate < 100),  -- R$ por US$ aplicado no câmbio
  note       TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
