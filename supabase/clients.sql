-- ============================================================
-- Tabella `clients` — clienti aggiunti/gestiti a mano dall'admin.
-- La pagina /admin/clients UNISCE questi ai clienti calcolati dagli
-- ordini (paid/done): un cliente manuale che poi ordina viene fuso
-- per email. Utile per registrare contatti (habitué, ordini al telefono).
-- Solo service key (come orders / admin_notes): nessuna lettura pubblica.
-- Idempotente.
-- ============================================================
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);

-- Ricerca rapida per email (fusione con gli ordini)
create index if not exists idx_clients_email on public.clients (lower(email));

alter table public.clients enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perché "Automatically expose new tables" è OFF
grant select, insert, update, delete on public.clients to service_role;
