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
