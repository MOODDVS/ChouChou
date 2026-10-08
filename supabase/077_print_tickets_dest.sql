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
