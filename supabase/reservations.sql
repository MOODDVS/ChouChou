-- ============================================================
-- RÉSERVATIONS V1 (widget proprio, seme del prodotto MOODD).
-- Modello: conferma AUTOMATICA se c'è posto (capienza = somma dei
-- coperti delle sezioni in reservation_zones, meno le prenotazioni
-- confermate che occupano la fascia [heure, heure + hold_minutes]).
-- Il cliente può annullare dal link nell'email (cancel_token).
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  heure        text not null,                 -- "HH:MM" (slot scelto)
  service_key  text,                          -- midi | soir | … (reservation_services)
  people       int  not null check (people >= 1 and people <= 100),
  zone         text,                          -- sezione scelta (null = indifferente/disattivata)
  first_name   text not null,
  last_name    text not null,
  phone        text not null,
  email        text not null,
  lang         text not null default 'fr',    -- lingua del widget al momento della richiesta
  high_chair   boolean not null default false,
  quiet        boolean not null default false,
  business     boolean not null default false,
  company      text,
  notes        text,
  status       text not null default 'confirmed', -- confirmed | cancelled | noshow ('pending' riservato a una futura modalità manuale)
  cancel_token uuid not null default gen_random_uuid(), -- per il link "Annuler ma réservation"
  created_at   timestamptz not null default now()
);

create index if not exists reservations_date_idx on public.reservations (date, status);

alter table public.reservations enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perché "Automatically expose new tables" è OFF
grant select, insert, update, delete on public.reservations to service_role;
