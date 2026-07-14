-- ============================================================
-- Newsletter (admin Marketing → Newsletter).
-- `newsletter_log`    — storico invii (per la quota mensile: la somma
--                        di `count` nel mese corrente non supera 1000).
-- `newsletter_optout` — email disiscritte tramite il link presente in
--                        ogni newsletter: mai più contattate.
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.newsletter_log (
  id         uuid primary key default gen_random_uuid(),
  subject    text not null,
  count      int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_optout (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table public.newsletter_log enable row level security;
alter table public.newsletter_optout enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.newsletter_log to service_role;
grant select, insert, update, delete on public.newsletter_optout to service_role;
