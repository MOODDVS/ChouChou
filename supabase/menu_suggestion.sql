-- ============================================================
-- Badge "Suggestion" (suggestion du chef) sui piatti.
-- Colonna nuova su tabella già concessa: NIENTE nuovi GRANT.
-- Idempotente.
-- ============================================================
alter table public.menu_items
  add column if not exists is_suggestion boolean not null default false;
