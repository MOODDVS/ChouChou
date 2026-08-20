-- Sotto-categorie del menu (fino a 3 livelli sotto la categoria radice).
-- Gerarchia su menu_categories: parent_id (null = radice) + depth (0..3).
-- I piatti restano collegati alla sezione per NOME (menu_items.category),
-- quindi i nomi delle sezioni restano UNICI (constraint esistente invariata).
-- Idempotente.
alter table public.menu_categories
  add column if not exists parent_id uuid references public.menu_categories(id) on delete restrict;
alter table public.menu_categories
  add column if not exists depth integer not null default 0;
create index if not exists idx_menu_categories_parent on public.menu_categories(parent_id);
