-- 018 · v0.18.0 · Rastreador do Pluto v1.2: impressões por bloco de anúncios × país × dispositivo, incluindo as visitas
--       SEM UTM (orgânicas, com utm_* vazios). Com elas, a receita de cada célula do Ad Manager
--       (dia × site × bloco × país × dispositivo, relatório só com dimensões nativas) é dividida pela participação de cada
--       campanha nas impressões rastreadas da célula, sem depender dos key-values (ver services/trackerShare.ts).
--       Não guarda IP nem dado pessoal: só UTMs, o caminho do bloco no GPT, o país (ISO-2) e o tipo de dispositivo.
CREATE TABLE IF NOT EXISTS tracker_impressions (
  date         DATE   NOT NULL,
  domain_id    BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  utm_campaign TEXT   NOT NULL DEFAULT '',
  utm_content  TEXT   NOT NULL DEFAULT '',
  utm_source   TEXT   NOT NULL DEFAULT '',
  ad_unit      TEXT   NOT NULL DEFAULT '',   -- googletag slot.getAdUnitPath(), ex.: /1234/site/topo
  country      TEXT   NOT NULL DEFAULT '',   -- ISO-2 pelo IP ('' = desconhecido)
  device       TEXT   NOT NULL DEFAULT '',   -- desktop | smartphone | tablet ('' = desconhecido)
  impressions  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, domain_id, utm_campaign, utm_content, utm_source, ad_unit, country, device)
);
CREATE INDEX IF NOT EXISTS tracker_impressions_dom_idx ON tracker_impressions (domain_id, date);
