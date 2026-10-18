-- ============================================================
-- #87 — IL CONTO APERTO AL TAVOLO (disegno: progetto, conto-aperto.md)
--
-- Si ordina dal tavolo senza pagare subito: il primo invio lo valida il
-- personale, gli altri partono da soli, si paga alla fine.
--
-- ⚠️ IL CONTO E' LA SESSIONE DEL TAVOLO CHE ESISTE GIA': la prenotazione
-- «seated» che `/api/table-session` apre al primo ordine dal QR. Non una
-- tabella nuova: il piano sala, i coperti e `table_minutes` la conoscono gia',
-- e un conto in un posto diverso sarebbe una seconda verita' sullo stesso
-- tavolo. Qui le si aggiunge solo cio' che serve al conto:
--
--   reservations.tab_status        NULL = nessun conto (ordine «a ogni giro»,
--                                  o prenotazione normale) |
--                                  'pending' (aperto, primo invio da validare) |
--                                  'open' (validato) | 'closed'
--   reservations.tab_code          il codice a 2 cifre per unirsi («07»)
--   reservations.tab_table_id      il tavolo su cui e' stato aperto
--   reservations.tab_people        le persone dichiarate all'apertura
--   reservations.tab_validated_at  quando il personale ha validato
--   reservations.tab_closed_at     quando il conto e' stato chiuso
--   reservations.tab_fails         tentativi di codice sbagliati di fila…
--   reservations.tab_fails_at      …e l'ora dell'ultimo: oltre un tetto ci si
--                                  blocca per qualche minuto (100 codici si
--                                  proverebbero tutti in un attimo)
--
-- ⚠️ UN SOLO CONTO APERTO PER TAVOLO, GARANTITO QUI e non nella pagina: due
-- amici che premono «Ouvrir un compte» nello stesso secondo devono trovare
-- un vincitore, e solo il database lo sa decidere. Il secondo riceve
-- «gia' aperto» e si unisce col codice. Indice unico PARZIALE: i conti
-- chiusi non contano, il tavolo si riapre la sera dopo.
--
--   table_rounds   GLI INVII: un ticket per invio al tavolo, non per ordine.
--                  Quattro amici che ordinano ognuno dal suo telefono fanno
--                  quattro ordini (chi ha preso cosa, chi paga cosa) e UN
--                  ticket. Il primo invio aspetta la validazione
--                  (`release_at` NULL); gli altri partono alla fine della
--                  finestra di raggruppamento (`orders_table_batch`).
--   orders.round_id   l'invio a cui l'ordine appartiene
--   orders.payment_method   accetta 'tab': non pagato, sul conto. ⚠️ Un
--                  valore SUO e non 'onsite': un 'onsite' in attesa esce
--                  subito in cucina (`daStampare`), e il primo invio di un
--                  conto non deve uscire prima della validazione.
--
-- ⚠️ IL GRANT AL service_role E' OBBLIGATORIO (vedi #83): senza, il server
-- non puo' scrivere gli invii.
--
-- I pagamenti del conto (parti uguali, «tout le reste») arriveranno con la
-- loro migrazione nella fase del pagamento online.
--
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.reservations
  add column if not exists tab_status       text,
  add column if not exists tab_code         text,
  add column if not exists tab_table_id     uuid,
  add column if not exists tab_people       integer,
  add column if not exists tab_validated_at timestamptz,
  add column if not exists tab_closed_at    timestamptz,
  add column if not exists tab_fails        integer not null default 0,
  add column if not exists tab_fails_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'reservations_tab_status_check' and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations
      add constraint reservations_tab_status_check
      check (tab_status is null or tab_status in ('pending', 'open', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'reservations_tab_code_check' and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations
      add constraint reservations_tab_code_check
      check (tab_code is null or tab_code ~ '^[0-9]{2}$');
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'reservations_tab_people_check' and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations
      add constraint reservations_tab_people_check
      check (tab_people is null or (tab_people >= 1 and tab_people <= 100));
  end if;
end $$;

-- Un solo conto aperto (o da validare) per tavolo.
create unique index if not exists reservations_un_conto_per_tavolo
  on public.reservations (tab_table_id) where tab_status in ('pending', 'open');

create table if not exists public.table_rounds (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid null references public.locations(id) on delete restrict,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  number         integer not null check (number >= 1),
  status         text not null default 'waiting' check (status in ('waiting', 'released')),
  -- Quando parte: NULL = aspetta la validazione (primo invio); altrimenti la
  -- fine della finestra di raggruppamento.
  release_at     timestamptz,
  released_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (reservation_id, number)
);

-- «Quali invii devono partire adesso?»: solo quelli in attesa.
create index if not exists table_rounds_in_attesa
  on public.table_rounds (release_at) where status = 'waiting';

grant select, insert, update, delete on public.table_rounds to service_role;

alter table public.orders
  add column if not exists round_id uuid references public.table_rounds(id) on delete set null;

create index if not exists orders_round on public.orders (round_id) where round_id is not null;

-- Il vincolo si rifa' (drop + add): PostgreSQL non lo sa allargare sul posto.
alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'link', 'onsite', 'tab'));
