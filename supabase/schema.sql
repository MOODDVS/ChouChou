-- ============================================================
-- LA MOLISANA — Schema DB (clone del motore Pizzeria 77)
-- Da lanciare nel SQL Editor del progetto Supabase "La Molisana".
-- Sicuro da rilanciare (idempotente): usa IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- gen_random_uuid() (di norma già attiva su Supabase)
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. MENU_ITEMS — piatti del menu (vetrina + take-away)
--    available  = visibile nel menu vetrina (/menu)
--    orderable  = ordinabile in take-away (/order)
-- ------------------------------------------------------------
create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  category       text    not null,
  category_order integer not null default 0,
  sort_order     integer not null default 0,
  name           text    not null,
  description    text,
  description_fr text,
  description_en text,
  allergens      integer[] not null default '{}',
  price_cents    integer not null check (price_cents >= 0),
  image_url      text,
  available      boolean not null default true,
  orderable      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_menu_items_order
  on public.menu_items (category_order, sort_order);

alter table public.menu_items enable row level security;

-- Lettura pubblica (il codice usa comunque la service key server-side;
-- questa policy replica il comportamento di Pizzeria 77).
drop policy if exists "menu_items lettura pubblica" on public.menu_items;
create policy "menu_items lettura pubblica"
  on public.menu_items for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. SETTINGS — orari per giorno (due fasce: pranzo / cena)
--    Una riga per day_of_week: 0=domenica, 1=lunedì ... 6=sabato.
-- ------------------------------------------------------------
create table if not exists public.settings (
  day_of_week           integer primary key check (day_of_week between 0 and 6),
  lunch_active          boolean not null default false,
  lunch_open            time,
  lunch_close           time,
  dinner_active         boolean not null default false,
  dinner_open           time,
  dinner_close          time,
  prep_time_minutes     integer not null default 30 check (prep_time_minutes >= 0),
  slot_duration_minutes integer not null default 15 check (slot_duration_minutes > 0),
  exceptional_closures  jsonb   not null default '[]'::jsonb
);

alter table public.settings enable row level security;

drop policy if exists "settings lettura pubblica" on public.settings;
create policy "settings lettura pubblica"
  on public.settings for select
  to anon, authenticated
  using (true);

-- Seed: orari REALI di La Molisana. Orario CONTINUATO 11:00-23:30, una sola
-- fascia (usiamo lunch_*, dinner_* disattivata). Martedì (day_of_week 2) chiuso.
-- prep 30', slot 15'. UPSERT: aggiorna anche se le righe esistono già.
insert into public.settings
  (day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes)
values
  (0, true,  '11:00', '23:30', false, null, null, 30, 15),  -- domenica
  (1, true,  '11:00', '23:30', false, null, null, 30, 15),  -- lunedì
  (2, false, null,    null,    false, null, null, 30, 15),  -- MARTEDÌ CHIUSO
  (3, true,  '11:00', '23:30', false, null, null, 30, 15),  -- mercoledì
  (4, true,  '11:00', '23:30', false, null, null, 30, 15),  -- giovedì
  (5, true,  '11:00', '23:30', false, null, null, 30, 15),  -- venerdì
  (6, true,  '11:00', '23:30', false, null, null, 30, 15)   -- sabato
on conflict (day_of_week) do update set
  lunch_active          = excluded.lunch_active,
  lunch_open            = excluded.lunch_open,
  lunch_close           = excluded.lunch_close,
  dinner_active         = excluded.dinner_active,
  dinner_open           = excluded.dinner_open,
  dinner_close          = excluded.dinner_close,
  prep_time_minutes     = excluded.prep_time_minutes,
  slot_duration_minutes = excluded.slot_duration_minutes;

-- ------------------------------------------------------------
-- 3. ORDERS — ordini take-away
--    RLS attiva SENZA policy => accessibile SOLO con la service key
--    (server-side). anon/authenticated non vedono nulla.
-- ------------------------------------------------------------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  pickup_time       timestamptz,
  customer_name     text,
  customer_email    text,
  customer_phone    text,
  items             jsonb   not null default '[]'::jsonb,
  total_cents       integer not null default 0 check (total_cents >= 0),
  lang              text    not null default 'fr' check (lang in ('fr','en')),
  stripe_session_id text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_orders_status_pickup
  on public.orders (status, pickup_time);

alter table public.orders enable row level security;
-- (nessuna policy: solo service key)
