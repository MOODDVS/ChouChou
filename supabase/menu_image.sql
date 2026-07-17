-- ============================================================
-- Foto degli articoli del menu (admin → Menu).
-- Colonna opzionale `image_url` su menu_items: se NULL, l'admin
-- mostra un placeholder. Include il bucket Storage `menu` per le
-- foto caricate dall'admin (lettura pubblica, scrittura solo via
-- API admin con service key). Idempotente.
-- ============================================================
alter table public.menu_items add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('menu', 'menu', true)
on conflict (id) do nothing;
