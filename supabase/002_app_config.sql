-- ============================================================
-- #2 — APP_CONFIG — coppie chiave/valore per configurazioni
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
