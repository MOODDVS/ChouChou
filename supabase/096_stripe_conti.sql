-- ============================================================
-- #96 — PIU' CONTI STRIPE (Intégrations → Stripe, 5/11/2026)
--
-- Un ristorante puo' avere piu' conti Stripe (il conto di MOODD e il suo,
-- per esempio) e scegliere da Réglages su quale incassare. Il conto
-- PRINCIPALE resta dov'e' (location_secrets / brand_secrets / .env); qui
-- stanno gli ALTERNATIVI, quanti se ne vuole.
--
--   location_id NULL = conto del marchio (lo vedono anche le sedi che non
--   hanno un conto principale loro); altrimenti della sede.
--   secret_key / webhook_secret: CIFRATI con SECRETS_KEY (src/lib/segreti.ts),
--   mai in chiaro.
--
-- La scelta del conto attivo e' la chiave `stripe_conto_attivo` della
-- configurazione (app_config / location_config): "principale" o l'id di
-- una riga qui. Nessuna policy, nessun grant ad anon/authenticated: solo la
-- service key. Senza, tutto come prima: un conto solo. Idempotente.
-- ============================================================
create table if not exists public.stripe_accounts (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid references public.locations(id) on delete cascade,
  name           text not null,
  secret_key     text not null,
  webhook_secret text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text
);
create index if not exists stripe_accounts_location_idx on public.stripe_accounts (location_id);
alter table public.stripe_accounts enable row level security;
grant select, insert, update, delete on public.stripe_accounts to service_role;
