-- #38 -- LUNCH: formules del mezzogiorno (tab Lunch della pagina Menu admin).
-- courses jsonb  = portate attive in ordine canonico: ["entree","plat","dessert"]
--                  (solo ["plat"] = Plat du jour)
-- items jsonb    = { entree: [menu_item_id...], plat: [...], dessert: [...] }
--                  (piatti SCELTI dal menu esistente)
-- combos jsonb   = combinazioni MANUALI col prezzo:
--                  [{ parts: ["entree","plat"], price_cents: 1650 }, ...]
-- date_from/date_to = intervallo di validita'; null = senza limite
create table if not exists public.lunch_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Lunch',
  courses jsonb not null default '["plat"]'::jsonb,
  date_from date,
  date_to date,
  items jsonb not null default '{}'::jsonb,
  combos jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lunch_menus enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perche' "Automatically expose new tables" e' OFF
grant select, insert, update, delete on public.lunch_menus to service_role;
