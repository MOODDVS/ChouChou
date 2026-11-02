-- ============================================================
-- #92 — I TAVOLI: PENTAGONO E ROTAZIONE (Réglages → piano della sala)
--
-- Enzo, 2/11/2026: un bottone solo «+ Tavolo» (rotondo o quadrato si
-- sceglie nel tavolo), una forma nuova a PENTAGONO e i tavoli si girano a
-- passi di 15 gradi.
--
--   restaurant_tables.shape     accetta anche 'pentagon'
--   restaurant_tables.rotation  smallint, 0–345 a passi di 15 (gradi, in
--                               senso orario attorno al centro del tavolo)
--
-- Senza questa migrazione il piano funziona come prima: il pentagono e il
-- bottone per girare non compaiono. Idempotente: rilanciarla e' sicuro.
-- ============================================================

-- La forma: si tolgono i vecchi controlli su `shape` (il nome lo sceglie
-- Postgres, quindi si cercano) e se ne mette uno col pentagono.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.restaurant_tables'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%shape%'
  loop
    execute format('alter table public.restaurant_tables drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.restaurant_tables
  add constraint restaurant_tables_shape_check
  check (shape in ('round', 'square', 'rect', 'pentagon'));

-- La rotazione.
alter table public.restaurant_tables
  add column if not exists rotation smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurant_tables'::regclass and conname = 'restaurant_tables_rotation_check'
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_rotation_check
      check (rotation >= 0 and rotation < 360 and rotation % 15 = 0);
  end if;
end $$;
