-- ============================================================
-- #90 — CHI HA PRESO L'ORDINE (il palmare dei camerieri)
--
-- Sulla scheda del tavolo, accanto a ogni ordine, la faccina e il nome del
-- cameriere che l'ha preso (Enzo, 23/10/2026): «Walk-in» non dice niente,
-- «Marco» si'. Due colonne per una cosa sola, come le note assegnate (#81)
-- e il tavolo (#82): l'id collega alla persona del Team (per la foto), il
-- nome si legge fra sei mesi quando quella persona non lavora piu' qui.
--
--   orders.taken_by_id    la persona in `team` (NULL = palmare del locale
--                         senza dipendente, o ordine dal QR / dal sito)
--   orders.taken_by_name  il nome com'era al momento dell'ordine
--
-- Nessuna foreign key: cancellare una persona dal Team non deve toccare gli
-- incassi. Senza questa migrazione il palmare salva l'ordine lo stesso,
-- solo senza il nome del cameriere.
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.orders add column if not exists taken_by_id uuid;
alter table public.orders add column if not exists taken_by_name text;
