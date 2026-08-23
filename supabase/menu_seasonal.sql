-- Badge "stagionale" per piatti e bevande. Idempotente.
alter table public.menu_items add column if not exists is_seasonal boolean not null default false;
