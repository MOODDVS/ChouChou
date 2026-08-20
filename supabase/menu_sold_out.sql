-- Stato "esaurito" di un piatto (temporaneamente non disponibile).
-- Distinto da `available` (visibile sul sito) e `orderable` (ordinabile):
-- un piatto esaurito resta in carta ma è segnalato come non disponibile.
-- Idempotente.
alter table public.menu_items add column if not exists sold_out boolean not null default false;
