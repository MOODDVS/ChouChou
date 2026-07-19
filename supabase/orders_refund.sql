-- ============================================================
-- Rimborsi ordini (Stripe).
-- Traccia il totale già rimborsato (per rimborsi parziali cumulativi),
-- l'ora dell'ultimo rimborso e l'id dell'ultimo refund Stripe.
-- Evita doppi rimborsi e permette di mostrare lo stato "Remboursé".
-- Idempotente.
-- ============================================================
alter table public.orders add column if not exists refunded_cents integer not null default 0;
alter table public.orders add column if not exists refunded_at   timestamptz;
alter table public.orders add column if not exists last_refund_id text;
