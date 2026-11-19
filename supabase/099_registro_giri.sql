-- ============================================================
-- #99 — IL REGISTRO DEI GIRI DEI JOB (admin.restohub.cloud, 19/11/2026)
--
-- Una riga per job (`/api/cron/*`): quando e' passato l'ultima volta, con
-- che risposta, quanto ci ha messo, e l'ultima volta che e' andato bene. La
-- scrive il middleware del motore, solo per le chiamate con la chiave giusta
-- (`x-cron-key`). La legge `/api/restohub/stato`, cioe' la scheda del
-- cliente nell'admin di RestoHub.
--
-- Perche' qui e non in `cron.job_run_details`: quella dice solo che pg_cron
-- ha lanciato la richiesta, non come ha risposto il sito; e si legge solo
-- col token di gestione, che sui server non c'e'.
--
-- Senza, tutto come prima: la scheda dice «registro assente». Idempotente.
-- ============================================================
create table if not exists public.restohub_giri (
  job        text primary key,
  ultimo     timestamptz not null default now(),
  esito      integer not null,
  ms         integer not null default 0,
  ultimo_ok  timestamptz
);
alter table public.restohub_giri enable row level security;
grant select, insert, update, delete on public.restohub_giri to service_role;
