-- ============================================================
-- PRINT_ORDERS — ordini di prodotti stampati che il ristoratore
-- acquista da MOODD (menu, biglietti da visita, ecc.).
--
-- Pagato sullo Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i buoni
-- fisici e i crediti newsletter — NON sullo Stripe del ristorante.
-- L'indirizzo di spedizione è raccolto da Stripe Checkout.
--
--  - product_slug/label : snapshot del prodotto al momento dell'ordine.
--  - qty                : quantità del lotto scelto (es. 100 copie).
--  - amount_cents       : prezzo pagato per il lotto (snapshot).
--  - meta               : caratteristiche (formato/pagine/carta/colore) snapshot.
--  - stripe_session_id  : sessione Checkout (UNIQUE = idempotenza).
--  - status             : 'pending' alla creazione → 'paid' alla conferma.
--  - shipped_at         : quando MOODD ha spedito (uso interno).
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.print_orders (
  id                uuid primary key default gen_random_uuid(),
  product_slug      text not null,
  product_label     text not null,
  qty               integer not null check (qty > 0),
  amount_cents      integer not null check (amount_cents >= 0),
  meta              jsonb not null default '{}'::jsonb,
  stripe_session_id text unique,
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  buyer_email       text,
  paid_at           timestamptz,
  shipped_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_print_orders_status on public.print_orders (status);
alter table public.print_orders enable row level security;
grant select, insert, update, delete on public.print_orders to service_role;
