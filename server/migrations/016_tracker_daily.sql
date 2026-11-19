-- 0.18 · Rastreador próprio de UTMs (script do Pluto nos sites, POST /api/collect).
-- Conta, por dia × site × UTMs, as páginas vistas e as impressões renderizadas pelo GPT (slotRenderEnded não vazio).
-- O sync do Ad Manager usa estas contagens para atribuir às campanhas a receita que ficou "sem campanha"
-- (key-value fora do relatório: limite de valores reportáveis do Ad Manager). Ver services/tracker.ts.
CREATE TABLE IF NOT EXISTS tracker_daily (
  date         DATE   NOT NULL,
  domain_id    BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  utm_campaign TEXT   NOT NULL DEFAULT '',
  utm_content  TEXT   NOT NULL DEFAULT '',
  utm_source   TEXT   NOT NULL DEFAULT '',
  pageviews    BIGINT NOT NULL DEFAULT 0,
  impressions  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, domain_id, utm_campaign, utm_content, utm_source)
);
