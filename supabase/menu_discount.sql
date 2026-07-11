-- ============================================================
-- Sconti sui piatti:
--   discount_type  : null (nessuno) | 'fixed' (riduzione fissa in
--                    centesimi) | 'percent' (percentuale intera)
--   discount_value : centesimi se fixed, 1-99 se percent
--   discount_scope : 'all' (ovunque) | 'online' (solo ordini online)
-- Idempotente.
-- ============================================================
alter table public.menu_items
  add column if not exists discount_type text check (discount_type in ('fixed','percent')),
  add column if not exists discount_value integer not null default 0,
  add column if not exists discount_scope text not null default 'all' check (discount_scope in ('all','online'));
