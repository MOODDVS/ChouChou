-- #37 -- Plan de salle fase 2: tavoli assegnati automaticamente alla prenotazione.
-- jsonb = array di uuid (id di restaurant_tables), es. ["a1...", "b2..."].
-- null = nessuna assegnazione (plan mode spento alla creazione, oppure
-- nessuna combinazione libera -> l'admin ha bypassato l'avviso).
-- L'assegnazione e' ricalcolata a ogni modifica di data/ora/persone/section.

alter table public.reservations
  add column if not exists tables jsonb;
