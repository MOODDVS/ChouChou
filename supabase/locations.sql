-- ============================================================
-- #73 — MULTI-SEDE, passo 1: lo SCHEMA. Nessun cambiamento visibile.
--
-- Disegno (deciso 08/09/2026, dettagliato 13/09/2026):
--   UNA sola installazione, `location_id` su tutte le tabelle,
--   e **NULL significa «vale per tutte le sedi»**.
--
-- Conseguenza che rende questa migrazione sicura: la colonna nasce
-- NULLABLE e senza default, quindi le righe che esistono oggi restano
-- tutte a NULL. Per un cliente con un punto solo NULL e' la verita', e
-- niente cambia comportamento. Chi ha una sede sola non se ne accorge.
--
-- ⚠️ `location_id` resta nullable ANCHE sulle tabelle che sono sempre di
-- una sede (orders, reservations…). Verrebbe voglia di metterle NOT NULL
-- per farsi proteggere dal database, ma le righe dei quattro clienti
-- attuali sono a NULL e sono corrette cosi'. La disciplina sta nel
-- codice, in un punto solo, non nel vincolo.
--
-- NON tocca nessuna chiave primaria. Le due tabelle la cui PK e' un
-- identificatore naturale (`app_config.key`, `settings.day_of_week`)
-- restano intatte: la variante per sede vive in una tabella di
-- SOVRASCRITTURA (in fondo). Stessa forma che avra' l'esaurito del menu:
-- riga assente = vale quella del marchio.
--
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LOCATIONS — le sedi. Vuota = installazione a sede unica.
--    Una sede non e' un nome: e' una societa' con un indirizzo, un
--    fuso, una scheda Google e uno slug sul sito pubblico.
-- ------------------------------------------------------------
create table if not exists public.locations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,              -- «Jourdan»
  slug               text not null unique,       -- «jourdan» → URL pubblico
  address            text    not null default '',
  postcode           text    not null default '',
  city               text    not null default '',
  phone              text    not null default '',
  email              text    not null default '',
  timezone           text    not null default 'Europe/Brussels',
  company_name       text    not null default '', -- societa' che fattura qui
  company_vat        text    not null default '',
  google_location    text,                        -- "accounts/../locations/.." della SUA scheda
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create index if not exists locations_order_idx on public.locations (sort_order, name);

alter table public.locations enable row level security;
grant select, insert, update, delete on public.locations to service_role;

-- ------------------------------------------------------------
-- 2. location_id SU TUTTE LE TABELLE
--    `on delete restrict`: cancellare una sede NON deve portarsi via
--    i suoi ordini. Prima si spostano o si archiviano, poi si cancella.
--    app_config e settings sono ESCLUSE di proposito (punto 5).
-- ------------------------------------------------------------
do $$
declare
  t text;
  tabelle text[] := array[
    'admin_docs_meta', 'admin_notes', 'agenda_events', 'clients', 'coupons',
    'gift_card_orders', 'gift_card_redemptions', 'gift_cards', 'google_reviews',
    'lunch_menus', 'menu_categories', 'menu_items', 'newsletter_credits',
    'newsletter_log', 'newsletter_optout', 'newsletter_schedule', 'orders',
    'page_views', 'popups', 'print_orders', 'push_subscriptions', 'reservations',
    'restaurant_tables', 'service_closures', 'set_menus', 'special_days',
    'team', 'zone_closures'
  ];
begin
  foreach t in array tabelle loop
    -- La tabella puo' non esistere: alcune arrivano da migrazioni
    -- opzionali (#45 buoni, #47 traffico, #68 stampa). Si salta.
    if to_regclass('public.' || t) is null then
      raise notice 'salto %: tabella assente', t;
      continue;
    end if;
    execute format(
      'alter table public.%I add column if not exists location_id uuid
         references public.locations(id) on delete restrict', t);
    execute format(
      'create index if not exists %I on public.%I (location_id)',
      t || '_location_idx', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. I VINCOLI UNICI CHE CONTENGONO UNA DATA
--    `service_closures unique (date, service_key)` e
--    `zone_closures unique (date, zone)` oggi impediscono il doppione.
--    Con piu' sedi devono diventare per sede, o Jourdan non potrebbe
--    chiudere una data gia' chiusa altrove.
--
--    ⚠️ Il punto delicato: in SQL standard NULL non e' uguale a NULL,
--    quindi un `unique (location_id, date, service_key)` normale
--    NON protegge piu' le righe a NULL — cioe' proprio i quattro
--    clienti attuali, che perderebbero in silenzio la protezione dal
--    doppione che hanno oggi. `NULLS NOT DISTINCT` (Postgres 15+)
--    tratta i NULL come uguali ed e' esattamente quello che serve.
--    Sotto la 15 si ripiega su un indice su coalesce().
-- ------------------------------------------------------------

-- 3a. Via i vecchi vincoli a due colonne, trovati per struttura e non
--     per nome: il nome e' generato da Postgres e indovinarlo male
--     vorrebbe dire lasciare in piedi il vincolo sbagliato in silenzio.
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and con.contype = 'u'
       and rel.relname in ('service_closures', 'zone_closures')
       and array_length(con.conkey, 1) = 2
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    raise notice 'rimosso vincolo % su %', c.conname, c.relname;
  end loop;
end $$;

-- 3b. I nuovi indici unici, per sede.
do $$
declare
  moderno boolean := current_setting('server_version_num')::int >= 150000;
  vuoto   constant text := '00000000-0000-0000-0000-000000000000';
begin
  -- Guardia come al punto 2: una tabella assente non deve far abortire la
  -- migrazione a meta', lasciando le colonne aggiunte e i vincoli no.
  if to_regclass('public.service_closures') is null
     or to_regclass('public.zone_closures') is null then
    raise notice 'salto i vincoli: chiusure di servizio/zona assenti';
    return;
  end if;
  if moderno then
    execute 'create unique index if not exists service_closures_sede_date_key
               on public.service_closures (location_id, date, service_key) nulls not distinct';
    execute 'create unique index if not exists zone_closures_sede_date_key
               on public.zone_closures (location_id, date, zone) nulls not distinct';
  else
    execute format('create unique index if not exists service_closures_sede_date_key
               on public.service_closures (coalesce(location_id, %L::uuid), date, service_key)', vuoto);
    execute format('create unique index if not exists zone_closures_sede_date_key
               on public.zone_closures (coalesce(location_id, %L::uuid), date, zone)', vuoto);
    raise notice 'Postgres < 15: usati indici su coalesce()';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. GOOGLE_REVIEWS — nessun problema di chiave
--    `review_id` e' l'id che Google assegna alla recensione ed e' unico
--    fra tutte le schede: tre sedi non collidono. La colonna
--    `location_id` aggiunta sopra serve solo a sapere di chi e'.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 5. LE DUE TABELLE CON LA CHIAVE NATURALE — sovrascrittura, non chirurgia
--
--    `app_config` ha `key` come chiave primaria, `settings` ha
--    `day_of_week`. In Postgres le colonne di una primary key sono NOT
--    NULL per definizione: `location_id` nullable li' dentro non ci
--    entra. Rifare quelle due chiavi vorrebbe dire toccare tabelle che
--    tutti e quattro i clienti usano a ogni richiesta, e riscrivere
--    ogni upsert.
--
--    Invece: le tabelle di oggi restano il livello del MARCHIO, e le
--    due tabelle qui sotto contengono SOLO le righe di una sede che
--    sovrascrivono quel livello. `location_id` qui e' NOT NULL, quindi
--    la chiave composta funziona senza trucchi.
--
--    Lettura, sempre: cerca la riga della sede; se non c'e', usa quella
--    del marchio. Per un cliente a sede unica queste tabelle restano
--    vuote e non viene letta nemmeno una riga in piu'.
-- ------------------------------------------------------------

-- 5a. Configurazioni per sede (fuso, email cucina, parametri prenotazione…).
--     Le chiavi di marchio (tema, lingue, brand_*) restano in app_config.
create table if not exists public.location_config (
  location_id uuid not null references public.locations(id) on delete cascade,
  key         text not null,
  value       text not null default '',
  primary key (location_id, key)
);

alter table public.location_config enable row level security;
grant select, insert, update, delete on public.location_config to service_role;

-- 5b. Orari per sede. Stesse colonne di `settings`: la riga sovrascrive
--     il giorno INTERO, non un campo. Riga assente = orari del marchio.
create table if not exists public.location_settings (
  location_id           uuid not null references public.locations(id) on delete cascade,
  day_of_week           integer not null check (day_of_week between 0 and 6),
  lunch_active          boolean not null default false,
  lunch_open            time,
  lunch_close           time,
  dinner_active         boolean not null default false,
  dinner_open           time,
  dinner_close          time,
  prep_time_minutes     integer not null default 30 check (prep_time_minutes >= 0),
  slot_duration_minutes integer not null default 15 check (slot_duration_minutes > 0),
  exceptional_closures  jsonb   not null default '[]'::jsonb,
  primary key (location_id, day_of_week)
);

alter table public.location_settings enable row level security;
grant select, insert, update, delete on public.location_settings to service_role;

-- 5c. SEGRETI per sede — tabella SEPARATA, di proposito.
--
--     450 Gradi sono tre societa' con tre conti: ogni sede incassa sul
--     suo Stripe. La chiave quindi non puo' piu' stare nell'ambiente
--     (una per installazione), deve stare per sede.
--
--     ⚠️ Perche' non dentro `location_config`: quella e' la chiave/valore
--     generica, e prima o poi esistera' una lettura «dammi tutta la
--     configurazione di questa sede» che finisce nell'admin. Il giorno
--     che qualcuno la usa senza pensarci, le chiavi Stripe partono verso
--     il browser. Tenendole qui, quella lettura non le vede proprio:
--     l'unico codice che tocca questa tabella e' la fabbrica del client
--     Stripe, lato server.
--
--     Chiavi previste: stripe_secret_key, stripe_webhook_secret.
--     (`resend_from` NON e' un segreto e sta in location_config.)
--
--     Sede assente o chiave assente = si ripiega sull'ambiente, cioe' il
--     comportamento di oggi per tutti e quattro i clienti attuali.
create table if not exists public.location_secrets (
  location_id uuid not null references public.locations(id) on delete cascade,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (location_id, key)
);

alter table public.location_secrets enable row level security;
-- Nessuna policy, e nessun grant ad anon/authenticated: solo service key.
grant select, insert, update, delete on public.location_secrets to service_role;

-- ------------------------------------------------------------
-- 6. DOCUMENTI — la separazione sta nel percorso, non nella chiave
--    `admin_docs_meta.path` e' la chiave primaria e ricalca il percorso
--    nel bucket (`categoria/nome.pdf`). Con piu' sedi il bucket va
--    separato comunque, quindi il percorso diventa
--    `sede/<slug>/categoria/nome.pdf` e la chiave continua a funzionare
--    cosi' com'e'. Niente da cambiare qui: e' una regola del codice.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 7. L'interruttore `multi_location` (on|off) vive in `app_config` ed e'
--    scritto dal super admin: non lo crea questa migrazione. Assente o
--    'off' = installazione a sede unica, che e' lo stato di tutti oggi.
-- ------------------------------------------------------------
