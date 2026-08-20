-- ============================================================
-- Modifica ordini: differenza di importo dopo una modifica.
-- Quando lo staff modifica un ordine GIA' PAGATO ONLINE (sito o payment link):
--   - se il totale AUMENTA  -> supplement_due_cents = differenza da incassare
--     (mail al cliente con link Stripe; il webhook azzera e segna
--      supplement_paid_at quando il cliente paga il supplemento);
--   - se il totale DIMINUISCE -> refund_due_cents = differenza da rimborsare
--     (bottone "Rembourser la difference" sulla card, 1 clic).
-- Un solo lato e' attivo alla volta (netting nel PUT /api/admin/orders).
-- Idempotente.
-- ============================================================
alter table public.orders add column if not exists supplement_due_cents integer not null default 0;
alter table public.orders add column if not exists supplement_paid_at    timestamptz;
alter table public.orders add column if not exists refund_due_cents       integer not null default 0;
