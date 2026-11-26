-- ============================================================
-- #100 — RLS SULLE QUATTRO TABELLE CHE NON L'AVEVANO (audit 26/11/2026)
--
-- `print_tickets` (#76), `table_calls` (#83), `table_rounds` (#87) e
-- `table_payments` (#88) sono nate senza «enable row level security».
-- Oggi non si vedono dall'API pubblica solo perche' in questi progetti le
-- tabelle nuove nascono senza privilegi per anon e authenticated: e' un
-- interruttore del progetto Supabase, non una regola scritta qui. Un
-- progetto con «Automatically expose new tables» acceso, o un GRANT dato a
-- mano un giorno, aprirebbe chiamate, conti e pagamenti dei tavoli a
-- chiunque abbia la chiave anon (che sta nel browser).
--
-- Con RLS accesa e nessuna policy: anon e authenticated non leggono e non
-- scrivono niente; il server usa il service_role, che RLS la salta. Quindi
-- per il motore non cambia nulla. Idempotente.
-- ============================================================
alter table if exists public.print_tickets  enable row level security;
alter table if exists public.table_calls    enable row level security;
alter table if exists public.table_rounds   enable row level security;
alter table if exists public.table_payments enable row level security;
