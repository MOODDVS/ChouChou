-- ============================================================
-- Tabella `team` — rubrica delle persone che ruotano attorno al
-- ristorante (Réglages → tab Team): personale interno, fornitori,
-- tecnici, consulenti, contabile, partner, ecc.
--
-- Per ora è SOLO una rubrica di contatti (nessun login). I campi
-- `can_access` e `auth_user_id` sono PREDISPOSTI per il futuro: quando
-- si vorrà dare accesso al pannello a una persona, si collegherà il suo
-- utente Supabase Auth qui senza rifare la tabella.
--
-- Categorie (validate lato API, lista fissa): direction, cuisine, salle,
-- admin, fournisseurs, technique, marketing, consultants, partenaires.
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.team (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null default 'direction',
  role         text,               -- fonction / mansione (testo libero)
  is_employee  boolean not null default false,  -- dipendente interno vs esterno
  phone        text,
  email        text,
  phone2       text,               -- secondo contatto (es. fisso/cellulare)
  email2       text,
  company      text,               -- società / ditta (fornitori, consulenti)
  website      text,               -- sito / link utile
  photo_url    text,               -- foto della persona (fallback: iniziali)
  notes        text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  -- --- Predisposizione accesso futuro (per ora NON usati dall'UI) ---
  can_access   boolean not null default false,
  auth_user_id uuid,
  created_at   timestamptz not null default now()
);

-- Colonna aggiunta dopo la prima versione (sicuro rilanciarla).
alter table public.team add column if not exists photo_url text;

create index if not exists idx_team_category on public.team (category, sort_order, name);

alter table public.team enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.team to service_role;
