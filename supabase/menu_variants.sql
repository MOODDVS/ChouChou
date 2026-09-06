-- ============================================================
-- MENU_ITEMS.variants — formati/varianti di un piatto
--
-- Un piatto può essere venduto in più formati mutuamente esclusivi
-- (pizza 30/40 cm, vino calice/bottiglia, porzione piccola/grande).
-- Il cliente ne sceglie UNO. Ogni formato ha il PROPRIO prezzo.
--
-- Forma del jsonb (array, ordine = ordine di visualizzazione):
--   [
--     { "key": "30",
--       "label_i18n": { "fr": "30 cm", "en": "30 cm", "it": "30 cm" },
--       "price_cents": 1200,
--       "orderable": true,
--       "sold_out": false },
--     { "key": "40", "label_i18n": { "fr": "40 cm" }, "price_cents": 1600,
--       "orderable": true, "sold_out": false }
--   ]
--
-- Regole:
--  - variants = []  -> comportamento invariato: il piatto ha un prezzo unico
--                      (price_cents). Nessun cliente esistente cambia.
--  - variants ≠ []  -> price_cents diventa il prezzo "a partire da" e il
--                      prezzo incassato è SEMPRE quello della variante scelta,
--                      risolto lato server (il browser manda solo la chiave).
--  - "orderable": false -> il formato si vede nel menu vetrina ma non è
--                      ordinabile online (come orderable sul piatto).
--  - "sold_out": true  -> finito adesso: resta in carta col badge «Épuisé»,
--                      il bottone è disattivato e il checkout lo rifiuta.
--                      Stesso significato di menu_items.sold_out (#55).
--  - "key" è stabile e unica dentro il piatto: è ciò che viaggia negli ordini.
--
-- Idempotente.
-- ============================================================

alter table public.menu_items
  add column if not exists variants jsonb not null default '[]'::jsonb;

-- Deve essere un array (mai un oggetto o uno scalare).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_variants_array'
  ) then
    alter table public.menu_items
      add constraint menu_items_variants_array
      check (jsonb_typeof(variants) = 'array');
  end if;
end $$;
