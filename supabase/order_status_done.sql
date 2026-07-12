-- ============================================================
-- Aggiunge lo stato 'done' (ordine preparato/consegnato) agli ordini.
-- Stati: pending (Stripe non completato) → paid (attivo in cucina)
--        → done (terminato) | cancelled (annullato dallo staff).
-- Idempotente.
-- ============================================================
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'paid', 'done', 'cancelled'));
