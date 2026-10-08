-- #26 · Orario di arrivo al tavolo (timer "En cours")
-- Impostato quando lo staff mette manualmente lo stato "En cours" (seated):
-- il timer del tavolo parte dall'arrivo reale, non dall'ora prenotata.

alter table public.reservations
  add column if not exists seated_at timestamptz;
