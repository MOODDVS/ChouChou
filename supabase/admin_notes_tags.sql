-- #34 — Tag sulle note admin (Important / Recurrent / Fournisseur)
-- Colonna jsonb: lista di tag testuali, es. ["important","fournisseur"].
-- Tabella gia' concessa a service_role: nessun GRANT necessario.
alter table public.admin_notes add column if not exists tags jsonb;
