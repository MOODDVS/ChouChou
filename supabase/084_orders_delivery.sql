-- ============================================================
-- #84 — LA CONSEGNA: un terzo servizio, e l'indirizzo dove portarla.
--
--   service           text   'pickup' | 'table' | 'delivery'
--   delivery_address  jsonb  { via, numero, box, cap, comune, note }
--
-- ⚠️ IL `check` SU `service` VA ALLARGATO, e non e' un dettaglio: la #82 lo
-- ha scritto apposta per non far entrare un terzo valore «senza che nessuno
-- decida cosa deve farne il ticket, il semaforo e le statistiche». Ora lo si
-- decide: la consegna stampa «CONSEGNA» e l'indirizzo, non manda l'email «c'e'
-- pronto, venite a prenderlo», e il semaforo dei ritardi resta quello del
-- ritiro (l'ora c'e', ed e' una promessa).
-- Senza questa migrazione un ordine con consegna NON entra: il checkout lo
-- rifiuta invece di salvarlo come un ritiro — un sacchetto che resterebbe sul
-- banco mentre il cliente lo aspetta a casa.
--
-- ⚠️ L'INDIRIZZO E' UN OGGETTO, NON UNA RIGA DI TESTO. Il fattorino legge la
-- riga composta, ma le zone di consegna (i codici postali serviti) e il costo
-- per zona dovranno leggere il CAP da solo: tagliarlo fuori da una stringa
-- libera e' il modo in cui «1050» diventa il numero civico di qualcuno.
-- La forma la fa rispettare l'API (`lib/consegnaRegole.ts`), che e' l'unica a
-- scriverla: nessun `check` sul JSON, come per `repeat` delle note (#80).
--
-- ⚠️ NESSUN DEFAULT su `delivery_address`: NULL vuol dire «non e' una
-- consegna», e tutte le righe gia' scritte lo sono.
-- ============================================================
alter table public.orders add column if not exists delivery_address jsonb;

-- Il vincolo si rifa' per intero: un `check` non si allarga, si sostituisce.
-- Idempotente — su un'installazione che ripassa le migrazioni lo ritrova gia'
-- largo e lo riscrive uguale.
alter table public.orders drop constraint if exists orders_service_check;
alter table public.orders
  add constraint orders_service_check check (service in ('pickup', 'table', 'delivery'));
