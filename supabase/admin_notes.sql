-- ============================================================
-- ADMIN_NOTES — lavagnetta promemoria della Home admin.
-- Note interne dello staff (passaggio di consegne tra un giorno
-- e l'altro). RLS attiva SENZA policy pubblica => leggibili/scrivibili
-- solo con la service key server-side (come orders).
-- Idempotente.
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists public.admin_notes (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  author     text,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Ordine di lettura: attive prima, poi le fatte; nel gruppo, più recenti in cima.
create index if not exists idx_admin_notes_order
  on public.admin_notes (done, created_at desc);

alter table public.admin_notes enable row level security;
-- (nessuna policy: accessibile solo con la service key)

-- GRANT necessario (auto-expose OFF): senza, ogni query dà 42501.
grant select, insert, update, delete on public.admin_notes to service_role;
