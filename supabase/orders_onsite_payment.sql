-- ============================================================
-- #75 — `orders.payment_method` accetta 'onsite'
--
-- ⚠️ SENZA QUESTA MIGRAZIONE L'ORDINE NON NASCE. Dal 29/09 un locale puo'
-- spegnere il pagamento con carta e far pagare al ritiro: il checkout salva
-- allora `payment_method = 'onsite'`. La colonna pero' nasce dalla #49 con
--     check (payment_method in ('cash', 'card', 'link'))
-- e PostgreSQL rifiuta l'insert. Il cliente riempie il carrello, preme
-- «Ordina» e si sente rispondere «Impossibile creare l'ordine»: nessuna riga
-- nel database, nessun avviso in cucina, nessun errore nei log.
--
-- E' lo stesso guasto della #74 — `reservations.source` allargato a
-- `instagram` e `qr` — ma sugli ordini: il codice impara un valore nuovo e il
-- `check` resta indietro. Li' la lezione era gia' scritta, e non e' bastata:
-- da oggi `tests/ordini.test.mjs` confronta i valori scritti dal codice con
-- l'elenco di questo vincolo, e diventa rosso prima del rilascio.
--
-- Il vincolo si rifa' (drop + add): PostgreSQL non lo sa modificare sul posto.
-- Idempotente: si puo' rilanciare.
-- ============================================================

alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'link', 'onsite'));
