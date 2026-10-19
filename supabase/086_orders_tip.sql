-- ============================================================
-- #86 — LA MANCIA, scritta sull'ordine.
--
--   tip_cents  integer  la mancia lasciata pagando online (0 = nessuna)
--
-- ⚠️ COME IL COSTO DELLA CONSEGNA (#85), UNA COLONNA E NON UNA RIGA IN
-- `items`: fra i piatti finirebbe sul ticket e nei conteggi, e sparirebbe
-- alla prima modifica dell'ordine dal pannello — che proporrebbe di
-- rimborsarla.
--
-- ⚠️ `total_cents` RESTA IL TOTALE INCASSATO, mancia compresa: e' la cifra
-- che Stripe ha preso. Questa colonna dice quanta parte di quel totale non e'
-- cucina, e le statistiche la potranno togliere dal fatturato.
-- Default 0 e `not null`: tutte le righe gia' scritte non avevano mance.
-- ============================================================
alter table public.orders add column if not exists tip_cents integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_tip_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_tip_check check (tip_cents >= 0);
  end if;
end $$;
