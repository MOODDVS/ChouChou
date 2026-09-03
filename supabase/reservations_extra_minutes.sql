-- ============================================================
-- reservations.extra_minutes — minuti di ESTENSIONE del tavolo aggiunti
-- dal ristoratore dal modale (+15/+30/+45). La finestra effettiva del
-- tavolo diventa: heure + durée(service) + extra_minutes.
-- Usato da: fase/timer (admin), auto-Fini, disponibilità pubblica, piano sala.
-- Idempotente.
-- ============================================================
alter table public.reservations
  add column if not exists extra_minutes integer not null default 0;
