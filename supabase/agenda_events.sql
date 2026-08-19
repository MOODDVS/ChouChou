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
