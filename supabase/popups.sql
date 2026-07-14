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
