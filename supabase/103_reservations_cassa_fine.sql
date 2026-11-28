-- ============================================================
-- #103 — QUANDO SI LIBERA IL TAVOLO DOPO «PAGAMENTO IN CASSA» (28/11/2026)
--
-- Completa la #102. `desk_at` resta il momento in cui il conto e' stato
-- chiesto (la pillola blu del palmare dice «da 5 min»); questa colonna dice
-- quando il tavolo si libera («tra 15 min»). Separate perche' il cameriere
-- puo' aggiungere dieci minuti toccando la pillola.
--
--   reservations.desk_until   quando il tavolo si libera da solo. NULL =
--                             desk_at + 20 minuti, come con la sola #102.
--
-- Senza questa migrazione: «+10 min» sposta `desk_at`, e la pillola conta
-- da quel momento. Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.reservations add column if not exists desk_until timestamptz;

create index if not exists reservations_desk_until_idx
  on public.reservations (desk_until)
  where desk_until is not null and status = 'seated';
