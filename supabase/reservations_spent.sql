-- #28 · Addition della prenotazione (centesimi)
-- Inserita dallo staff nel modale dettagli quando la prenotazione è "Fini".
-- Legata al cliente tramite email/telefono (come le statistiche visite).

alter table public.reservations
  add column if not exists spent_cents integer;
