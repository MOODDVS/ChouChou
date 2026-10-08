-- #39 -- NEWSLETTER programmate e ricorrenti (Marketing → Newsletter).
-- send_at    = invio una tantum (UTC); null se ricorrente
-- recur      = 'weekly' | 'monthly'; null se una tantum
-- recur_dow  = 1-7 (lunedì=1), per le settimanali
-- recur_day  = 1-28, per le mensili
-- recur_heure= ora LOCALE del ristorante (0-23)
-- segment    = 'tous' | 'nouveaux' | 'fr' | 'en' | 'top50' | 'resa' | 'commande'
create table if not exists public.newsletter_schedule (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  message text not null,
  image_url text,
  btn_label text,
  btn_url text,
  btn2_label text,
  btn2_url text,
  draft boolean not null default false,
  segment text not null default 'tous',
  send_at timestamptz,
  recur text,
  recur_dow int,
  recur_day int,
  recur_heure int not null default 10,
  active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Idempotenti: per chi ha lanciato la #39 prima di bouton 2 / brouillons
alter table public.newsletter_schedule add column if not exists btn2_label text;
alter table public.newsletter_schedule add column if not exists btn2_url text;
alter table public.newsletter_schedule add column if not exists draft boolean not null default false;

-- Log invii: dati extra per le card "Derniers envois" (idempotenti)
alter table public.newsletter_log add column if not exists image_url text;
alter table public.newsletter_log add column if not exists message text;
alter table public.newsletter_log add column if not exists segment text;
alter table public.newsletter_log add column if not exists btn_label text;
alter table public.newsletter_log add column if not exists btn_url text;
alter table public.newsletter_log add column if not exists btn2_label text;
alter table public.newsletter_log add column if not exists btn2_url text;

alter table public.newsletter_schedule enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perche' "Automatically expose new tables" e' OFF
grant select, insert, update, delete on public.newsletter_schedule to service_role;
