-- ============================================================
-- #23 — CHIUSURE DI SEZIONE PER GIORNO (admin Réservations).
-- Il ristoratore chiude una section per una data (es. Terrasse
-- per pioggia): quel giorno la section sparisce dal widget e i
-- suoi coperti non contano nella capienza.
-- reason: 'full' = Complet | 'closed' = Fermeture exceptionnelle.
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.zone_closures (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  zone       text not null,                   -- nome della section (reservation_zones)
  reason     text not null default 'closed' check (reason in ('full', 'closed')),
  created_at timestamptz not null default now(),
  unique (date, zone)
);

create index if not exists zone_closures_date_idx on public.zone_closures (date);

alter table public.zone_closures enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.zone_closures to service_role;
