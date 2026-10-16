-- ============================================================
-- #83 — «APPELER LE SERVEUR»: il tavolo chiama, il tablet suona.
--
--   location_id  uuid  la sede (NULL a sede unica, come gli ordini)
--   table_id     uuid  il tavolo in `restaurant_tables` (NULL = sala senza tavoli)
--   table_label  text  come si chiamava QUEL tavolo in quel momento
--   caller_name  text  il nome di chi chiama, dove la sala non ha tavoli
--   status       text  'open' (nessuno ci e' ancora andato) | 'done'
--   created_at   quando ha chiamato
--   done_at      quando qualcuno ha toccato il toast per dire «ci vado»
--
-- ⚠️ UNA TABELLA E NON UNA RIGA IN `reservations`. La chiamata non e' una
-- sessione: la puo' fare chi non ha ancora ordinato niente — anzi, e' il
-- caso piu' comune («possiamo avere la carta dei vini?»). Attaccarla alla
-- prenotazione vorrebbe dire aprire un conto a chi chiede un bicchiere
-- d'acqua, e un coperto in piu' nel piano sala per ogni domanda.
--
-- ⚠️ DUE COLONNE PER IL TAVOLO, come gli ordini (#82): l'id collega, il nome
-- si LEGGE — un tavolo rinominato stasera lascerebbe il toast senza numero.
-- Nessuna foreign key su `table_id`, per la stessa ragione della #82.
--
-- ⚠️ DOVE LA SALA NON HA TAVOLI si chiama col NOME («Marc appelle le
-- serveur»): e' lo stesso modo in cui ordina chi e' li' (#82, ticket col
-- nome). Per questo `table_id` e' facoltativo e c'e' `caller_name`. Una riga
-- ha sempre l'uno o l'altro: lo pretende la rotta, che e' l'unica a scrivere.
--
-- ⚠️ `location_id` NULLABLE come in `orders`: un cliente a sede unica scrive
-- NULL, e NULL li' vuol dire «l'unico punto che c'e'».
--
-- ⚠️ IL GRANT AL service_role E' OBBLIGATORIO: in questi progetti le tabelle
-- nuove nascono senza privilegi per l'API, e senza GRANT il server non ci
-- puo' scrivere — la campanella suonerebbe sul telefono del cliente e su
-- nessun tablet (il guasto di `print_tickets`, 06/10/2026).
--
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

create table if not exists public.table_calls (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid null references public.locations(id) on delete restrict,
  table_id    uuid,
  table_label text not null default '',
  caller_name text not null default '',
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

-- ⚠️ Per chi aveva gia' lanciato la prima versione di questo file (tavolo
-- obbligatorio, nessun nome): `create table if not exists` non tocca una
-- tabella che c'e' gia', quindi le due differenze si portano qui, idempotenti.
alter table public.table_calls alter column table_id drop not null;
alter table public.table_calls add column if not exists caller_name text not null default '';

-- «Chi sta chiamando adesso?»: la domanda che ogni tablet fa ogni pochi
-- secondi. Solo le aperte: le chiuse sono storia e nessuno le cerca.
create index if not exists table_calls_aperte
  on public.table_calls (location_id, created_at) where status = 'open';

grant select, insert, update, delete on public.table_calls to service_role;
