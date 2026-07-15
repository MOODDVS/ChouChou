-- ============================================================
-- Tabella `coupons` — codici promo gestiti dall'admin
-- (Marketing → Coupons) e applicati al checkout take-away online.
--
-- Variabili di ogni coupon:
--  - code / code_norm : il codice digitato dal cliente (code_norm = lower(trim)
--                       per lookup case-insensitive, UNIQUE).
--  - discount_type    : 'percent' (1-100) | 'fixed' (montant en centimes).
--  - discount_value   : valore dello sconto (percentuale o centesimi).
--  - max_discount_cents : tetto massimo di sconto in centesimi (opz., vale sia
--                       per % che per fixed). Lo sconto non supera mai né questo
--                       tetto né il subtotale idoneo.
--  - min_spend_cents  : spesa minima del carrello per usarlo (opz.).
--  - schedule_kind    : 'always' | 'dates' | 'weekly' (come i pop-up).
--  - date_start/end   : validità a intervallo di date (schedule 'dates').
--  - days / hour_*    : giorni (0=dom..6=sab) + fascia oraria (schedule 'weekly').
--  - per_customer_limit : usi massimi per singolo cliente (per email; null = illimitato).
--  - global_limit     : usi massimi totali su tutti i clienti (null = illimitato).
--  - categories       : nomi delle sezioni menu a cui si applica (vuoto = tutte).
--  - combine_with_promo : 'stack' (si somma sui prezzi già scontati) |
--                       'exclude' (ignora i piatti già in promo) |
--                       'block' (coupon rifiutato se il carrello ha piatti in promo).
--  - new_customers_only : vale solo per chi non ha mai ordinato prima (per email).
--  - active           : attivo / in pausa.
--
-- Conteggio usi: si leggono gli ORDINI `paid` con quel coupon_id (colonne
-- aggiunte sotto a `orders`). Solo service key. Idempotente.
-- ============================================================
create table if not exists public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  code_norm           text not null unique,
  description         text,
  discount_type       text not null default 'percent'
                        check (discount_type in ('percent','fixed')),
  discount_value      integer not null check (discount_value > 0),
  max_discount_cents  integer check (max_discount_cents is null or max_discount_cents > 0),
  min_spend_cents     integer check (min_spend_cents is null or min_spend_cents >= 0),
  schedule_kind       text not null default 'always'
                        check (schedule_kind in ('always','dates','weekly')),
  date_start          date,
  date_end            date,
  days                int[],
  hour_start          text,
  hour_end            text,
  per_customer_limit  integer check (per_customer_limit is null or per_customer_limit > 0),
  global_limit        integer check (global_limit is null or global_limit > 0),
  categories          text[] not null default '{}',
  combine_with_promo  text not null default 'stack'
                        check (combine_with_promo in ('stack','exclude','block')),
  new_customers_only  boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists idx_coupons_code_norm on public.coupons (code_norm);

alter table public.coupons enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.coupons to service_role;

-- ------------------------------------------------------------
-- Colonne su ORDERS per registrare il coupon usato (conteggio usi).
-- Sicuro rilanciarle (IF NOT EXISTS). Non servono nuovi GRANT: i
-- privilegi di tabella coprono le colonne nuove.
-- ------------------------------------------------------------
alter table public.orders add column if not exists coupon_id uuid;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists coupon_discount_cents integer not null default 0;

create index if not exists idx_orders_coupon on public.orders (coupon_id) where coupon_id is not null;
