-- ============================================================
-- #98 — IL TIPO DELLE SOTTO-SEZIONI SEGUE LA MADRE (11/11/2026)
--
-- «+ sotto» nell'editor delle sezioni creava la sotto-sezione col tipo di
-- default (food) anche sotto una sezione bevande: «Vin Maison» sotto «Vins»
-- finiva tra i piatti. Il modale del piatto filtrava le sezioni per tipo,
-- quindi la lista si mescolava e una parte delle sezioni non compariva.
-- Il codice ora tiene il tipo della radice su tutto il ramo (creazione,
-- spostamento, cambio di tipo); questo file ripara le righe gia' scritte.
-- Senza, tutto come prima: il codice legge comunque il tipo della radice.
-- Idempotente.
-- ============================================================
with recursive albero as (
  select id, kind as kind_radice
    from public.menu_categories
   where parent_id is null
  union all
  select c.id, a.kind_radice
    from public.menu_categories c
    join albero a on c.parent_id = a.id
)
update public.menu_categories m
   set kind = a.kind_radice
  from albero a
 where m.id = a.id
   and m.kind is distinct from a.kind_radice;
