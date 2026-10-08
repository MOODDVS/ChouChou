-- ============================================================
-- #1 — RestoHub — Schema DB
-- Da lanciare nel SQL Editor del progetto Supabase del cliente.
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

-- Seed: sette righe di PARTENZA, non gli orari di nessun ristorante vero.
-- Servizio spezzato 12:00-14:30 / 18:30-22:30, sette giorni su sette, prep 30',
-- slot 15'. Il ristoratore li corregge in Reglages -> Horaires al primo giro.
--
-- ⚠️ `do nothing`, NON un UPSERT, ed e' il punto di questo blocco. Prima era
-- `do update set`: rilanciare questo file su un cliente che gia' lavora — cosa
-- che si fa ogni volta che serve una colonna nuova — gli RISCRIVEVA i sette
-- giorni con quelli scritti qui. Nessun errore, nessuna riga nei log: la gente
-- si presenta in un giorno che il sito dice aperto e trova chiuso. Un seed
-- semina, non corregge: le riparazioni si fanno dall'admin.
insert into public.settings
  (day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes)
values
  (0, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- domenica
  (1, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- lunedì
  (2, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- martedì
  (3, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- mercoledì
  (4, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- giovedì
  (5, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- venerdì
  (6, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15)   -- sabato
on conflict (day_of_week) do nothing;

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

-- ------------------------------------------------------------
-- 4. GRANT dei privilegi ai ruoli API
--    NECESSARIO perché "Automatically expose new tables" è OFF:
--    con quell'opzione Supabase NON concede i privilegi in automatico,
--    quindi vanno dati a mano o ogni query dà "permission denied" (42501).
-- ------------------------------------------------------------
grant select, insert, update, delete on public.menu_items to service_role;
grant select, insert, update, delete on public.settings   to service_role;
grant select, insert, update, delete on public.orders     to service_role;

grant select on public.menu_items to anon, authenticated;
grant select on public.settings   to anon, authenticated;
