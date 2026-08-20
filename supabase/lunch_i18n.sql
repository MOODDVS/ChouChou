-- Traduzioni del nome del lunch (formule del mezzogiorno) per lingua del sito pubblico.
-- Chiavi = codici lingua (fr,en,it,nl,es); valori = nome tradotto.
alter table lunch_menus add column if not exists name_i18n jsonb;
