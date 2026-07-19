-- #27 · Durata reale del tavolo (minuti)
-- Valorizzata quando la prenotazione diventa "Fini":
--  · Fini manuale  → minuti reali dall'arrivo (seated_at, altrimenti heure) al click
--  · auto-Fini     → durée du service + 15 min (il manager ha lasciato correre)
--  · no-show / annulée / ritorno a Confirmée → azzerata (null)

alter table public.reservations
  add column if not exists table_minutes integer;
