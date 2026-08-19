-- Traduzioni per i piatti nelle lingue del sito pubblico.
-- name_i18n / desc_i18n = { "fr": "...", "en": "...", "it": "..." } (solo lingue attive).
-- `name` resta il nome canonico (lingua predefinita, usato in ordini/cucina).
-- description_fr / description_en restano allineate (retro-compatibilità menu pubblico legacy).
-- Idempotente.
alter table public.menu_items add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.menu_items add column if not exists desc_i18n jsonb not null default '{}'::jsonb;
