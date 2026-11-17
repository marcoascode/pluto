-- 0.18 · Sufixo das campanhas Meta no formato {{ad.id}}: utm_campaign={{ad.id}}&utm_content={{ad.id}}_{{placement}}.
-- O sync do Ad Manager acha anúncio → conjunto → campanha pelo ID do anúncio (o mesmo formato já usado no Google Ads).
-- Vale para o preview do UTM Debugger e para o url_tags que o criador de campanhas Meta injeta. O template do Google não muda.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('utm_templates', jsonb_build_object('google', 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}_{creative}&utm_term={keyword}&placement={placement}&network={network}&device={device}', 'meta', 'utm_campaign={{ad.id}}&utm_content={{ad.id}}_{{placement}}'), now())
ON CONFLICT (key) DO UPDATE
  SET value = jsonb_set(app_settings.value, '{meta}', to_jsonb('utm_campaign={{ad.id}}&utm_content={{ad.id}}_{{placement}}'::text)),
      updated_at = now();
