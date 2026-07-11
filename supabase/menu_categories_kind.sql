-- ============================================================
-- Aggiunge alle sezioni il tipo: 'food' (cibo) o 'drink' (bevanda).
-- Seed: marca come 'drink' le sezioni bevande già esistenti.
-- Idempotente.
-- ============================================================
alter table public.menu_categories
  add column if not exists kind text not null default 'food'
  check (kind in ('food','drink'));

update public.menu_categories set kind = 'drink'
where name in (
  'Boissons chaudes','Softs','Apéritifs','Long drinks','Alcools',
  'Bières pression','Bières bouteilles','Vins du patron',
  'Vins rouges','Vins blancs','Vin rosé'
);
