-- ============================================================
-- #95 — LA CASELLA RESEND (Intégrations → Resend, 5/11/2026)
--
-- 1. `brand_secrets`: i segreti del MARCHIO (uno per installazione, non per
--    sede). Il primo e' la chiave Resend del cliente, scritta dal super
--    admin nella casella invece che nel `.env`. Il valore e' CIFRATO
--    (AES-256-GCM con `SECRETS_KEY`, src/lib/segreti.ts): il database da
--    solo non basta a leggerla. Nessuna policy e nessun grant ad
--    anon/authenticated: solo la service key.
-- 2. `email_counter`: quante email transazionali (conferme, avvisi,
--    promemoria…) sono partite, mese per mese. Le newsletter si contano gia'
--    in `newsletter_log`. Si incrementa con `email_counter_bump`, che fa
--    l'insert-o-somma in un colpo solo: due email nello stesso istante non
--    si mangiano a vicenda il conteggio.
--
-- Senza, tutto come prima: la chiave resta quella del `.env` e la casella
-- non mostra il conteggio. Idempotente.
-- ============================================================
create table if not exists public.brand_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.brand_secrets enable row level security;
grant select, insert, update, delete on public.brand_secrets to service_role;

create table if not exists public.email_counter (
  month      text primary key, -- 'YYYY-MM', nel fuso dell'installazione
  sent       integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.email_counter enable row level security;
grant select, insert, update, delete on public.email_counter to service_role;

create or replace function public.email_counter_bump(p_month text, p_n integer default 1)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.email_counter (month, sent) values (p_month, greatest(p_n, 0))
  on conflict (month) do update
    set sent = public.email_counter.sent + excluded.sent, updated_at = now();
$$;
revoke all on function public.email_counter_bump(text, integer) from public, anon, authenticated;
grant execute on function public.email_counter_bump(text, integer) to service_role;
