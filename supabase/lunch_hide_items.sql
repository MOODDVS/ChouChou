-- Switch per nascondere dal menu pubblico i piatti inseriti in un lunch/formula.
-- Quando true e il lunch è attivo (e nel range di date), i suoi piatti non
-- compaiono più nella lista del menu pubblico.
alter table lunch_menus add column if not exists hide_items boolean default false;
