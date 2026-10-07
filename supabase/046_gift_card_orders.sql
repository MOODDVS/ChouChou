-- ============================================================
-- #46 — Ordini di BUONI FISICI acquistati dal ristoratore presso MOODD.
--
-- Il ristoratore compra dei cartoncini "bon cadeau" stampati da MOODD
-- (Marketing → Bons cadeaux → « Acheter des bons »). Il pagamento va sullo
-- Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i crediti newsletter —
-- NON sullo Stripe del ristorante. L'indirizzo di spedizione è raccolto
-- da Stripe Checkout.
--
--  - qty / amount_cents  : quantità del pack e prezzo pagato.
--  - stripe_session_id   : sessione Checkout (UNIQUE = idempotenza).
--  - status              : 'pending' alla creazione → 'paid' alla conferma.
--  - shipped_at          : quando MOODD ha spedito (uso interno).
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.gift_card_orders (
  id                uuid primary key default gen_random_uuid(),
  qty               integer not null check (qty > 0),
  amount_cents      integer not null check (amount_cents >= 0),
  stripe_session_id text unique,
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  buyer_email       text,
  shipped_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_gc_orders_status on public.gift_card_orders (status);
alter table public.gift_card_orders enable row level security;
grant select, insert, update, delete on public.gift_card_orders to service_role;
