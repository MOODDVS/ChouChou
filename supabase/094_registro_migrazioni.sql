-- ============================================================
-- #94 — IL REGISTRO DELLE MIGRAZIONI (Intégrations → Supabase, 5/11/2026)
--
-- Una riga per ogni migrazione applicata dalla casella Supabase del super
-- admin: e' cosi' che la casella sa quali mancano. La crea anche il codice
-- prima di applicare qualunque cosa (`SQL_REGISTRO` in
-- src/lib/admin/supabaseRegole.ts): questo file e' la stessa cosa, per chi
-- lancia `TUTTO.sql` a mano. Senza, tutto funziona come prima; la casella
-- dice solo «registre absent». Idempotente.
-- ============================================================
create table if not exists public.restohub_migrazioni (
  numero integer primary key,
  file text not null,
  applicata_il timestamptz not null default now()
);
alter table public.restohub_migrazioni enable row level security;
grant select, insert, update, delete on public.restohub_migrazioni to service_role;
