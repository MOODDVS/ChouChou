-- ============================================================
-- #82 — Ordinare DAL TAVOLO: `service`, il tavolo, la prenotazione.
--
--   service        text  'pickup' (da asporto) | 'table' (al tavolo)
--   table_id       uuid  il tavolo in `restaurant_tables` (NULL se da asporto)
--   table_label    text  come si chiamava QUEL tavolo quel giorno
--   reservation_id uuid  la prenotazione `seated` aperta per questo tavolo
--
-- ⚠️ `service` ESISTE PERCHE' `pickup_time` NON BASTA PIU'. Un ordine al
-- tavolo non ha un'ora di ritiro, ma quella colonna la legge mezzo motore: la
-- colonna della Accueil, il ticket, il bottone del ritardo, le email. E
-- soprattutto il semaforo dei ritardatari (`ncLivelloRitardo`), che diventa
-- giallo cinque minuti dopo l'ora di ritiro e ROSSO dopo un quarto d'ora:
-- scrivendoci «adesso», ogni tavolo diventerebbe rosso mentre la gente mangia,
-- e la lista della sera sarebbe tutta rossa. Chi legge `pickup_time` adesso
-- puo' chiedere di che servizio si tratta, invece di indovinarlo.
--
-- ⚠️ DUE COLONNE PER IL TAVOLO, come per le note assegnate (#81). L'id serve
-- a collegare, il nome a LEGGERE: un tavolo rinominato da «7» a «Terrasse 2»,
-- o tolto dalla sala d'inverno, lascerebbe gli ordini di marzo senza un
-- numero da dire a voce. Il nome salvato accanto continua a dire dov'era
-- seduto quel cliente.
--
-- ⚠️ `table_id` NON ha una foreign key verso `restaurant_tables`. Un vincolo
-- costringerebbe a scegliere fra rifiutare la rimozione di un tavolo e
-- cancellare gli ordini che ci sono passati: due comportamenti sbagliati per
-- lo stesso fatto. Senza vincolo l'id resta e non trova piu' niente —
-- l'ordine diventa storia, che e' cio' che e'.
--
-- ⚠️ `reservation_id` INVECE ce l'ha, con `on delete set null`: li' la
-- semantica e' chiara. La prenotazione `seated` e' il tavolo di stasera, e se
-- qualcuno la cancella l'ordine resta — era un incasso vero — ma smette di
-- puntare a una riga che non c'e'. Serve a due cose: mostrare «tavolo 7, 4
-- persone» sulla card, e far ritrovare al secondo giro la stessa
-- prenotazione invece di aprirne un'altra.
--
-- ⚠️ `service` ha un `check` e un `default`, e tutti e due contano. Il
-- default tiene veri i milioni di righe gia' scritte: erano tutte da asporto.
-- Il check impedisce che un terzo valore entri senza che nessuno decida cosa
-- deve farne il ticket, il semaforo e le statistiche.
-- ============================================================
alter table public.orders add column if not exists service        text not null default 'pickup';
alter table public.orders add column if not exists table_id       uuid;
alter table public.orders add column if not exists table_label    text;
alter table public.orders add column if not exists reservation_id uuid references public.reservations(id) on delete set null;

-- ⚠️ Il vincolo si aggiunge a parte e in modo idempotente: `add column if not
-- exists` non lo porta con se' quando la colonna c'e' gia' (installazione che
-- ripassa le migrazioni), e un `check` perso non si vede finche' qualcuno non
-- scrive un valore storto.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_service_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_service_check check (service in ('pickup', 'table'));
  end if;
end $$;

-- «Chi c'e' ai tavoli adesso»: la domanda che la pagina Commandes fa a ogni
-- aggiornamento. Solo i tavoli, perche' i ritiri hanno gia' il loro indice su
-- (status, pickup_time).
create index if not exists idx_orders_table
  on public.orders (table_id, created_at) where service = 'table';
