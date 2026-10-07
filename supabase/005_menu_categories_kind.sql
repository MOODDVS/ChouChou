-- ============================================================
-- #5 — Aggiunge alle sezioni il tipo: 'food' (cibo) o 'drink' (bevanda).
-- Seed: marca come 'drink' le sezioni bevande già esistenti.
-- Idempotente.
-- ============================================================
alter table public.menu_categories
  add column if not exists kind text not null default 'food'
  check (kind in ('food','drink'));

-- ⚠️ IL SEED GIRA UNA VOLTA SOLA, e qui c'e' scritto come se ne accorge.
-- Senza l'ultima condizione questo UPDATE e' ripetibile ma NON innocuo:
-- rilanciando il file su un cliente vivo rimetterebbe 'drink' a una sezione
-- che il ristoratore aveva spostato a 'food', e nessuno andrebbe a
-- ricontrollare le sezioni dopo una migrazione. `not exists` dice «qui non
-- ha ancora deciso nessuno»: la prima volta nessuna sezione e' 'drink' e il
-- seed passa, dalla seconda in poi non tocca piu' niente.
update public.menu_categories set kind = 'drink'
where name in (
  'Boissons chaudes','Softs','Apéritifs','Long drinks','Alcools',
  'Bières pression','Bières bouteilles','Vins du patron',
  'Vins rouges','Vins blancs','Vin rosé'
)
and not exists (select 1 from public.menu_categories where kind = 'drink');
