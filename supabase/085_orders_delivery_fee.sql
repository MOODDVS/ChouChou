-- ============================================================
-- #85 — IL COSTO DELLA CONSEGNA, scritto sull'ordine.
--
--   delivery_fee_cents  integer  quanto e' costata la consegna (0 = gratis,
--                                o non e' una consegna)
--
-- ⚠️ UNA COLONNA E NON UNA RIGA FINTA IN `items`. Una riga «Livraison» fra i
-- piatti finirebbe sul ticket della cucina, nei conteggi dei piatti venduti e
-- — soprattutto — sparirebbe alla prima modifica dell'ordine dal pannello,
-- che ricostruisce `items` dai piatti scelti: il totale scenderebbe del costo
-- di consegna e il pannello proporrebbe di RIMBORSARLO.
--
-- ⚠️ `total_cents` RESTA IL TOTALE INCASSATO, consegna compresa: e' la cifra
-- che Stripe ha preso o che la cassa deve chiedere. Questa colonna dice quanta
-- parte di quel totale non e' cucina.
--
-- ⚠️ Il costo si salva com'era AL MOMENTO DELL'ORDINE: il ristoratore che
-- domani lo alza non deve cambiare il conto di ieri.
-- Default 0 e `not null`: tutte le righe gia' scritte non avevano consegna.
-- ============================================================
alter table public.orders add column if not exists delivery_fee_cents integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_delivery_fee_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_fee_check check (delivery_fee_cents >= 0);
  end if;
end $$;
