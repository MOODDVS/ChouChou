-- #24 — Email di recensione per le prenotazioni.
-- Salva l'id dell'email programmata su Resend, così un annullamento
-- o un no-show possono cancellarla prima dell'invio.
alter table reservations
  add column if not exists review_email_id text;
