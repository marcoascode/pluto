-- 003 · Placements (onde os anúncios do Google Ads apareceram) × receita do Ad Manager por placement

/* Uma linha por origem × dia × domínio × campanha × placement.
   google-ads: custo/cliques/impressões do detail_placement_view (Display, Demand Gen, YouTube).
   gam:        receita BRUTA e delivery do relatório com o key-value "placement" (o site repassa o {placement}
               da URL do anúncio para o GPT). O revShare do domínio é aplicado na consulta, como em daily_metrics.
   placement:      chave normalizada (host sem www, "youtube.com" ou "mobileapp::…"), igual nos dois lados.
   placement_root: domínio principal (lp.site.com → site.com) para agrupar subdomínios. */
CREATE TABLE placement_metrics (
  source              TEXT NOT NULL CHECK (source IN ('google-ads', 'gam')),
  date                DATE NOT NULL,
  domain_id           BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  campaign_id         BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,       -- null = receita com campanha não localizada
  placement           TEXT NOT NULL,
  placement_root      TEXT NOT NULL,
  spend_usd           NUMERIC(14,4) NOT NULL DEFAULT 0,
  traffic_clicks      BIGINT NOT NULL DEFAULT 0,
  traffic_impressions BIGINT NOT NULL DEFAULT 0,
  revenue_usd         NUMERIC(14,4) NOT NULL DEFAULT 0,                         -- bruta
  impressions         BIGINT NOT NULL DEFAULT 0,
  ad_requests         BIGINT NOT NULL DEFAULT 0,
  responses_served    BIGINT NOT NULL DEFAULT 0,
  ad_clicks           BIGINT NOT NULL DEFAULT 0,
  viewable            BIGINT NOT NULL DEFAULT 0,
  is_final            BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX placement_metrics_grain_uq ON placement_metrics (source, date, domain_id, COALESCE(campaign_id, 0), placement);
CREATE INDEX placement_metrics_domain_date_idx ON placement_metrics (domain_id, date);
CREATE INDEX placement_metrics_campaign_date_idx ON placement_metrics (campaign_id, date) WHERE campaign_id IS NOT NULL;
CREATE INDEX placement_metrics_source_date_idx ON placement_metrics (source, date);

/* Nome amigável (apps e canais do YouTube vêm com display_name do Google Ads). */
CREATE TABLE placement_labels (
  placement  TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  type       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_settings (id, provider, label, window_desc, every_minutes, next_run_at) VALUES
  ('google-ads.placements', 'google-ads', 'Custo por placement (onde o anúncio apareceu)', 'incremental · D-3 → hoje',    60, now()),
  ('gam.placements',        'gam',        'Receita por placement (key-value placement)',    'reprocessa hoje e D-1 a D-3', 60, now())
ON CONFLICT (id) DO NOTHING;
