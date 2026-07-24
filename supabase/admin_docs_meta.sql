-- #40 -- METADATI dei documents dell'ADMIN (pagina Admin → tab Documents).
-- Una riga per documento (chiave = "categoria/nomefile.pdf" nel bucket
-- documents). Usata sopratutto per i CONTRATTI: email di riferimento,
-- data di scadenza e preavviso di recesso.
create table if not exists public.admin_docs_meta (
  path text primary key,
  email text,
  expires date,
  notice_value int,
  notice_unit text,               -- 'jours' | 'mois'
  resiliation_at timestamptz,     -- quando la disdetta e' stata richiesta via email
  updated_at timestamptz not null default now()
);

-- Idempotente: per chi ha lanciato la #40 prima del bottone di disdetta
alter table public.admin_docs_meta add column if not exists resiliation_at timestamptz;

alter table public.admin_docs_meta enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perche' "Automatically expose new tables" e' OFF
grant select, insert, update, delete on public.admin_docs_meta to service_role;
