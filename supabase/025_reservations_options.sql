-- #25 · Opzioni prenotazione: Anniversaire + Événement spécial
-- Due nuove opzioni selezionabili nel widget pubblico e nel modale admin.

alter table public.reservations
  add column if not exists birthday      boolean not null default false,
  add column if not exists special_event boolean not null default false;
