-- ============================================================
-- RestoHub — TUTTE LE MIGRAZIONI, in ordine.
--
-- GENERATO DA `scripts/genera-tutto.mjs`. Non modificare a mano:
-- la prossima rigenerazione cancella tutto quello che scrivi qui.
-- Per aggiungere una migrazione: crea il .sql, aggiungi la riga in
-- MIGRATIONS.md, poi `node scripts/genera-tutto.mjs`.
--
-- USO: incollare tutto nell'SQL Editor di Supabase ed eseguire.
-- Le migrazioni sono idempotenti: si puo' rilanciare su un cliente che
-- ne ha gia' una parte, ed e' proprio il modo di recuperare quella che
-- ci si e' dimenticati.
--
-- NB: i bucket Storage possono non nascere da qui se l'SQL Editor
-- blocca l'insert su storage.buckets. In quel caso si creano dalla
-- dashboard (Storage → New bucket, Public ON): popups, menu, documents,
-- brand.
-- ============================================================


-- ------------------------------------------------------------
-- #1 — schema.sql
-- ------------------------------------------------------------
-- ============================================================
-- RestoHub — Schema DB
-- Da lanciare nel SQL Editor del progetto Supabase del cliente.
-- Sicuro da rilanciare (idempotente): usa IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- gen_random_uuid() (di norma già attiva su Supabase)
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. MENU_ITEMS — piatti del menu (vetrina + take-away)
--    available  = visibile nel menu vetrina (/menu)
--    orderable  = ordinabile in take-away (/order)
-- ------------------------------------------------------------
create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  category       text    not null,
  category_order integer not null default 0,
  sort_order     integer not null default 0,
  name           text    not null,
  description    text,
  description_fr text,
  description_en text,
  allergens      integer[] not null default '{}',
  price_cents    integer not null check (price_cents >= 0),
  image_url      text,
  available      boolean not null default true,
  orderable      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_menu_items_order
  on public.menu_items (category_order, sort_order);

alter table public.menu_items enable row level security;

-- Lettura pubblica (il codice usa comunque la service key server-side;
-- questa policy replica il comportamento di Pizzeria 77).
drop policy if exists "menu_items lettura pubblica" on public.menu_items;
create policy "menu_items lettura pubblica"
  on public.menu_items for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. SETTINGS — orari per giorno (due fasce: pranzo / cena)
--    Una riga per day_of_week: 0=domenica, 1=lunedì ... 6=sabato.
-- ------------------------------------------------------------
create table if not exists public.settings (
  day_of_week           integer primary key check (day_of_week between 0 and 6),
  lunch_active          boolean not null default false,
  lunch_open            time,
  lunch_close           time,
  dinner_active         boolean not null default false,
  dinner_open           time,
  dinner_close          time,
  prep_time_minutes     integer not null default 30 check (prep_time_minutes >= 0),
  slot_duration_minutes integer not null default 15 check (slot_duration_minutes > 0),
  exceptional_closures  jsonb   not null default '[]'::jsonb
);

alter table public.settings enable row level security;

drop policy if exists "settings lettura pubblica" on public.settings;
create policy "settings lettura pubblica"
  on public.settings for select
  to anon, authenticated
  using (true);

-- Seed: sette righe di PARTENZA, non gli orari di nessun ristorante vero.
-- Servizio spezzato 12:00-14:30 / 18:30-22:30, sette giorni su sette, prep 30',
-- slot 15'. Il ristoratore li corregge in Reglages -> Horaires al primo giro.
--
-- ⚠️ `do nothing`, NON un UPSERT, ed e' il punto di questo blocco. Prima era
-- `do update set`: rilanciare questo file su un cliente che gia' lavora — cosa
-- che si fa ogni volta che serve una colonna nuova — gli RISCRIVEVA i sette
-- giorni con quelli scritti qui. Nessun errore, nessuna riga nei log: la gente
-- si presenta in un giorno che il sito dice aperto e trova chiuso. Un seed
-- semina, non corregge: le riparazioni si fanno dall'admin.
insert into public.settings
  (day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes)
values
  (0, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- domenica
  (1, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- lunedì
  (2, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- martedì
  (3, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- mercoledì
  (4, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- giovedì
  (5, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15),  -- venerdì
  (6, true, '12:00', '14:30', true, '18:30', '22:30', 30, 15)   -- sabato
on conflict (day_of_week) do nothing;

-- ------------------------------------------------------------
-- 3. ORDERS — ordini take-away
--    RLS attiva SENZA policy => accessibile SOLO con la service key
--    (server-side). anon/authenticated non vedono nulla.
-- ------------------------------------------------------------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  pickup_time       timestamptz,
  customer_name     text,
  customer_email    text,
  customer_phone    text,
  items             jsonb   not null default '[]'::jsonb,
  total_cents       integer not null default 0 check (total_cents >= 0),
  lang              text    not null default 'fr' check (lang in ('fr','en')),
  stripe_session_id text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_orders_status_pickup
  on public.orders (status, pickup_time);

alter table public.orders enable row level security;
-- (nessuna policy: solo service key)

-- ------------------------------------------------------------
-- 4. GRANT dei privilegi ai ruoli API
--    NECESSARIO perché "Automatically expose new tables" è OFF:
--    con quell'opzione Supabase NON concede i privilegi in automatico,
--    quindi vanno dati a mano o ogni query dà "permission denied" (42501).
-- ------------------------------------------------------------
grant select, insert, update, delete on public.menu_items to service_role;
grant select, insert, update, delete on public.settings   to service_role;
grant select, insert, update, delete on public.orders     to service_role;

grant select on public.menu_items to anon, authenticated;
grant select on public.settings   to anon, authenticated;


-- ------------------------------------------------------------
-- #2 — app_config.sql
-- ------------------------------------------------------------
-- ============================================================
-- APP_CONFIG — coppie chiave/valore per configurazioni
-- modificabili dall'admin (es. email cucina).
-- RLS attiva SENZA policy => accesso solo via service key.
-- Idempotente: sicuro da rilanciare.
-- ============================================================
create table if not exists public.app_config (
  key   text primary key,
  value text not null default ''
);

alter table public.app_config enable row level security;

grant select, insert, update, delete on public.app_config to service_role;

-- ⚠️ Il valore resta VUOTO, ed e' voluto. Questo file nasce un cliente per
-- volta: un indirizzo scritto qui finirebbe nell'installazione di tutti, e
-- `app_config` BATTE la variabile d'ambiente, quindi i ticket degli ordini
-- andrebbero al ristorante sbagliato senza dare nessun errore. Vuoto =
-- `notifications.ts` ripiega su KITCHEN_EMAIL dell'.env finche' l'admin non
-- scrive il vero indirizzo in Reglages -> Cuisine.
insert into public.app_config (key, value)
values ('kitchen_email', '')
on conflict (key) do nothing;


-- ------------------------------------------------------------
-- #3 — special_days.sql
-- ------------------------------------------------------------
-- ============================================================
-- SPECIAL_DAYS — giorni speciali che scavalcano gli orari settimanali:
--   type='closed' : chiuso in quelle date (ferie, festivi)
--   type='open'   : aperto eccezionalmente (es. un martedì specifico),
--                   con orari propri (lunch_* e opzionale dinner_*)
-- Range di date: date_from..date_to (giorno singolo = from = to).
-- RLS attiva SENZA policy => accesso solo via service key.
-- ============================================================
create table if not exists public.special_days (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('closed','open')),
  date_from   date not null,
  date_to     date not null,
  lunch_open  time,
  lunch_close time,
  dinner_open  time,
  dinner_close time,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists idx_special_days_range
  on public.special_days (date_from, date_to);

alter table public.special_days enable row level security;

grant select, insert, update, delete on public.special_days to service_role;


-- ------------------------------------------------------------
-- #4 — menu_categories.sql
-- ------------------------------------------------------------
-- ============================================================
-- MENU_CATEGORIES — le sezioni del menu come entità gestibile
-- dall'admin (creare/rinominare/riordinare/eliminare).
-- I piatti (menu_items) restano la fonte per il sito pubblico:
-- l'admin tiene sincronizzati category/category_order dei piatti.
-- Seed: importa le categorie già presenti nei piatti.
-- ============================================================
create table if not exists public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 0
);

alter table public.menu_categories enable row level security;

grant select, insert, update, delete on public.menu_categories to service_role;

insert into public.menu_categories (name, sort_order)
select category, min(category_order)
from public.menu_items
group by category
on conflict (name) do nothing;


-- ------------------------------------------------------------
-- #5 — menu_categories_kind.sql
-- ------------------------------------------------------------
-- ============================================================
-- Aggiunge alle sezioni il tipo: 'food' (cibo) o 'drink' (bevanda).
-- Seed: marca come 'drink' le sezioni bevande già esistenti.
-- Idempotente.
-- ============================================================
alter table public.menu_categories
  add column if not exists kind text not null default 'food'
  check (kind in ('food','drink'));

update public.menu_categories set kind = 'drink'
where name in (
  'Boissons chaudes','Softs','Apéritifs','Long drinks','Alcools',
  'Bières pression','Bières bouteilles','Vins du patron',
  'Vins rouges','Vins blancs','Vin rosé'
);


-- ------------------------------------------------------------
-- #6 — menu_discount.sql
-- ------------------------------------------------------------
-- ============================================================
-- Sconti sui piatti:
--   discount_type  : null (nessuno) | 'fixed' (riduzione fissa in
--                    centesimi) | 'percent' (percentuale intera)
--   discount_value : centesimi se fixed, 1-99 se percent
--   discount_scope : 'all' (ovunque) | 'online' (solo ordini online)
-- Idempotente.
-- ============================================================
alter table public.menu_items
  add column if not exists discount_type text check (discount_type in ('fixed','percent')),
  add column if not exists discount_value integer not null default 0,
  add column if not exists discount_scope text not null default 'all' check (discount_scope in ('all','online'));


-- ------------------------------------------------------------
-- #7 — menu_flags.sql
-- ------------------------------------------------------------
-- ============================================================
-- Badge dei piatti:
--   is_bestseller : piatto in evidenza / più venduto
--   is_vegan      : piatto vegano
--   is_spicy      : piatto piccante
-- Booleani, default false. Idempotente.
-- I privilegi di tabella (service_role / anon) coprono già le
-- nuove colonne: nessun GRANT aggiuntivo necessario.
-- ============================================================
alter table public.menu_items
  add column if not exists is_bestseller boolean not null default false,
  add column if not exists is_vegan boolean not null default false,
  add column if not exists is_spicy boolean not null default false;


-- ------------------------------------------------------------
-- #8 — menu_suggestion.sql
-- ------------------------------------------------------------
-- ============================================================
-- Badge "Suggestion" (suggestion du chef) sui piatti.
-- Colonna nuova su tabella già concessa: NIENTE nuovi GRANT.
-- Idempotente.
-- ============================================================
alter table public.menu_items
  add column if not exists is_suggestion boolean not null default false;


-- ------------------------------------------------------------
-- #9 — menu_image.sql
-- ------------------------------------------------------------
-- ============================================================
-- Foto degli articoli del menu (admin → Menu).
-- Colonna opzionale `image_url` su menu_items: se NULL, l'admin
-- mostra un placeholder. Include il bucket Storage `menu` per le
-- foto caricate dall'admin (lettura pubblica, scrittura solo via
-- API admin con service key). Idempotente.
-- ============================================================
alter table public.menu_items add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('menu', 'menu', true)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- #10 — admin_notes.sql
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- #11 — order_status_done.sql
-- ------------------------------------------------------------
-- ============================================================
-- Aggiunge lo stato 'done' (ordine preparato/consegnato) agli ordini.
-- Stati: pending (Stripe non completato) → paid (attivo in cucina)
--        → done (terminato) | cancelled (annullato dallo staff).
-- Idempotente.
-- ============================================================
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'paid', 'done', 'cancelled'));


-- ------------------------------------------------------------
-- #12 — clients.sql
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- #13 — clients_hidden.sql
-- ------------------------------------------------------------
-- ============================================================
-- Colonna `hidden` sulla tabella clients.
-- Un cliente "cancellato" dall'admin che ha degli ordini non viene
-- eliminato davvero (gli ordini restano in contabilità): viene
-- nascosto dalla lista con hidden = true. Se rifà un ordine,
-- il webhook lo riattiva (hidden = false).
-- Idempotente.
-- ============================================================
alter table public.clients
  add column if not exists hidden boolean not null default false;


-- ------------------------------------------------------------
-- #14 — coupons.sql
-- ------------------------------------------------------------
-- ============================================================
-- Tabella `coupons` — codici promo gestiti dall'admin
-- (Marketing → Coupons) e applicati al checkout take-away online.
--
-- Variabili di ogni coupon:
--  - code / code_norm : il codice digitato dal cliente (code_norm = lower(trim)
--                       per lookup case-insensitive, UNIQUE).
--  - discount_type    : 'percent' (1-100) | 'fixed' (montant en centimes).
--  - discount_value   : valore dello sconto (percentuale o centesimi).
--  - max_discount_cents : tetto massimo di sconto in centesimi (opz., vale sia
--                       per % che per fixed). Lo sconto non supera mai né questo
--                       tetto né il subtotale idoneo.
--  - min_spend_cents  : spesa minima del carrello per usarlo (opz.).
--  - schedule_kind    : 'always' | 'dates' | 'weekly' (come i pop-up).
--  - date_start/end   : validità a intervallo di date (schedule 'dates').
--  - days / hour_*    : giorni (0=dom..6=sab) + fascia oraria (schedule 'weekly').
--  - per_customer_limit : usi massimi per singolo cliente (per email; null = illimitato).
--  - global_limit     : usi massimi totali su tutti i clienti (null = illimitato).
--  - categories       : nomi delle sezioni menu a cui si applica (vuoto = tutte).
--  - combine_with_promo : 'stack' (si somma sui prezzi già scontati) |
--                       'exclude' (ignora i piatti già in promo) |
--                       'block' (coupon rifiutato se il carrello ha piatti in promo).
--  - new_customers_only : vale solo per chi non ha mai ordinato prima (per email).
--  - active           : attivo / in pausa.
--
-- Conteggio usi: si leggono gli ORDINI `paid` con quel coupon_id (colonne
-- aggiunte sotto a `orders`). Solo service key. Idempotente.
-- ============================================================
create table if not exists public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  code_norm           text not null unique,
  description         text,
  discount_type       text not null default 'percent'
                        check (discount_type in ('percent','fixed')),
  discount_value      integer not null check (discount_value > 0),
  max_discount_cents  integer check (max_discount_cents is null or max_discount_cents > 0),
  min_spend_cents     integer check (min_spend_cents is null or min_spend_cents >= 0),
  schedule_kind       text not null default 'always'
                        check (schedule_kind in ('always','dates','weekly')),
  date_start          date,
  date_end            date,
  days                int[],
  hour_start          text,
  hour_end            text,
  per_customer_limit  integer check (per_customer_limit is null or per_customer_limit > 0),
  global_limit        integer check (global_limit is null or global_limit > 0),
  categories          text[] not null default '{}',
  combine_with_promo  text not null default 'stack'
                        check (combine_with_promo in ('stack','exclude','block')),
  new_customers_only  boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists idx_coupons_code_norm on public.coupons (code_norm);

alter table public.coupons enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.coupons to service_role;

-- ------------------------------------------------------------
-- Colonne su ORDERS per registrare il coupon usato (conteggio usi).
-- Sicuro rilanciarle (IF NOT EXISTS). Non servono nuovi GRANT: i
-- privilegi di tabella coprono le colonne nuove.
-- ------------------------------------------------------------
alter table public.orders add column if not exists coupon_id uuid;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists coupon_discount_cents integer not null default 0;

create index if not exists idx_orders_coupon on public.orders (coupon_id) where coupon_id is not null;


-- ------------------------------------------------------------
-- #15 — popups.sql
-- ------------------------------------------------------------
-- ============================================================
-- Tabella `popups` — modali di comunicazione gestiti dall'admin
-- (Marketing → Pop-up) e mostrati sul sito pubblico.
-- Bilingue: i campi *_en sono la versione inglese. Il pop-up appare
-- su una versione del sito SOLO se il titolo di quella lingua è
-- compilato (niente fallback).
-- Dove: elenco di pagine (home, menu, order, ambiance, contact, links).
-- Quando: sempre / intervallo di date / giorni della settimana + fascia
-- oraria. Il visitatore lo vede al massimo `max_shows` volte
-- (conteggio in localStorage, lato client).
-- Include il bucket Storage `popups` per le immagini caricate
-- dall'admin. Solo service key per la tabella. Idempotente.
-- ============================================================
create table if not exists public.popups (
  id            uuid primary key default gen_random_uuid(),
  title         text,            -- titolo FR (il pop-up appare in FR solo se compilato)
  body          text,
  image_url     text,
  btn1_label    text,
  btn1_url      text,
  btn2_label    text,
  btn2_url      text,
  title_en      text,            -- titolo EN (il pop-up appare in EN solo se compilato)
  body_en       text,
  btn1_label_en text,
  btn2_label_en text,
  pages         text[] not null default '{home}',
  active        boolean not null default false,
  schedule_kind text not null default 'always', -- always | dates | weekly
  date_start    date,
  date_end      date,
  days          int[],           -- 0=dimanche … 6=samedi (come settings)
  hour_start    text,            -- "HH:MM"
  hour_end      text,            -- "HH:MM"
  max_shows     int not null default 3,
  created_at    timestamptz not null default now()
);

-- Colonne EN per chi avesse già creato la tabella nella prima versione
alter table public.popups add column if not exists title_en      text;
alter table public.popups add column if not exists body_en       text;
alter table public.popups add column if not exists btn1_label_en text;
alter table public.popups add column if not exists btn2_label_en text;
alter table public.popups alter column title drop not null;

alter table public.popups enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perché "Automatically expose new tables" è OFF
grant select, insert, update, delete on public.popups to service_role;

-- Bucket Storage per le immagini dei pop-up (lettura pubblica,
-- scrittura solo via API admin con service key)
insert into storage.buckets (id, name, public)
values ('popups', 'popups', true)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- #16 — newsletter.sql
-- ------------------------------------------------------------
-- ============================================================
-- Newsletter (admin Marketing → Newsletter).
-- `newsletter_log`    — storico invii (per la quota mensile: la somma
--                        di `count` nel mese corrente non supera 1000).
-- `newsletter_optout` — email disiscritte tramite il link presente in
--                        ogni newsletter: mai più contattate.
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.newsletter_log (
  id         uuid primary key default gen_random_uuid(),
  subject    text not null,
  count      int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_optout (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table public.newsletter_log enable row level security;
alter table public.newsletter_optout enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.newsletter_log to service_role;
grant select, insert, update, delete on public.newsletter_optout to service_role;


-- ------------------------------------------------------------
-- #17 — newsletter_credits.sql
-- ------------------------------------------------------------
-- ============================================================
-- Crediti newsletter acquistati (admin Marketing → Newsletter).
-- Ogni riga = un acquisto via Stripe MOODD. `status`:
--   pending = sessione creata, pagamento non ancora verificato
--   paid    = pagamento verificato, crediti attivi
-- I crediti NON scadono: si consumano solo quando la quota mensile
-- inclusa (1000) è esaurita. Solo service key. Idempotente.
-- ============================================================
create table if not exists public.newsletter_credits (
  id                 uuid primary key default gen_random_uuid(),
  pack               text not null,
  credits            int not null,
  amount_cents       int not null,
  stripe_session_id  text unique,
  status             text not null default 'pending',
  created_at         timestamptz not null default now()
);

alter table public.newsletter_credits enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.newsletter_credits to service_role;


-- ------------------------------------------------------------
-- #18 — team.sql
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- #19 — documents.sql
-- ------------------------------------------------------------
-- ============================================================
-- Bucket Storage `documents` (admin → Assets → Documents) :
-- PDF caricati dall'admin (menu stampabili, volantini, listini…).
-- Lettura pubblica, scrittura solo via API admin. Idempotente.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- #20 — reservations.sql
-- ------------------------------------------------------------
-- ============================================================
-- RÉSERVATIONS V1 (widget proprio, seme del prodotto MOODD).
-- Modello: conferma AUTOMATICA se c'è posto (capienza = somma dei
-- coperti delle sezioni in reservation_zones, meno le prenotazioni
-- confermate che occupano la fascia [heure, heure + hold_minutes]).
-- Il cliente può annullare dal link nell'email (cancel_token).
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  heure        text not null,                 -- "HH:MM" (slot scelto)
  service_key  text,                          -- midi | soir | … (reservation_services)
  people       int  not null check (people >= 1 and people <= 100),
  zone         text,                          -- sezione scelta (null = indifferente/disattivata)
  first_name   text not null,
  last_name    text not null,
  phone        text not null,
  email        text not null,
  lang         text not null default 'fr',    -- lingua del widget al momento della richiesta
  high_chair   boolean not null default false,
  quiet        boolean not null default false,
  business     boolean not null default false,
  company      text,
  notes        text,
  status       text not null default 'confirmed', -- confirmed | cancelled | noshow ('pending' riservato a una futura modalità manuale)
  cancel_token uuid not null default gen_random_uuid(), -- per il link "Annuler ma réservation"
  created_at   timestamptz not null default now()
);

create index if not exists reservations_date_idx on public.reservations (date, status);

alter table public.reservations enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perché "Automatically expose new tables" è OFF
grant select, insert, update, delete on public.reservations to service_role;


-- ------------------------------------------------------------
-- #21 — reservations_source.sql
-- ------------------------------------------------------------
-- #21 — Origine della prenotazione
-- 'web'    : widget del sito (default)
-- 'walkin' : cliente entrato dal ristorante (admin)
-- 'phone'  : prenotazione telefonica (admin)
-- 'google' : Reserve with Google (futuro)
alter table reservations
  add column if not exists source text not null default 'web'
  check (source in ('web', 'walkin', 'phone', 'google'));


-- ------------------------------------------------------------
-- #22 — service_closures.sql
-- ------------------------------------------------------------
-- ============================================================
-- #22 — CHIUSURE DI SERVIZIO PER GIORNO (admin Réservations).
-- Il ristoratore chiude un service di una data (es. Soir di stasera):
-- il widget pubblico non proporrà più quel service quel giorno.
-- reason: 'full' = Complet | 'closed' = Fermeture exceptionnelle.
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.service_closures (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  service_key text not null,                  -- midi | soir | … (reservation_services)
  reason      text not null default 'full' check (reason in ('full', 'closed')),
  created_at  timestamptz not null default now(),
  unique (date, service_key)
);

create index if not exists service_closures_date_idx on public.service_closures (date);

alter table public.service_closures enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.service_closures to service_role;


-- ------------------------------------------------------------
-- #23 — zone_closures.sql
-- ------------------------------------------------------------
-- ============================================================
-- #23 — CHIUSURE DI SEZIONE PER GIORNO (admin Réservations).
-- Il ristoratore chiude una section per una data (es. Terrasse
-- per pioggia): quel giorno la section sparisce dal widget e i
-- suoi coperti non contano nella capienza.
-- reason: 'full' = Complet | 'closed' = Fermeture exceptionnelle.
-- Solo service key (nessuna lettura pubblica diretta). Idempotente.
-- ============================================================
create table if not exists public.zone_closures (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  zone       text not null,                   -- nome della section (reservation_zones)
  reason     text not null default 'closed' check (reason in ('full', 'closed')),
  created_at timestamptz not null default now(),
  unique (date, zone)
);

create index if not exists zone_closures_date_idx on public.zone_closures (date);

alter table public.zone_closures enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.zone_closures to service_role;


-- ------------------------------------------------------------
-- #24 — reservations_review.sql
-- ------------------------------------------------------------
-- #24 — Email di recensione per le prenotazioni.
-- Salva l'id dell'email programmata su Resend, così un annullamento
-- o un no-show possono cancellarla prima dell'invio.
alter table reservations
  add column if not exists review_email_id text;


-- ------------------------------------------------------------
-- #25 — reservations_options.sql
-- ------------------------------------------------------------
-- #25 · Opzioni prenotazione: Anniversaire + Événement spécial
-- Due nuove opzioni selezionabili nel widget pubblico e nel modale admin.

alter table public.reservations
  add column if not exists birthday      boolean not null default false,
  add column if not exists special_event boolean not null default false;


-- ------------------------------------------------------------
-- #26 — reservations_seated.sql
-- ------------------------------------------------------------
-- #26 · Orario di arrivo al tavolo (timer "En cours")
-- Impostato quando lo staff mette manualmente lo stato "En cours" (seated):
-- il timer del tavolo parte dall'arrivo reale, non dall'ora prenotata.

alter table public.reservations
  add column if not exists seated_at timestamptz;


-- ------------------------------------------------------------
-- #27 — reservations_table_time.sql
-- ------------------------------------------------------------
-- #27 · Durata reale del tavolo (minuti)
-- Valorizzata quando la prenotazione diventa "Fini":
--  · Fini manuale  → minuti reali dall'arrivo (seated_at, altrimenti heure) al click
--  · auto-Fini     → durée du service + 15 min (il manager ha lasciato correre)
--  · no-show / annulée / ritorno a Confirmée → azzerata (null)

alter table public.reservations
  add column if not exists table_minutes integer;


-- ------------------------------------------------------------
-- #28 — reservations_spent.sql
-- ------------------------------------------------------------
-- #28 · Addition della prenotazione (centesimi)
-- Inserita dallo staff nel modale dettagli quando la prenotazione è "Fini".
-- Legata al cliente tramite email/telefono (come le statistiche visite).

alter table public.reservations
  add column if not exists spent_cents integer;


-- ------------------------------------------------------------
-- #29 — orders_source.sql
-- ------------------------------------------------------------
-- #29 · Origine dell'ordine
-- 'web' = checkout dal sito (default) · 'manual' = creato dallo staff
-- nella pagina Commandes (link di pagamento inviato via email).

alter table public.orders
  add column if not exists source text not null default 'web';


-- ------------------------------------------------------------
-- #30 — orders_cancel_token.sql
-- ------------------------------------------------------------
-- #30 · Token di annullamento dell'ordine (link "Annuler ma commande")
-- Usato nell'email col link di pagamento (ordini manuali): il cliente può
-- annullare finché l'ordine è 'pending' (non pagato).

alter table public.orders
  add column if not exists cancel_token uuid not null default gen_random_uuid();


-- ------------------------------------------------------------
-- #31 — clients_photo.sql
-- ------------------------------------------------------------
-- #31 · Foto del cliente (modale di modifica nella pagina Clients)

alter table public.clients
  add column if not exists photo_url text;


-- ------------------------------------------------------------
-- #32 — clients_block.sql
-- ------------------------------------------------------------
-- #32 · Blocco prenotazioni per cliente
-- blocked = true → il WIDGET pubblico rifiuta le prenotazioni con la sua
-- email o il suo telefono. Gli ordini dal sito restano permessi (paga subito).

alter table public.clients
  add column if not exists blocked boolean not null default false;


-- ------------------------------------------------------------
-- #33 — special_days_services.sql
-- ------------------------------------------------------------
-- #33 · Servizi attivi nei jours spéciaux "ouvert"
-- null = tutti i servizi (retro-compatibile con i giorni già salvati)
-- []   = nessun servizio: giorno aperto SOLO per ordinare
-- ["soir|18:00-21:30", ...] = solo i servizi selezionati (token key|from-to)

alter table public.special_days
  add column if not exists services jsonb;


-- ------------------------------------------------------------
-- #34 — admin_notes_tags.sql
-- ------------------------------------------------------------
-- #34 — Tag sulle note admin (Important / Recurrent / Fournisseur)
-- Colonna jsonb: lista di tag testuali, es. ["important","fournisseur"].
-- Tabella gia' concessa a service_role: nessun GRANT necessario.
alter table public.admin_notes add column if not exists tags jsonb;


-- ------------------------------------------------------------
-- #35 — brand_bucket.sql
-- ------------------------------------------------------------
-- #35 — Bucket Storage "brand" (loghi + favicon del cliente, pubblici)
-- Caricati da Reglages -> General; URL salvati in app_config
-- (brand_logo, brand_logo_negative, brand_logo_mono, brand_favicon).
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- #36 — restaurant_tables.sql
-- ------------------------------------------------------------
-- #36 — Plan de salle: tavoli disegnati per section (Reglages -> Reservations)
-- Coordinate in unita' astratte (canvas 1000x600). zone = nome della section
-- in reservation_zones (se rinomini una section, i tavoli restano legati al
-- vecchio nome: per ora vanno ridisegnati o aggiornati a mano).
create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  zone text not null,
  name text not null,
  seats int not null default 4,
  shape text not null default 'square' check (shape in ('round', 'square', 'rect')),
  x real not null default 0,
  y real not null default 0,
  w real not null default 100,
  h real not null default 100,
  created_at timestamptz not null default now()
);

alter table public.restaurant_tables enable row level security;
grant select, insert, update, delete on public.restaurant_tables to service_role;


-- ------------------------------------------------------------
-- #37 — reservations_tables.sql
-- ------------------------------------------------------------
-- #37 -- Plan de salle fase 2: tavoli assegnati automaticamente alla prenotazione.
-- jsonb = array di uuid (id di restaurant_tables), es. ["a1...", "b2..."].
-- null = nessuna assegnazione (plan mode spento alla creazione, oppure
-- nessuna combinazione libera -> l'admin ha bypassato l'avviso).
-- L'assegnazione e' ricalcolata a ogni modifica di data/ora/persone/section.

alter table public.reservations
  add column if not exists tables jsonb;


-- ------------------------------------------------------------
-- #38 — lunch_menus.sql
-- ------------------------------------------------------------
-- #38 -- LUNCH: formules del mezzogiorno (tab Lunch della pagina Menu admin).
-- courses jsonb  = portate attive in ordine canonico: ["entree","plat","dessert"]
--                  (solo ["plat"] = Plat du jour)
-- items jsonb    = { entree: [menu_item_id...], plat: [...], dessert: [...] }
--                  (piatti SCELTI dal menu esistente)
-- combos jsonb   = combinazioni MANUALI col prezzo:
--                  [{ parts: ["entree","plat"], price_cents: 1650 }, ...]
-- date_from/date_to = intervallo di validita'; null = senza limite
create table if not exists public.lunch_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Lunch',
  courses jsonb not null default '["plat"]'::jsonb,
  date_from date,
  date_to date,
  items jsonb not null default '{}'::jsonb,
  combos jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lunch_menus enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perche' "Automatically expose new tables" e' OFF
grant select, insert, update, delete on public.lunch_menus to service_role;


-- ------------------------------------------------------------
-- #39 — newsletter_schedule.sql
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- #40 — admin_docs_meta.sql
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- #41 — orders_refund.sql
-- ------------------------------------------------------------
-- ============================================================
-- Rimborsi ordini (Stripe).
-- Traccia il totale già rimborsato (per rimborsi parziali cumulativi),
-- l'ora dell'ultimo rimborso e l'id dell'ultimo refund Stripe.
-- Evita doppi rimborsi e permette di mostrare lo stato "Remboursé".
-- Idempotente.
-- ============================================================
alter table public.orders add column if not exists refunded_cents integer not null default 0;
alter table public.orders add column if not exists refunded_at   timestamptz;
alter table public.orders add column if not exists last_refund_id text;


-- ------------------------------------------------------------
-- #42 — reservations_client_action.sql
-- ------------------------------------------------------------
-- ============================================================
-- Traccia le azioni del CLIENTE sulle prenotazioni (annullo / modifica dal
-- link nell'email) per il toast live nell'admin: `client_action_at` viene
-- valorizzato SOLO dagli endpoint pubblici (/api/reservation DELETE e PUT),
-- mai dalle azioni dello staff. Il poller admin confronta questo timestamp
-- per avvisare "Réservation annulée / modifiée" e ricaricare la lista.
-- Colonna su tabella già concessa a service_role → nessun GRANT nuovo.
-- Idempotente.
-- ============================================================
alter table public.reservations
  add column if not exists client_action_at timestamptz;


-- ------------------------------------------------------------
-- #43 — reservations_recontact.sql
-- ------------------------------------------------------------
-- #43 — Flag "à recontacter" sulle prenotazioni.
-- Valorizzato quando, chiudendo una SECTION (Fermeture exceptionnelle), il
-- ristoratore sceglie di richiamare a voce il cliente (non spostato, non annullato).
-- Colonna su tabella gia' concessa a service_role -> nessun GRANT nuovo. Idempotente.
alter table public.reservations
  add column if not exists recontact boolean not null default false;


-- ------------------------------------------------------------
-- #44 — push_subscriptions.sql
-- ------------------------------------------------------------
-- #44 — Iscrizioni push (PWA admin). Ogni device/browser del ristoratore che
-- attiva le notifiche salva qui la sua subscription (endpoint + chiavi). Le
-- iscrizioni scadute (404/410) vengono ripulite in automatico all'invio.
-- Solo service key. Idempotente.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_email text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to service_role;


-- ------------------------------------------------------------
-- #45 — gift_cards.sql
-- ------------------------------------------------------------
-- ============================================================
-- #45 — Buoni regalo (Marketing → Bons cadeaux)
--
-- Un buono regalo è VALORE PREPAGATO (non uno sconto come i coupons):
-- ha un saldo che si scala man mano, usabile ONLINE (al checkout) o
-- A MANO in sala (riscatto dall'admin). Fase 1: generati dall'admin.
-- Fase 2 (predisposta): acquisto online del cliente (buyer_email,
-- stripe_session_id, source='purchase').
--
--  - code / code_norm   : codice del buono (code_norm = lower(trim), UNIQUE
--                         per lookup case-insensitive).
--  - initial_cents      : valore iniziale in centesimi.
--  - balance_cents      : saldo residuo (parte = initial_cents, scala coi
--                         riscatti; 0 = esaurito). Fonte di verità = ledger.
--  - active             : attivo / sospeso (blocca l'uso senza cancellare).
--  - expires_at         : scadenza opzionale (null = nessuna).
--  - source             : 'admin' (generato) | 'purchase' (comprato online, fase 2).
--  - recipient_name/email, sender_name, message : dati del regalo (email opz.).
--  - buyer_email, stripe_session_id : fase 2 (acquisto online).
--  - created_by         : email admin che l'ha generato.
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.gift_cards (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  code_norm         text not null unique,
  initial_cents     integer not null check (initial_cents > 0),
  balance_cents     integer not null check (balance_cents >= 0),
  active            boolean not null default true,
  expires_at        date,
  source            text not null default 'admin'
                      check (source in ('admin','purchase')),
  recipient_name    text,
  recipient_email   text,
  recipient_phone   text,
  sender_name       text,
  sender_email      text,
  sender_phone      text,
  message           text,
  ship              boolean not null default false,
  ship_address      text,
  ship_zip          text,
  ship_city         text,
  ship_country      text,
  shipping_cents    integer not null default 0,
  payment_method    text not null default 'cash'
                      check (payment_method in ('cash','card','link')),
  paid              boolean not null default true,
  paid_at           timestamptz,
  pay_token         uuid not null default gen_random_uuid(),
  buyer_email       text,
  stripe_session_id text,
  created_by        text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_gift_cards_code_norm on public.gift_cards (code_norm);
alter table public.gift_cards enable row level security;
grant select, insert, update, delete on public.gift_cards to service_role;
-- Colonna aggiunta dopo il primo rilascio: idempotente per tabelle già create.
alter table public.gift_cards add column if not exists recipient_phone text;
-- #70: lingue di mittente/destinatario (email + PDF). NULL = default sito pubblico.
alter table public.gift_cards add column if not exists sender_lang    text;
alter table public.gift_cards add column if not exists recipient_lang text;
alter table public.gift_cards add column if not exists sender_email text;
alter table public.gift_cards add column if not exists sender_phone text;
alter table public.gift_cards add column if not exists ship boolean not null default false;
alter table public.gift_cards add column if not exists ship_address text;
alter table public.gift_cards add column if not exists ship_zip text;
alter table public.gift_cards add column if not exists ship_city text;
alter table public.gift_cards add column if not exists ship_country text;
alter table public.gift_cards add column if not exists shipping_cents integer not null default 0;
alter table public.gift_cards add column if not exists payment_method text not null default 'cash';
alter table public.gift_cards add column if not exists paid boolean not null default true;
alter table public.gift_cards add column if not exists paid_at timestamptz;
alter table public.gift_cards add column if not exists pay_token uuid not null default gen_random_uuid();
create index if not exists idx_gift_cards_pay_token on public.gift_cards (pay_token);

-- ------------------------------------------------------------
-- Registro dei riscatti (ledger). Il saldo = initial - somma(amount).
-- kind 'online' = scalato a un ordine (order_id valorizzato); kind
-- 'manual' = riscatto in sala dall'admin (note libera). Idempotente.
-- ------------------------------------------------------------
create table if not exists public.gift_card_redemptions (
  id            uuid primary key default gen_random_uuid(),
  gift_card_id  uuid not null references public.gift_cards(id) on delete cascade,
  amount_cents  integer not null check (amount_cents > 0),
  kind          text not null default 'manual'
                  check (kind in ('online','manual')),
  order_id      uuid,
  note          text,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_gcr_card on public.gift_card_redemptions (gift_card_id);
alter table public.gift_card_redemptions enable row level security;
grant select, insert, update, delete on public.gift_card_redemptions to service_role;

-- ------------------------------------------------------------
-- Colonne su ORDERS per registrare il buono usato online (fase B),
-- come per i coupons. Sicuro rilanciarle (IF NOT EXISTS).
-- ------------------------------------------------------------
alter table public.orders add column if not exists gift_card_id uuid;
alter table public.orders add column if not exists gift_card_code text;
alter table public.orders add column if not exists gift_card_cents integer not null default 0;
create index if not exists idx_orders_gift on public.orders (gift_card_id) where gift_card_id is not null;


-- ------------------------------------------------------------
-- #46 — gift_card_orders.sql
-- ------------------------------------------------------------
-- ============================================================
-- #46 — Ordini di BUONI FISICI acquistati dal ristoratore presso MOODD.
--
-- Il ristoratore compra dei cartoncini "bon cadeau" stampati da MOODD
-- (Marketing → Bons cadeaux → « Acheter des bons »). Il pagamento va sullo
-- Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i crediti newsletter —
-- NON sullo Stripe del ristorante. L'indirizzo di spedizione è raccolto
-- da Stripe Checkout.
--
--  - qty / amount_cents  : quantità del pack e prezzo pagato.
--  - stripe_session_id   : sessione Checkout (UNIQUE = idempotenza).
--  - status              : 'pending' alla creazione → 'paid' alla conferma.
--  - shipped_at          : quando MOODD ha spedito (uso interno).
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.gift_card_orders (
  id                uuid primary key default gen_random_uuid(),
  qty               integer not null check (qty > 0),
  amount_cents      integer not null check (amount_cents >= 0),
  stripe_session_id text unique,
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  buyer_email       text,
  shipped_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_gc_orders_status on public.gift_card_orders (status);
alter table public.gift_card_orders enable row level security;
grant select, insert, update, delete on public.gift_card_orders to service_role;


-- ------------------------------------------------------------
-- #47 — traffic.sql
-- ------------------------------------------------------------
-- ============================================================
-- #47 — Analytics interne (Statistiques → Google : Sources de trafic)
--
-- Analytics FIRST-PARTY, sans cookie et sans donnée personnelle : on
-- enregistre juste, à chaque ARRIVÉE sur le site public, la provenance
-- (Google / Facebook / Instagram / Direct / …) déduite du référent ou
-- du paramètre utm_source. Aucune IP, aucun identifiant → pas de
-- bandeau de consentement nécessaire.
--
-- Écrit UNIQUEMENT par /api/track (clé service). Les navigations
-- internes ne sont pas comptées (le client ne beacon que les entrées).
--   - source   : catégorie normalisée (google, facebook, instagram,
--                direct, tiktok, x, autre, …)
--   - ref_host : hôte brut du référent (pour détailler « autre »)
-- ============================================================

create table if not exists public.page_views (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  path        text        not null default '',
  source      text        not null default 'autre',
  ref_host    text        not null default ''
);

create index if not exists page_views_created_idx on public.page_views (created_at);
create index if not exists page_views_source_idx  on public.page_views (source);

-- RLS activé sans policy : seul le rôle service (clé serveur) peut lire/écrire.
alter table public.page_views enable row level security;

-- Agrégation des sources sur une période (évite le plafond de 1000 lignes
-- d'un select côté client). Retourne source + nombre de visites.
create or replace function public.traffic_sources(since timestamptz)
returns table(source text, count bigint)
language sql
stable
as $$
  select pv.source, count(*)::bigint as count
  from public.page_views pv
  where pv.created_at >= since
  group by pv.source
  order by count desc
$$;


-- ------------------------------------------------------------
-- #48 — reservation_reminder.sql
-- ------------------------------------------------------------
-- ============================================================
-- #48 — Rappel client 3 h avant la réservation
--
-- Un email de RAPPEL est envoyé au CLIENT ~3 h avant sa réservation,
-- UNIQUEMENT si elle a été prise pour un jour FUTUR (pas le jour même).
-- Rappel simple : aucun bouton modifier/annuler.
-- Envoi piloté par le cron /api/cron/reservation-reminders (lit toujours
-- l'état à jour → une résa annulée/modifiée n'envoie rien de faux).
--   - reminder_sent_at : horodatage de l'envoi (NULL = pas encore envoyé),
--                        empêche tout doublon.
-- ============================================================
alter table public.reservations
  add column if not exists reminder_sent_at timestamptz;


-- ------------------------------------------------------------
-- #49 — orders_manual_payment.sql
-- ------------------------------------------------------------
-- #49 · Ordini manuali pagati di persona + lingue email estese
--
-- Due modifiche a orders, entrambe idempotenti:
--
-- 1) LINGUE. Toglie il vecchio check che limitava orders.lang a ('fr','en').
--    Ora le email d'ordine esistono in fr/en/it/nl/es (lingue pubbliche), come
--    già fa reservations.lang (che non ha alcun check). Senza questa modifica
--    un ordine con lang it/nl/es verrebbe RIFIUTATO dal database.
--
-- 2) PAGAMENTO. Aggiunge payment_method: come è stato pagato l'ordine.
--      'link' = link di pagamento Stripe inviato via email (flusso storico)
--      'cash' = contanti, pagato in cassa (ordine creato già 'paid')
--      'card' = carta, pagato in cassa (ordine creato già 'paid')
--      null   = ordini online/storici senza metodo registrato
--
-- Idempotente: si può rilanciare senza danni.

-- 1) Lingue: via il check fr/en (il nome del constraint è quello auto-generato
--    da Postgres per un check inline sulla colonna). "if exists" = nessun errore
--    se è già stato tolto.
alter table public.orders drop constraint if exists orders_lang_check;

-- 2) Metodo di pagamento.
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('cash', 'card', 'link'));


-- ------------------------------------------------------------
-- #50 — orders_modifica_diff.sql
-- ------------------------------------------------------------
-- ============================================================
-- Modifica ordini: differenza di importo dopo una modifica.
-- Quando lo staff modifica un ordine GIA' PAGATO ONLINE (sito o payment link):
--   - se il totale AUMENTA  -> supplement_due_cents = differenza da incassare
--     (mail al cliente con link Stripe; il webhook azzera e segna
--      supplement_paid_at quando il cliente paga il supplemento);
--   - se il totale DIMINUISCE -> refund_due_cents = differenza da rimborsare
--     (bottone "Rembourser la difference" sulla card, 1 clic).
-- Un solo lato e' attivo alla volta (netting nel PUT /api/admin/orders).
-- Idempotente.
-- ============================================================
alter table public.orders add column if not exists supplement_due_cents integer not null default 0;
alter table public.orders add column if not exists supplement_paid_at    timestamptz;
alter table public.orders add column if not exists refund_due_cents       integer not null default 0;


-- ------------------------------------------------------------
-- #51 — lunch_hide_by_course.sql
-- ------------------------------------------------------------
-- Nascondere i piatti del lunch dal menu pubblico PER SINGOLA PORTATA.
-- Estende (senza sostituire) il vecchio flag globale hide_items:
--   { "entree": true, "plat": false, "dessert": true }
-- Se la colonna manca, il codice ricade automaticamente su hide_items
-- (degrada senza errori). I menù FISSI (set_menus) non hanno bisogno di
-- migrazione: il flag "hide" per portata viaggia dentro il JSON `courses`.
alter table lunch_menus add column if not exists hide_by_course jsonb;


-- ------------------------------------------------------------
-- #52 — agenda_events.sql
-- ------------------------------------------------------------
-- ============================================================
-- Tabella `agenda_events` — Eventi / Agenda del ristorante
-- (admin RestoHub → Agenda). Ogni evento: titolo, immagine
-- principale, descrizione, galleria di immagini, data singola o
-- intervallo di date, link esterni e flag RSVP (inscriptions).
-- Le immagini usano il bucket Storage `popups` (già esistente).
-- Prima iterazione: solo gestione admin (nessun rendering pubblico).
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.agenda_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,                          -- descrizione / testo
  image_url   text,                          -- immagine principale
  gallery     jsonb not null default '[]',   -- ["url", ...]
  date_start  date not null,                 -- data (o inizio intervallo)
  date_end    date,                          -- fine intervallo (null = un solo giorno)
  links       jsonb not null default '[]',   -- [{ "label": "...", "url": "https://..." }]
  rsvp        boolean not null default false, -- inscriptions attive sì/no
  active      boolean not null default true,  -- pubblicato / bozza
  created_at  timestamptz not null default now()
);

-- Ordinamento tipico: per data dell'evento
create index if not exists agenda_events_date_idx on public.agenda_events (date_start);

alter table public.agenda_events enable row level security;
-- (nessuna policy: accesso solo con service key)

grant select, insert, update, delete on public.agenda_events to service_role;

-- Le immagini (principale + galleria) riusano il bucket `popups`
insert into storage.buckets (id, name, public)
values ('popups', 'popups', true)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- #53 — agenda_events_i18n.sql
-- ------------------------------------------------------------
-- Traduzioni di titolo e descrizione degli eventi (agenda) per lingua del sito.
alter table public.agenda_events add column if not exists title_i18n jsonb;
alter table public.agenda_events add column if not exists body_i18n jsonb;

-- Descrizione LUNGA (per la pagina dettaglio) tradotta + numero max iscrizioni RSVP.
alter table public.agenda_events add column if not exists body_long_i18n jsonb;
alter table public.agenda_events add column if not exists rsvp_max int;


-- ------------------------------------------------------------
-- #54 — clients_lang.sql
-- ------------------------------------------------------------
-- Colonna lingua del cliente (per le email di conferma nella lingua giusta
-- e per la colonna/i filtri Lingua nella pagina Clienti).
-- Idempotente: sicura da rilanciare.
alter table public.clients add column if not exists lang text;


-- ------------------------------------------------------------
-- #55 — menu_sold_out.sql
-- ------------------------------------------------------------
-- Stato "esaurito" di un piatto (temporaneamente non disponibile).
-- Distinto da `available` (visibile sul sito) e `orderable` (ordinabile):
-- un piatto esaurito resta in carta ma è segnalato come non disponibile.
-- Idempotente.
alter table public.menu_items add column if not exists sold_out boolean not null default false;


-- ------------------------------------------------------------
-- #56 — menu_i18n.sql
-- ------------------------------------------------------------
-- Traduzioni per i piatti nelle lingue del sito pubblico.
-- name_i18n / desc_i18n = { "fr": "...", "en": "...", "it": "..." } (solo lingue attive).
-- `name` resta il nome canonico (lingua predefinita, usato in ordini/cucina).
-- description_fr / description_en restano allineate (retro-compatibilità menu pubblico legacy).
-- Idempotente.
alter table public.menu_items add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.menu_items add column if not exists desc_i18n jsonb not null default '{}'::jsonb;


-- ------------------------------------------------------------
-- #57 — menu_subcategories.sql
-- ------------------------------------------------------------
-- Sotto-categorie del menu (fino a 3 livelli sotto la categoria radice).
-- Gerarchia su menu_categories: parent_id (null = radice) + depth (0..3).
-- I piatti restano collegati alla sezione per NOME (menu_items.category),
-- quindi i nomi delle sezioni restano UNICI (constraint esistente invariata).
-- Idempotente.
alter table public.menu_categories
  add column if not exists parent_id uuid references public.menu_categories(id) on delete restrict;
alter table public.menu_categories
  add column if not exists depth integer not null default 0;
create index if not exists idx_menu_categories_parent on public.menu_categories(parent_id);


-- ------------------------------------------------------------
-- #58 — menu_categories_i18n.sql
-- ------------------------------------------------------------
-- Traduzioni del nome delle sezioni/categorie per lingua del sito pubblico.
-- Per le categorie STANDARD viene riempito dal dizionario (fisso); per quelle
-- personalizzate lo inserisce il ristoratore.
alter table public.menu_categories add column if not exists name_i18n jsonb;


-- ------------------------------------------------------------
-- #59 — lunch_i18n.sql
-- ------------------------------------------------------------
-- Traduzioni del nome del lunch (formule del mezzogiorno) per lingua del sito pubblico.
-- Chiavi = codici lingua (fr,en,it,nl,es); valori = nome tradotto.
alter table lunch_menus add column if not exists name_i18n jsonb;


-- ------------------------------------------------------------
-- #60 — lunch_hide_items.sql
-- ------------------------------------------------------------
-- Switch per nascondere dal menu pubblico i piatti inseriti in un lunch/formula.
-- Quando true e il lunch è attivo (e nel range di date), i suoi piatti non
-- compaiono più nella lista del menu pubblico.
alter table lunch_menus add column if not exists hide_items boolean default false;


-- ------------------------------------------------------------
-- #61 — set_menus.sql
-- ------------------------------------------------------------
-- Menù fissi (tab « Menù » della pagina Menu admin) — menu à prix fixe.
-- Prezzo unico + eventuale supplemento vini; portate personalizzabili (nomi
-- liberi), ognuna con piatti a scelta (id di menu_items). Traduzioni nome e
-- descrizione per lingua del sito pubblico. hide_items: nasconde dal menu
-- pubblico i piatti inseriti (come il lunch).
create table if not exists public.set_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Menu',
  name_i18n jsonb,
  desc_i18n jsonb,
  image_url text,
  courses jsonb not null default '[]'::jsonb,   -- [{ "name": "...", "items": ["uuid", ...] }]
  price_cents int not null default 0,
  wine_supplement_cents int,
  date_from date,
  date_to date,
  active boolean not null default true,
  hide_items boolean not null default false,
  is_draft boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.set_menus enable row level security;
-- (nessuna policy: accesso solo con service key)

-- GRANT necessario perche' "Automatically expose new tables" e' OFF
grant select, insert, update, delete on public.set_menus to service_role;


-- ------------------------------------------------------------
-- #62 — set_menus_draft.sql
-- ------------------------------------------------------------
-- Stato bozza per i menù fissi: consente di salvare e continuare più tardi
-- un menù incompleto (non pubblicato). is_draft=true => bozza.
alter table set_menus add column if not exists is_draft boolean default false;


-- ------------------------------------------------------------
-- #63 — set_menus_grant.sql
-- ------------------------------------------------------------
-- La tabella set_menus è stata creata senza GRANT: senza questo, ogni query
-- del service_role dà "permission denied for table set_menus" (SQLSTATE 42501),
-- perché nel progetto "Automatically expose new tables" è OFF.
alter table public.set_menus enable row level security;
grant select, insert, update, delete on public.set_menus to service_role;


-- ------------------------------------------------------------
-- #64 — menu_seasonal.sql
-- ------------------------------------------------------------
-- Badge "stagionale" per piatti e bevande. Idempotente.
alter table public.menu_items add column if not exists is_seasonal boolean not null default false;


-- ------------------------------------------------------------
-- #65 — popups_i18n.sql
-- ------------------------------------------------------------
-- Pop-up multilingua: traduzioni per lingua del sito (stesso schema di agenda_events).
alter table public.popups add column if not exists title_i18n      jsonb;
alter table public.popups add column if not exists body_i18n       jsonb;
alter table public.popups add column if not exists btn1_label_i18n jsonb;
alter table public.popups add column if not exists btn2_label_i18n jsonb;

-- Migra i dati FR/EN esistenti nelle mappe i18n (una tantum, idempotente).
update public.popups set
  title_i18n = coalesce(title_i18n, '{}'::jsonb)
    || case when coalesce(title,'')    <> '' then jsonb_build_object('fr', title)    else '{}'::jsonb end
    || case when coalesce(title_en,'') <> '' then jsonb_build_object('en', title_en) else '{}'::jsonb end,
  body_i18n = coalesce(body_i18n, '{}'::jsonb)
    || case when coalesce(body,'')     <> '' then jsonb_build_object('fr', body)     else '{}'::jsonb end
    || case when coalesce(body_en,'')  <> '' then jsonb_build_object('en', body_en)  else '{}'::jsonb end,
  btn1_label_i18n = coalesce(btn1_label_i18n, '{}'::jsonb)
    || case when coalesce(btn1_label,'')    <> '' then jsonb_build_object('fr', btn1_label)    else '{}'::jsonb end
    || case when coalesce(btn1_label_en,'') <> '' then jsonb_build_object('en', btn1_label_en) else '{}'::jsonb end,
  btn2_label_i18n = coalesce(btn2_label_i18n, '{}'::jsonb)
    || case when coalesce(btn2_label,'')    <> '' then jsonb_build_object('fr', btn2_label)    else '{}'::jsonb end
    || case when coalesce(btn2_label_en,'') <> '' then jsonb_build_object('en', btn2_label_en) else '{}'::jsonb end
where title_i18n is null;


-- ------------------------------------------------------------
-- #66 — popups_position.sql
-- ------------------------------------------------------------
-- Posizione del pop-up sullo schermo: center | bottom-left | bottom-center | bottom-right
alter table public.popups add column if not exists position text not null default 'center';


-- ------------------------------------------------------------
-- #67 — google_reviews.sql
-- ------------------------------------------------------------
-- Recensioni Google importate dalla scheda Business Profile del cliente.
-- Cache locale: la pagina admin legge SEMPRE da qui (istantaneo); la
-- sincronizzazione con Google avviene "Sincronizza ora" + cron orario.
-- Idempotente: rilanciarla e' sicuro.
create table if not exists public.google_reviews (
  review_id     text primary key,          -- id stabile della recensione
  name          text not null,             -- resource name v4 completo (accounts/../locations/../reviews/..)
  author        text,
  photo         text,
  rating        int,                        -- 1..5
  comment       text,
  create_time   timestamptz,
  update_time   timestamptz,
  reply_comment text,                        -- risposta del ristorante (null = da rispondere)
  reply_time    timestamptz,
  synced_at     timestamptz default now()
);

create index if not exists google_reviews_create_idx on public.google_reviews (create_time desc);

alter table public.google_reviews enable row level security;
grant select, insert, update, delete on public.google_reviews to service_role;

-- Chiavi usate in app_config (testo):
--   google_location        -> "accounts/{id}/locations/{id}" (percorso v4)
--   google_location_title  -> nome leggibile della scheda
--   google_rating          -> voto medio (es. "4.6")
--   google_review_count    -> numero totale recensioni
--   google_reviews_synced_at -> ISO ultima sincronizzazione


-- ------------------------------------------------------------
-- #68 — print_orders.sql
-- ------------------------------------------------------------
-- ============================================================
-- PRINT_ORDERS — ordini di prodotti stampati che il ristoratore
-- acquista da MOODD (menu, biglietti da visita, ecc.).
--
-- Pagato sullo Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i buoni
-- fisici e i crediti newsletter — NON sullo Stripe del ristorante.
-- L'indirizzo di spedizione è raccolto da Stripe Checkout.
--
--  - product_slug/label : snapshot del prodotto al momento dell'ordine.
--  - qty                : quantità del lotto scelto (es. 100 copie).
--  - amount_cents       : prezzo pagato per il lotto (snapshot).
--  - meta               : caratteristiche (formato/pagine/carta/colore) snapshot.
--  - stripe_session_id  : sessione Checkout (UNIQUE = idempotenza).
--  - status             : 'pending' alla creazione → 'paid' alla conferma.
--  - shipped_at         : quando MOODD ha spedito (uso interno).
-- Solo service key. Idempotente.
-- ============================================================
create table if not exists public.print_orders (
  id                uuid primary key default gen_random_uuid(),
  product_slug      text not null,
  product_label     text not null,
  qty               integer not null check (qty > 0),
  amount_cents      integer not null check (amount_cents >= 0),
  meta              jsonb not null default '{}'::jsonb,
  stripe_session_id text unique,
  status            text not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  buyer_email       text,
  paid_at           timestamptz,
  shipped_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_print_orders_status on public.print_orders (status);
alter table public.print_orders enable row level security;
grant select, insert, update, delete on public.print_orders to service_role;


-- ------------------------------------------------------------
-- #69 — reservations_extra_minutes.sql
-- ------------------------------------------------------------
-- ============================================================
-- reservations.extra_minutes — minuti di ESTENSIONE del tavolo aggiunti
-- dal ristoratore dal modale (+15/+30/+45). La finestra effettiva del
-- tavolo diventa: heure + durée(service) + extra_minutes.
-- Usato da: fase/timer (admin), auto-Fini, disponibilità pubblica, piano sala.
-- Idempotente.
-- ============================================================
alter table public.reservations
  add column if not exists extra_minutes integer not null default 0;


-- ------------------------------------------------------------
-- #70 — gift_cards_langs.sql
-- ------------------------------------------------------------
-- ============================================================
-- #70 — Lingua di MITTENTE e DESTINATARIO su un buono regalo.
--
-- Le email dei buoni (offrant/destinataire) e il PDF stampabile vanno
-- inviati nella LINGUA DELLA PERSONA, scelta nel modale di creazione.
-- Il PDF è generato ON-DEMAND (/api/bon-pdf, quando il destinatario apre
-- il link), quindi la lingua del destinatario DEVE essere persistita qui,
-- non basta al momento dell'invio.
--
--  - sender_lang    : lingua dell'email all'offrant (chi offre).
--  - recipient_lang : lingua dell'email al destinataire E del PDF.
-- NULL = usa la lingua predefinita del sito pubblico (public_lang_default).
-- Valori attesi = codici lingua pubblici (fr/en/it/nl/es). Idempotente.
-- ============================================================
alter table public.gift_cards
  add column if not exists sender_lang    text,
  add column if not exists recipient_lang text;


-- ------------------------------------------------------------
-- #71 — menu_variants.sql
-- ------------------------------------------------------------
-- ============================================================
-- MENU_ITEMS.variants — formati/varianti di un piatto
--
-- Un piatto può essere venduto in più formati mutuamente esclusivi
-- (pizza 30/40 cm, vino calice/bottiglia, porzione piccola/grande).
-- Il cliente ne sceglie UNO. Ogni formato ha il PROPRIO prezzo.
--
-- Forma del jsonb (array, ordine = ordine di visualizzazione):
--   [
--     { "key": "30",
--       "label_i18n": { "fr": "30 cm", "en": "30 cm", "it": "30 cm" },
--       "price_cents": 1200,
--       "orderable": true,
--       "sold_out": false },
--     { "key": "40", "label_i18n": { "fr": "40 cm" }, "price_cents": 1600,
--       "orderable": true, "sold_out": false }
--   ]
--
-- Regole:
--  - variants = []  -> comportamento invariato: il piatto ha un prezzo unico
--                      (price_cents). Nessun cliente esistente cambia.
--  - variants ≠ []  -> price_cents diventa il prezzo "a partire da" e il
--                      prezzo incassato è SEMPRE quello della variante scelta,
--                      risolto lato server (il browser manda solo la chiave).
--  - "orderable": false -> il formato si vede nel menu vetrina ma non è
--                      ordinabile online (come orderable sul piatto).
--  - "sold_out": true  -> finito adesso: resta in carta col badge «Épuisé»,
--                      il bottone è disattivato e il checkout lo rifiuta.
--                      Stesso significato di menu_items.sold_out (#55).
--  - "key" è stabile e unica dentro il piatto: è ciò che viaggia negli ordini.
--
-- Idempotente.
-- ============================================================

alter table public.menu_items
  add column if not exists variants jsonb not null default '[]'::jsonb;

-- Deve essere un array (mai un oggetto o uno scalare).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_variants_array'
  ) then
    alter table public.menu_items
      add constraint menu_items_variants_array
      check (jsonb_typeof(variants) = 'array');
  end if;
end $$;


-- ------------------------------------------------------------
-- #72 — admin_docs_lang.sql
-- ------------------------------------------------------------
-- ============================================================
-- #72 — ADMIN_DOCS_META.lang : lingua della lettera di disdetta
--
-- La richiesta formale di résiliation di un contratto parte dall'admin e
-- arriva al FORNITORE, non al ristoratore. Quindi non segue `admin_lang`:
-- segue la lingua del destinatario, che si sceglie sul documento stesso
-- (Réglages -> Documents -> contratto -> "Lingua della lettera").
--
-- NULL / colonna assente = comportamento storico: la lettera parte nella
-- lingua dell'admin. Nessun documento esistente cambia.
--
-- Idempotente.
-- ============================================================

alter table public.admin_docs_meta
  add column if not exists lang text;


-- ------------------------------------------------------------
-- #73 — locations.sql
-- ------------------------------------------------------------
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
  image_url          text,                        -- foto o logo della sede (bucket `brand`, cartella sedi/)
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- Aggiunta dopo la prima esecuzione: chi aveva gia' lanciato questo file
-- (450 Gradi, 13/09) lo rilancia e si prende solo la colonna nuova.
alter table public.locations add column if not exists image_url text;

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
--
--     ⚠️ `value` e' CIFRATO (AES-256-GCM, vedi src/lib/segreti.ts), con una
--     chiave madre che resta nel .env (`SECRETS_KEY`). Un database non e' un
--     posto piu' sicuro di un file: e' replicato, finisce nei backup e si
--     esporta dal pannello. Un valore senza il prefisso `v1.` e' in chiaro:
--     scritto prima della cifratura, si rilegge com'e' e diventa cifrato
--     alla prima riscrittura.
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

-- ------------------------------------------------------------
-- 8. SNELLIMENTO di `locations` (deciso 13/09/2026)
--
--    La scheda Sedi vive in /admin/super, dove il ristoratore NON entra.
--    Indirizzo, telefono, email, ragione sociale e IVA sono suoi: li
--    cambia lui, quindi devono stare in Réglages → Général, non qui.
--    Stessa cosa per la scheda Google, che si sceglie in Intégrations.
--
--    Di conseguenza quelle colonne non hanno piu' nessuno che le scrive:
--    se restassero sarebbero il doppione che stiamo togliendo, solo
--    spostato nel database. Vanno in `location_config` con le STESSE
--    chiavi che Général usa gia' (`company_street`, `public_phone`, …),
--    cosi' la pagina non impara niente di nuovo: legge `app_config` e ci
--    sovrappone la riga della sede. Riga assente = vale il marchio.
--
--    `locations` resta l'IDENTITA' della sede: nome, slug, foto, fuso,
--    ordine, attiva. Il fuso resta una colonna di proposito — non e' un
--    dato di mestiere, decide come si calcola ogni data, e se ripiegasse
--    in silenzio su un valore sbagliato sbaglierebbero slot e chiusure.
--
--    Prima TRAVASA quello che e' gia' stato scritto, poi lascia cadere le
--    colonne. Idempotente: la seconda volta le colonne non ci sono piu' e
--    il blocco non fa niente.
-- ------------------------------------------------------------
do $$
declare
  coppie constant text[][] := array[
    ['address',      'company_street'],
    ['postcode',     'company_zip'],
    ['city',         'company_city'],
    ['phone',        'public_phone'],
    ['email',        'public_email'],
    ['company_name', 'company_name'],
    ['company_vat',  'company_vat'],
    ['google_location', 'google_location']
  ];
  colonna text;
  chiave  text;
  i       int;
begin
  if to_regclass('public.locations') is null or to_regclass('public.location_config') is null then
    raise notice 'salto lo snellimento: locations/location_config assenti';
    return;
  end if;
  for i in 1 .. array_length(coppie, 1) loop
    colonna := coppie[i][1];
    chiave  := coppie[i][2];
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'locations' and column_name = colonna
    ) then
      -- Solo i valori davvero scritti: una stringa vuota non e' una
      -- sovrascrittura, e' l'assenza di sovrascrittura.
      execute format(
        'insert into public.location_config (location_id, key, value)
           select id, %L, %I from public.locations
            where %I is not null and btrim(%I) <> %L
         on conflict (location_id, key) do nothing',
        chiave, colonna, colonna, colonna, ''
      );
      execute format('alter table public.locations drop column %I', colonna);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9. Il FUSO in un posto solo (deciso 14/09/2026)
--
--    La sezione 8 aveva lasciato `timezone` come colonna di `locations`,
--    col ragionamento che e' strutturale e non un dato di mestiere.
--    Il ragionamento cade nel momento in cui Réglages → Général diventa
--    per sede: da li' il fuso si scrive in `location_config.timezone`, e
--    la colonna diventa una SECONDA sorgente per lo stesso fatto. Due
--    sorgenti che dicono ore diverse non danno errore — danno slot
--    sbagliati, e nessuno sa quale delle due ha vinto.
--
--    Quindi: travaso e via. Chi non ha ancora scritto niente ricade sul
--    fuso dell'installazione (`app_config.timezone`), che e' il valore
--    giusto per un gruppo tutto nello stesso paese.
--
--    Idempotente: la seconda volta la colonna non c'e' piu'.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.locations') is null or to_regclass('public.location_config') is null then
    raise notice 'salto il fuso: locations/location_config assenti';
    return;
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'locations' and column_name = 'timezone'
  ) then
    -- Solo i fusi DIVERSI da quello dell'installazione: copiare anche gli
    -- uguali riempirebbe `location_config` di righe che non dicono niente
    -- e che poi nessuno sa se sono una scelta o un residuo.
    insert into public.location_config (location_id, key, value)
      select l.id, 'timezone', l.timezone
        from public.locations l
       where coalesce(btrim(l.timezone), '') <> ''
         and l.timezone is distinct from (
               select c.value from public.app_config c where c.key = 'timezone'
             )
      on conflict (location_id, key) do nothing;
    alter table public.locations drop column timezone;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. MENU — cosa e' del gruppo e cosa del punto (deciso 14/09/2026)
--
--     La carta e' UNA per tutte le sedi. Tre cose pero' sono del punto:
--
--     a) IL PIATTO INTERO puo' essere di una sede sola — il dolce che fa
--        solo Schaerbeek. Non serve niente di nuovo: `menu_items` ha gia'
--        `location_id` (sezione 2) ed e' classificata «mista», quindi
--        NULL = di tutti, id = di quel punto. Serve solo l'interruttore
--        nel modale del piatto.
--
--     b) IL FORMATO (la «variante») puo' essere di una sede sola — la
--        pizza in teglia che fa solo Stockel. I formati NON sono righe:
--        sono un array JSON dentro `menu_items.variants`. Quindi la sede
--        se la porta dentro il formato stesso, con la stessa regola:
--        `{"key":"teglia", …, "location_id":"<uuid>"}`; campo assente =
--        vale per tutti. Nessuna tabella nuova, nessuna colonna nuova.
--        Il filtro vive in `variantiDelPunto()` (src/lib/pricing.ts), che
--        e' gia' il punto di verita' condiviso fra sito, checkout e admin.
--
--     c) L'ESAURITO e' un'altra cosa, ed e' per questo che ha una tabella
--        sua. Non e' una DEFINIZIONE ma uno STATO: cambia dieci volte a
--        settimana, lo tocca chi sta in cucina, e non deve entrare nella
--        carta. Se stesse dentro `menu_items`, ogni «finita la burrata»
--        sarebbe una modifica al menu del GRUPPO.
--
--        Riga assente = disponibile. `variants_off` tiene i formati finiti
--        (la burrata e' finita solo nel formato grande).
-- ------------------------------------------------------------
create table if not exists public.menu_sold_out (
  location_id  uuid not null references public.locations(id) on delete cascade,
  item_id      uuid not null references public.menu_items(id) on delete cascade,
  sold_out     boolean not null default true,
  variants_off text[]  not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (location_id, item_id)
);

alter table public.menu_sold_out enable row level security;
grant select, insert, update, delete on public.menu_sold_out to service_role;

-- ------------------------------------------------------------
-- 11. LO STORICO ORFANO (deciso 14/09/2026)
--
--     La sezione 2 AGGIUNGE `location_id` ma non la riempie: quando
--     gira, le sedi non esistono ancora. Quindi ogni riga creata prima
--     resta a NULL — e per una tabella «sede» il filtro e'
--     `location_id = <id>`, che NULL non soddisfa. Risultato: acceso il
--     multi-sede, tutto lo storico sparisce da OGNI punto e riappare
--     solo nell'aggregato.
--
--     Non e' un fastidio estetico. Fra le tabelle colpite ci sono i
--     TAVOLI: il ristorante si ritroverebbe il piano sala vuoto e le
--     prenotazioni non assegnabili.
--
--     ⚠️ Si toccano SOLO le tabelle «sede». Sulle MISTE (menu_items,
--     special_days, popups, team, agenda_events) NULL vuol dire «vale per tutte le
--     sedi» ed e' un valore legittimo: riempirlo qui trasformerebbe il
--     menu del gruppo nel menu di un punto solo. Sulle tabelle di
--     MARCHIO NULL e' l'unico valore possibile. L'elenco qui sotto deve
--     restare uguale a `CLASSIFICA` in `src/lib/admin/sedeRegole.ts`:
--     un test lo verifica.
-- ------------------------------------------------------------
create or replace function public.tabelle_di_sede()
returns text[] language sql immutable as $$
  -- Le tabelle «sede» che possono avere righe storiche a NULL.
  -- Escluse quelle nate dopo (location_config, location_settings,
  -- location_secrets, menu_sold_out): li' `location_id` e' NOT NULL.
  select array[
    -- ⚠️ `agenda_events` NON c'e' piu' (16/09/2026): e' diventata «mista»,
    -- quindi NULL vuol dire «evento di tutto il gruppo» ed e' un valore
    -- legittimo. Riempirlo trasformerebbe il calendario del marchio nel
    -- calendario di un punto solo.
    'admin_docs_meta', 'admin_notes', 'gift_card_redemptions',
    'google_reviews', 'orders', 'print_orders', 'push_subscriptions',
    'reservations', 'restaurant_tables', 'service_closures', 'zone_closures'
  ]::text[];
$$;

-- Quante righe orfane, tabella per tabella. Sola lettura: la usa il
-- super admin per DIRE quante ne sta per spostare prima di chiedere.
create or replace function public.storico_senza_sede()
returns table(tabella text, n bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text; c bigint;
begin
  foreach t in array public.tabelle_di_sede() loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select count(*) from public.%I where location_id is null', t) into c;
    if c > 0 then tabella := t; n := c; return next; end if;
  end loop;
end $$;

-- Assegna lo storico orfano a una sede. IDEMPOTENTE: tocca solo i NULL,
-- quindi la seconda volta non fa niente.
--
-- ⚠️ `service_closures` e `zone_closures` hanno un indice unico per
-- (sede, data, servizio). Se qualcuno ha spento e riacceso il multi, una
-- chiusura scritta a NULL nel frattempo puo' scontrarsi con una gia'
-- assegnata: quelle righe si SALTANO invece di far morire tutto il
-- travaso, e il conteggio le riporta.
create or replace function public.assegna_storico_sede(sede uuid)
returns table(assegnate bigint, saltate bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text; n bigint; r record;
begin
  assegnate := 0; saltate := 0;
  if sede is null then
    raise exception 'assegna_storico_sede: sede obbligatoria';
  end if;
  if not exists (select 1 from public.locations where id = sede) then
    raise exception 'assegna_storico_sede: sede inesistente %', sede;
  end if;

  foreach t in array public.tabelle_di_sede() loop
    if to_regclass('public.' || t) is null then continue; end if;
    begin
      execute format('update public.%I set location_id = %L where location_id is null', t, sede);
      get diagnostics n = row_count;
      assegnate := assegnate + n;
    exception when unique_violation then
      -- Una riga sola fa fallire tutto il blocco: si ripassa riga per
      -- riga e si salta quella che si scontra.
      for r in execute format('select ctid from public.%I where location_id is null', t) loop
        begin
          execute format('update public.%I set location_id = %L where ctid = %L', t, sede, r.ctid);
          assegnate := assegnate + 1;
        exception when unique_violation then
          saltate := saltate + 1;
        end;
      end loop;
    end;
  end loop;
  return next;
end $$;

revoke all on function public.tabelle_di_sede() from public;
revoke all on function public.storico_senza_sede() from public;
revoke all on function public.assegna_storico_sede(uuid) from public;
grant execute on function public.tabelle_di_sede() to service_role;
grant execute on function public.storico_senza_sede() to service_role;
grant execute on function public.assegna_storico_sede(uuid) to service_role;

-- ------------------------------------------------------------
-- 12. I BUONI REGALO — chi ha incassato e chi ha servito
--     (deciso 16/09/2026)
--
--     Il buono si compra ovunque e si spende ovunque: e' la decisione del
--     cliente, e resta tale. Quindi `gift_cards` NON diventa una tabella
--     di sede — se lo diventasse, un buono comprato a Jourdan risulterebbe
--     inesistente a Stockel, e il cliente si sentirebbe dire che il suo
--     codice non esiste senza che nessun errore compaia da nessuna parte.
--
--     Ma con tre societa' il denaro attraversa un confine: chi vende
--     incassa, chi serve consegna, e non sono la stessa persona giuridica.
--     Servono due fatti, non uno:
--
--       gift_cards.sold_at_location          — CHI HA INCASSATO
--       gift_card_redemptions.location_id    — CHI HA SERVITO (gia' c'e',
--                                              sezione 2, tabella «sede»)
--
--     ⚠️ Il nome `sold_at_location` e' deliberatamente DIVERSO da
--     `location_id`. Ovunque altrove `location_id` vuol dire «di chi e'
--     questa riga» ed e' la colonna su cui si filtra. Qui la domanda e'
--     un'altra — «chi ha preso i soldi» — e la risposta non deve MAI
--     diventare un filtro. Due domande diverse, due nomi diversi: cosi'
--     nessuna macchina generica, e nessuno che passi di qui fra un anno,
--     puo' scambiarle. La `location_id` che la sezione 2 ha aggiunto a
--     `gift_cards` resta a NULL: il buono e' del marchio.
--
--     NULLABLE e senza travaso: i buoni gia' venduti non hanno un punto
--     di vendita ricostruibile, e inventarlo sarebbe peggio del vuoto.
--     Compariranno nel conto sotto «senza sede», che e' la verita'.
--
--     `on delete restrict`: cancellare una sede non deve portarsi via il
--     buono di un cliente che non c'entra niente.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.gift_cards') is null or to_regclass('public.locations') is null then
    raise notice 'salto i buoni: gift_cards/locations assenti';
    return;
  end if;
  alter table public.gift_cards
    add column if not exists sold_at_location uuid
      references public.locations(id) on delete restrict;
  create index if not exists gift_cards_sold_at_idx
    on public.gift_cards (sold_at_location);
end $$;

-- ------------------------------------------------------------
-- 13. I COUPON — in quali punti vale un codice (deciso 16/09/2026)
--
--     Un codice promo puo' valere in tutti e tre i punti, in due, o in uno
--     solo. Con tre societa' non e' un dettaglio di presentazione: lo
--     sconto lo paga la cassa di chi serve, e un codice pensato per
--     Stockel che funziona anche a Jourdan e' denaro che esce da una
--     societa' che non ha deciso niente.
--
--     ⚠️ Un ARRAY e non una colonna `location_id`, e il motivo e' «due su
--     tre»: «Jourdan e Stockel ma non Schaerbeek» non si scrive con una
--     colonna sola. Il modello NULL-o-un-id, che regge tutto il resto del
--     multi-sede, qui non basta — ed e' l'unico posto in cui non basta.
--
--     ⚠️ `coupons` resta «marchio» in CLASSIFICA: la riga e' del gruppo, e'
--     la sua VALIDITA' a essere ristretta. Se diventasse di sede, il
--     responsabile di un punto non vedrebbe piu' i codici del gruppo e ne
--     creerebbe di doppi con lo stesso nome — e `code_norm` e' unico, cosi'
--     il secondo fallirebbe con un errore che non spiega niente.
--
--     VUOTO o NULL = tutte le sedi. E' anche lo stato di tutti i coupon che
--     esistono oggi, quindi non serve nessun travaso: continuano a valere
--     ovunque, che e' quello che valevano ieri.
--
--     Niente chiave esterna: Postgres non sa mettere un `references` su un
--     elemento di array. Se una sede viene cancellata, il suo id resta
--     nell'elenco come un valore che non corrisponde a niente — e
--     `couponValePer` lo tratta per quello che e': un punto che non e'
--     questo. Il codice continua a valere dove valeva.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.coupons') is null then
    raise notice 'salto i coupon: tabella assente';
    return;
  end if;
  alter table public.coupons add column if not exists locations uuid[];
end $$;


-- ------------------------------------------------------------
-- #74 — reservations_source_canali.sql
-- ------------------------------------------------------------
-- #74 — Altri canali di provenienza: instagram e qr
--
-- La #21 aveva creato `source` con quattro valori. Il link della scheda
-- Google Business (?ref=google) ne ha aperti altri: la bio di Instagram e il
-- QR sui tavoli e sui volantini.
--
-- ⚠️ Il `check` va RIFATTO, non allargato: PostgreSQL non sa modificare un
-- vincolo esistente. Si toglie e si rimette. Finche' non si lancia questo
-- file, `?ref=instagram` farebbe fallire l'inserimento — cioe' una
-- prenotazione persa, non una statistica sbagliata: per questo il codice
-- ripiega su 'web' e c'e' una prova che confronta i due elenchi.
--
-- `qr` resta un valore a se' anche se nell'admin porta l'icona del sito:
-- il QR sui tavoli e il sito sono la stessa esperienza per chi guarda la
-- lista, ma sono due canali diversi per chi decide dove spendere.
--
-- Idempotente: si puo' rilanciare.

do $$
begin
  if to_regclass('public.reservations') is null then
    raise notice 'reservations non esiste: niente da fare';
    return;
  end if;

  alter table public.reservations drop constraint if exists reservations_source_check;

  alter table public.reservations
    add constraint reservations_source_check
    check (source in ('web', 'walkin', 'phone', 'google', 'instagram', 'qr'));

  raise notice 'source: ammessi web, walkin, phone, google, instagram, qr';
end $$;


-- ------------------------------------------------------------
-- #75 — orders_onsite_payment.sql
-- ------------------------------------------------------------
-- ============================================================
-- #75 — `orders.payment_method` accetta 'onsite'
--
-- ⚠️ SENZA QUESTA MIGRAZIONE L'ORDINE NON NASCE. Dal 29/09 un locale puo'
-- spegnere il pagamento con carta e far pagare al ritiro: il checkout salva
-- allora `payment_method = 'onsite'`. La colonna pero' nasce dalla #49 con
--     check (payment_method in ('cash', 'card', 'link'))
-- e PostgreSQL rifiuta l'insert. Il cliente riempie il carrello, preme
-- «Ordina» e si sente rispondere «Impossibile creare l'ordine»: nessuna riga
-- nel database, nessun avviso in cucina, nessun errore nei log.
--
-- E' lo stesso guasto della #74 — `reservations.source` allargato a
-- `instagram` e `qr` — ma sugli ordini: il codice impara un valore nuovo e il
-- `check` resta indietro. Li' la lezione era gia' scritta, e non e' bastata:
-- da oggi `tests/ordini.test.mjs` confronta i valori scritti dal codice con
-- l'elenco di questo vincolo, e diventa rosso prima del rilascio.
--
-- Il vincolo si rifa' (drop + add): PostgreSQL non lo sa modificare sul posto.
-- Idempotente: si puo' rilanciare.
-- ============================================================

alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'link', 'onsite'));


-- ------------------------------------------------------------
-- #76 — print_tickets.sql
-- ------------------------------------------------------------
-- ============================================================
-- #76 — `print_tickets`: la coda dei ticket da stampare
--
-- ⚠️ PERCHE' UNA CODA E NON UNA CHIAMATA DIRETTA. Il ticket esce da una
-- stampante che sta in cucina, dall'altra parte di internet. Quando l'ordine
-- viene pagato quella stampante puo' essere spenta, senza carta, o il tablet
-- puo' essersi addormentato. Senza una riga che aspetta, quel ticket e' perso
-- e nessuno lo sa: in cucina semplicemente non arriva niente, e l'ordine si
-- scopre quando il cliente si presenta al banco.
--
-- Con la coda, la riga resta `queued` e riparte da sola appena la stampante
-- torna viva. Ed e' anche l'unico modo di distinguere «stampato» da «mai
-- uscito»: lo stato diventa `printed` solo quando il servizio di stampa lo
-- conferma, non quando noi abbiamo spedito.
--
-- ⚠️ L'INDICE UNICO E' LA PROTEZIONE DAL DOPPIO TICKET. Un ordine pagato puo'
-- essere visto piu' volte (webhook Stripe ripetuto, polling, modifica),
-- e ogni volta si proverebbe a mettere in coda lo stesso ticket. In cucina
-- due comande uguali vogliono dire due pizze. L'indice vale solo per le righe
-- `auto`: le ristampe chieste a mano sono righe nuove, e devono poter essere
-- quante se ne vogliono.
--
-- `location_id` NULL = cliente a sede unica, come in tutte le altre tabelle.
-- Idempotente: si puo' rilanciare.
-- ============================================================

create table if not exists public.print_tickets (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  location_id uuid null references public.locations(id) on delete restrict,
  -- Oggi solo la cucina. `customer` esiste perche' il giorno che serve lo
  -- scontrino cliente non si tocchi ne' la tabella ne' l'indice.
  kind        text not null default 'kitchen' check (kind in ('kitchen', 'customer')),
  origin      text not null default 'auto'    check (origin in ('auto', 'manual')),
  status      text not null default 'queued'  check (status in ('queued', 'sent', 'printed', 'failed')),
  -- Chiave della pagina pubblica del ticket: e' l'unica cosa che protegge i
  -- dati del cliente, perche' quella pagina la deve poter leggere il servizio
  -- di stampa, che non sa fare login.
  token       text not null unique,
  -- Id del lavoro restituito dal servizio di stampa: serve a ricollegare la
  -- sua conferma a questa riga.
  job_id      text,
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  printed_at  timestamptz
);

create unique index if not exists print_tickets_auto_unico
  on public.print_tickets (order_id, kind) where origin = 'auto';

create index if not exists print_tickets_da_fare
  on public.print_tickets (status, created_at) where status in ('queued', 'sent');

create index if not exists print_tickets_order on public.print_tickets (order_id);


-- ------------------------------------------------------------
-- #77 — print_tickets_dest.sql
-- ------------------------------------------------------------
-- ============================================================
-- #77 — `print_tickets.dest`: un ticket per STAMPANTE, non per ordine
--
-- ⚠️ PERCHE' SERVE. La #76 protegge dal doppio ticket con un indice unico su
-- `(order_id, kind) where origin = 'auto'`. Con una stampante sola e' giusto.
-- Con tre destinazioni — pizze al forno, bibite al bar, freddi ai freddi —
-- quell'indice VIETA esattamente cio' che serve: il secondo e il terzo
-- ticket dello stesso ordine li rifiuta il database, e in cucina non arriva
-- niente. Scoprirlo qui costa una riga; scoprirlo in servizio costa le
-- bibite di una serata.
--
-- `dest` e' il NOME della destinazione (''=la principale). Non un id: le
-- destinazioni vivono in `location_config` come configurazione, non come
-- tabella, e un nome e' quello che si legge nel pannello e sul ticket.
--
-- Idempotente: si puo' rilanciare.
-- ============================================================

alter table public.print_tickets
  add column if not exists dest text not null default '';

-- L'indice vecchio non vale piu': sostituito, non affiancato. Due indici
-- unici che dicono cose diverse sullo stesso fatto sono un modo di non
-- sapere piu' quale regola vale.
drop index if exists print_tickets_auto_unico;

create unique index if not exists print_tickets_auto_unico
  on public.print_tickets (order_id, kind, dest) where origin = 'auto';

