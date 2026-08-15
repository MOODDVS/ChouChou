-- #49 · Ordini manuali pagati di persona + lingue email estese
--
-- Due modifiche a orders, entrambe idempotenti:
--
-- 1) LINGUE. Toglie il vecchio check che limitava orders.lang a ('fr','en').
--    Ora le email d'ordine esistono in fr/en/it/nl/es (lingue pubbliche), come
--    già fa reservations.lang (che non ha alcun check). Senza questa modifica
--    un ordine con lang it/nl/es verrebbe RIFIUTATO dal database.
--
-- 2) PAGAMENTO. Aggiunge payment_method: come è stato pagato l'ordine.
--      'link' = link di pagamento Stripe inviato via email (flusso storico)
--      'cash' = contanti, pagato in cassa (ordine creato già 'paid')
--      'card' = carta, pagato in cassa (ordine creato già 'paid')
--      null   = ordini online/storici senza metodo registrato
--
-- Idempotente: si può rilanciare senza danni.

-- 1) Lingue: via il check fr/en (il nome del constraint è quello auto-generato
--    da Postgres per un check inline sulla colonna). "if exists" = nessun errore
--    se è già stato tolto.
alter table public.orders drop constraint if exists orders_lang_check;

-- 2) Metodo di pagamento.
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('cash', 'card', 'link'));
