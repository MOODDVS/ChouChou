-- #44 — Iscrizioni push (PWA admin). Ogni device/browser del ristoratore che
-- attiva le notifiche salva qui la sua subscription (endpoint + chiavi). Le
-- iscrizioni scadute (404/410) vengono ripulite in automatico all'invio.
-- Solo service key. Idempotente.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_email text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to service_role;
