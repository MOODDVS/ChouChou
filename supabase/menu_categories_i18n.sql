-- Traduzioni del nome delle sezioni/categorie per lingua del sito pubblico.
-- Per le categorie STANDARD viene riempito dal dizionario (fisso); per quelle
-- personalizzate lo inserisce il ristoratore.
alter table public.menu_categories add column if not exists name_i18n jsonb;
