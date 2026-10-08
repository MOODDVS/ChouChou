-- #36 — Plan de salle: tavoli disegnati per section (Reglages -> Reservations)
-- Coordinate in unita' astratte (canvas 1000x600). zone = nome della section
-- in reservation_zones (se rinomini una section, i tavoli restano legati al
-- vecchio nome: per ora vanno ridisegnati o aggiornati a mano).
create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  zone text not null,
  name text not null,
  seats int not null default 4,
  shape text not null default 'square' check (shape in ('round', 'square', 'rect')),
  x real not null default 0,
  y real not null default 0,
  w real not null default 100,
  h real not null default 100,
  created_at timestamptz not null default now()
);

alter table public.restaurant_tables enable row level security;
grant select, insert, update, delete on public.restaurant_tables to service_role;
