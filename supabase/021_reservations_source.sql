-- #21 — Origine della prenotazione
-- 'web'    : widget del sito (default)
-- 'walkin' : cliente entrato dal ristorante (admin)
-- 'phone'  : prenotazione telefonica (admin)
-- 'google' : Reserve with Google (futuro)
alter table reservations
  add column if not exists source text not null default 'web'
  check (source in ('web', 'walkin', 'phone', 'google'));
