-- ============================================================
-- #101 — L'ANNUNCIO IN CUCINA ALL'APERTURA (27/11/2026)
--
-- Un ordine preso a locale CHIUSO per un altro giorno (stanotte per domani
-- sera, o stamattina prima dell'apertura) non fa uscire il ticket e non fa
-- suonare RestoHub quando arriva: lo fa all'apertura del giorno del ritiro.
-- Le email (conferma al cliente, «Nouvelle commande» al ristorante) partono
-- subito come sempre.
--
--   orders.announce_at   quando annunciarlo in cucina (ticket, suono,
--                        notifica). NULL = gia' annunciato, o subito: tutti
--                        gli ordini di prima e quelli presi a locale aperto.
--
-- Lo scrive il checkout solo per l'ordine che deve aspettare; lo rimette a
-- NULL il job `annuncia-ordini` (ogni 5 minuti) quando stampa e avvisa.
-- Senza questa migrazione tutto come prima: ticket e suono all'ordine.
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.orders add column if not exists announce_at timestamptz;

-- Il job cerca solo le righe in attesa: poche, e un indice parziale le trova
-- senza leggere tutti gli ordini.
create index if not exists orders_announce_at_idx
  on public.orders (announce_at)
  where announce_at is not null;
