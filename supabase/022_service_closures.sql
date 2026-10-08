-- ============================================================
-- #22 — CHIUSURE DI SERVIZIO PER GIORNO (admin Réservations).
-- Il ristoratore chiude un service di una data (es. Soir di stasera):
-- il widget pubblico non proporrà più quel service quel giorno.
-- reason: 'full' = Complet | 'closed' = Fermeture exceptionnelle.
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.service_closures (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  service_key text not null,                  -- midi | soir | … (reservation_services)
  reason      text not null default 'full' check (reason in ('full', 'closed')),
  created_at  timestamptz not null default now(),
  unique (date, service_key)
);

create index if not exists service_closures_date_idx on public.service_closures (date);

alter table public.service_closures enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.service_closures to service_role;
