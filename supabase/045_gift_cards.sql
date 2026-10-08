-- ============================================================
-- #45 — Buoni regalo (Marketing → Bons cadeaux)
--
-- Un buono regalo è VALORE PREPAGATO (non uno sconto come i coupons):
-- ha un saldo che si scala man mano, usabile ONLINE (al checkout) o
-- A MANO in sala (riscatto dall'admin). Fase 1: generati dall'admin.
-- Fase 2 (predisposta): acquisto online del cliente (buyer_email,
-- stripe_session_id, source='purchase').
--
--  - code / code_norm   : codice del buono (code_norm = lower(trim), UNIQUE
--                         per lookup case-insensitive).
--  - initial_cents      : valore iniziale in centesimi.
--  - balance_cents      : saldo residuo (parte = initial_cents, scala coi
--                         riscatti; 0 = esaurito). Fonte di verità = ledger.
--  - active             : attivo / sospeso (blocca l'uso senza cancellare).
--  - expires_at         : scadenza opzionale (null = nessuna).
--  - source             : 'admin' (generato) | 'purchase' (comprato online, fase 2).
--  - recipient_name/email, sender_name, message : dati del regalo (email opz.).
--  - buyer_email, stripe_session_id : fase 2 (acquisto online).
--  - created_by         : email admin che l'ha generato.
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.gift_cards (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  code_norm         text not null unique,
  initial_cents     integer not null check (initial_cents > 0),
  balance_cents     integer not null check (balance_cents >= 0),
  active            boolean not null default true,
  expires_at        date,
  source            text not null default 'admin'
                      check (source in ('admin','purchase')),
  recipient_name    text,
  recipient_email   text,
  recipient_phone   text,
  sender_name       text,
  sender_email      text,
  sender_phone      text,
  message           text,
  ship              boolean not null default false,
  ship_address      text,
  ship_zip          text,
  ship_city         text,
  ship_country      text,
  shipping_cents    integer not null default 0,
  payment_method    text not null default 'cash'
                      check (payment_method in ('cash','card','link')),
  paid              boolean not null default true,
  paid_at           timestamptz,
  pay_token         uuid not null default gen_random_uuid(),
  buyer_email       text,
  stripe_session_id text,
  created_by        text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_gift_cards_code_norm on public.gift_cards (code_norm);
alter table public.gift_cards enable row level security;
grant select, insert, update, delete on public.gift_cards to service_role;
-- Colonna aggiunta dopo il primo rilascio: idempotente per tabelle già create.
alter table public.gift_cards add column if not exists recipient_phone text;
-- #70: lingue di mittente/destinatario (email + PDF). NULL = default sito pubblico.
alter table public.gift_cards add column if not exists sender_lang    text;
alter table public.gift_cards add column if not exists recipient_lang text;
alter table public.gift_cards add column if not exists sender_email text;
alter table public.gift_cards add column if not exists sender_phone text;
alter table public.gift_cards add column if not exists ship boolean not null default false;
alter table public.gift_cards add column if not exists ship_address text;
alter table public.gift_cards add column if not exists ship_zip text;
alter table public.gift_cards add column if not exists ship_city text;
alter table public.gift_cards add column if not exists ship_country text;
alter table public.gift_cards add column if not exists shipping_cents integer not null default 0;
alter table public.gift_cards add column if not exists payment_method text not null default 'cash';
alter table public.gift_cards add column if not exists paid boolean not null default true;
alter table public.gift_cards add column if not exists paid_at timestamptz;
alter table public.gift_cards add column if not exists pay_token uuid not null default gen_random_uuid();
create index if not exists idx_gift_cards_pay_token on public.gift_cards (pay_token);

-- ------------------------------------------------------------
-- Registro dei riscatti (ledger). Il saldo = initial - somma(amount).
-- kind 'online' = scalato a un ordine (order_id valorizzato); kind
-- 'manual' = riscatto in sala dall'admin (note libera). Idempotente.
-- ------------------------------------------------------------
create table if not exists public.gift_card_redemptions (
  id            uuid primary key default gen_random_uuid(),
  gift_card_id  uuid not null references public.gift_cards(id) on delete cascade,
  amount_cents  integer not null check (amount_cents > 0),
  kind          text not null default 'manual'
                  check (kind in ('online','manual')),
  order_id      uuid,
  note          text,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_gcr_card on public.gift_card_redemptions (gift_card_id);
alter table public.gift_card_redemptions enable row level security;
grant select, insert, update, delete on public.gift_card_redemptions to service_role;

-- ------------------------------------------------------------
-- Colonne su ORDERS per registrare il buono usato online (fase B),
-- come per i coupons. Sicuro rilanciarle (IF NOT EXISTS).
-- ------------------------------------------------------------
alter table public.orders add column if not exists gift_card_id uuid;
alter table public.orders add column if not exists gift_card_code text;
alter table public.orders add column if not exists gift_card_cents integer not null default 0;
create index if not exists idx_orders_gift on public.orders (gift_card_id) where gift_card_id is not null;
