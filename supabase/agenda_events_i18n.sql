-- Traduzioni di titolo e descrizione degli eventi (agenda) per lingua del sito.
alter table public.agenda_events add column if not exists title_i18n jsonb;
alter table public.agenda_events add column if not exists body_i18n jsonb;
