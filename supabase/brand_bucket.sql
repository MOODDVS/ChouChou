-- #35 — Bucket Storage "brand" (loghi + favicon del cliente, pubblici)
-- Caricati da Reglages -> General; URL salvati in app_config
-- (brand_logo, brand_logo_negative, brand_logo_mono, brand_favicon).
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;
