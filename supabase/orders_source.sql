-- #29 · Origine dell'ordine
-- 'web' = checkout dal sito (default) · 'manual' = creato dallo staff
-- nella pagina Commandes (link di pagamento inviato via email).

alter table public.orders
  add column if not exists source text not null default 'web';
