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
