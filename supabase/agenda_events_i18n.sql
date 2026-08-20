-- Traduzioni di titolo e descrizione degli eventi (agenda) per lingua del sito.
alter table public.agenda_events add column if not exists title_i18n jsonb;
alter table public.agenda_events add column if not exists body_i18n jsonb;

-- Descrizione LUNGA (per la pagina dettaglio) tradotta + numero max iscrizioni RSVP.
alter table public.agenda_events add column if not exists body_long_i18n jsonb;
alter table public.agenda_events add column if not exists rsvp_max int;
