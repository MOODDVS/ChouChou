-- ============================================================
-- Badge dei piatti:
--   is_bestseller : piatto in evidenza / più venduto
--   is_vegan      : piatto vegano
--   is_spicy      : piatto piccante
-- Booleani, default false. Idempotente.
-- I privilegi di tabella (service_role / anon) coprono già le
-- nuove colonne: nessun GRANT aggiuntivo necessario.
-- ============================================================
alter table public.menu_items
  add column if not exists is_bestseller boolean not null default false,
  add column if not exists is_vegan boolean not null default false,
  add column if not exists is_spicy boolean not null default false;
