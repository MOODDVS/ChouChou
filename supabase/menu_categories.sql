-- ============================================================
-- MENU_CATEGORIES — le sezioni del menu come entità gestibile
-- dall'admin (creare/rinominare/riordinare/eliminare).
-- I piatti (menu_items) restano la fonte per il sito pubblico:
-- l'admin tiene sincronizzati category/category_order dei piatti.
-- Seed: importa le categorie già presenti nei piatti.
-- ============================================================
create table if not exists public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 0
);

alter table public.menu_categories enable row level security;

grant select, insert, update, delete on public.menu_categories to service_role;

insert into public.menu_categories (name, sort_order)
select category, min(category_order)
from public.menu_items
group by category
on conflict (name) do nothing;
