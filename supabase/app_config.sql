-- ============================================================
-- APP_CONFIG — coppie chiave/valore per configurazioni
-- modificabili dall'admin (es. email cucina).
-- RLS attiva SENZA policy => accesso solo via service key.
-- Idempotente: sicuro da rilanciare.
-- ============================================================
create table if not exists public.app_config (
  key   text primary key,
  value text not null default ''
);

alter table public.app_config enable row level security;

grant select, insert, update, delete on public.app_config to service_role;

insert into public.app_config (key, value)
values ('kitchen_email', 'info@lamolisana.be')
on conflict (key) do nothing;
