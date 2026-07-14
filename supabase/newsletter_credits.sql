-- ============================================================
-- Crediti newsletter acquistati (admin Marketing → Newsletter).
-- Ogni riga = un acquisto via Stripe MOODD. `status`:
--   pending = sessione creata, pagamento non ancora verificato
--   paid    = pagamento verificato, crediti attivi
-- I crediti NON scadono: si consumano solo quando la quota mensile
-- inclusa (1000) è esaurita. Solo service key. Idempotente.
-- ============================================================
create table if not exists public.newsletter_credits (
  id                 uuid primary key default gen_random_uuid(),
  pack               text not null,
  credits            int not null,
  amount_cents       int not null,
  stripe_session_id  text unique,
  status             text not null default 'pending',
  created_at         timestamptz not null default now()
);

alter table public.newsletter_credits enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.newsletter_credits to service_role;
