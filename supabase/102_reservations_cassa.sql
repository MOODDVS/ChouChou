-- ============================================================
-- #102 — «PAGAMENTO IN CASSA» CHE LIBERA IL TAVOLO (27/11/2026)
--
-- Il cameriere tocca «Pagamento in cassa» sul palmare: esce l'addizione e il
-- tavolo diventa blu. Venti minuti dopo il tavolo si libera da solo e gli
-- ordini ancora da incassare si chiudono come pagati in cassa. Un nuovo
-- ordine nei venti minuti (il caffe') ristampa l'addizione e fa ripartire
-- il tempo.
--
--   reservations.desk_at   l'ultimo «Pagamento in cassa» (o l'ultimo ordine
--                          arrivato dopo). NULL = mai chiesto.
--
-- Lo libera il job `annuncia-ordini` (ogni 5 minuti), e di riserva il
-- palmare e RestoHub aperti.
-- Senza questa migrazione tutto come prima: il tavolo resta blu finche'
-- qualcuno non incassa. Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.reservations add column if not exists desk_at timestamptz;

-- Il job cerca solo i tavoli seduti col conto chiesto: pochi.
create index if not exists reservations_desk_at_idx
  on public.reservations (desk_at)
  where desk_at is not null and status = 'seated';
