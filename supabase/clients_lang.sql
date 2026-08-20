-- Colonna lingua del cliente (per le email di conferma nella lingua giusta
-- e per la colonna/i filtri Lingua nella pagina Clienti).
-- Idempotente: sicura da rilanciare.
alter table public.clients add column if not exists lang text;
