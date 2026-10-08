-- #30 · Token di annullamento dell'ordine (link "Annuler ma commande")
-- Usato nell'email col link di pagamento (ordini manuali): il cliente può
-- annullare finché l'ordine è 'pending' (non pagato).

alter table public.orders
  add column if not exists cancel_token uuid not null default gen_random_uuid();
