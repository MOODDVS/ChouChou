-- #43 — Flag "à recontacter" sulle prenotazioni.
-- Valorizzato quando, chiudendo una SECTION (Fermeture exceptionnelle), il
-- ristoratore sceglie di richiamare a voce il cliente (non spostato, non annullato).
-- Colonna su tabella gia' concessa a service_role -> nessun GRANT nuovo. Idempotente.
alter table public.reservations
  add column if not exists recontact boolean not null default false;
