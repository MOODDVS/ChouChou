-- ============================================================
-- #91 — QUALI ARTICOLI HA PAGATO OGNUNO (il palmare, «Scegli»)
--
-- Il palmare incassa un tavolo in tre modi (Enzo, 26/10/2026): tutto,
-- diviso per persona, o scegliendo gli articoli. I pagamenti parziali
-- stanno in `table_payments` (#88, la stessa tabella del conto aperto del
-- QR); per «Scegli» bisogna ricordare QUALI articoli sono gia' pagati, per
-- barrarli e non farli pagare due volte.
--
--   table_payments.items  jsonb: [{ "o": order_id, "i": riga, "u": unita' }]
--
-- Senza questa migrazione «Tutto» e «Dividi» funzionano lo stesso (con la
-- #88); «Scegli» non compare. Idempotente: rilanciarla e' sicuro.
-- ============================================================

-- ⚠️ Richiede la #88 (la tabella `table_payments`): senza, qui si ferma con
-- un messaggio che lo dice, invece di «relation does not exist».
do $$
begin
  if to_regclass('public.table_payments') is null then
    raise exception 'Manca la migrazione #88 (088_conto_pagamenti.sql): lanciala prima (o lancia TUTTO.sql), poi questa.';
  end if;
end $$;

alter table public.table_payments add column if not exists items jsonb not null default '[]'::jsonb;
