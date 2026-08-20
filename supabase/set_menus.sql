-- Menù fissi (tab « Menù » della pagina Menu admin) — menu à prix fixe.
-- Prezzo unico + eventuale supplemento vini; portate personalizzabili (nomi
-- liberi), ognuna con piatti a scelta (id di menu_items). Traduzioni nome e
-- descrizione per lingua del sito pubblico. hide_items: nasconde dal menu
-- pubblico i piatti inseriti (come il lunch).
create table if not exists set_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Menu',
  name_i18n jsonb,
  desc_i18n jsonb,
  image_url text,
  courses jsonb not null default '[]'::jsonb,   -- [{ "name": "...", "items": ["uuid", ...] }]
  price_cents int not null default 0,
  wine_supplement_cents int,
  date_from date,
  date_to date,
  active boolean not null default true,
  hide_items boolean not null default false,
  is_draft boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
