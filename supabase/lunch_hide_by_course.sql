-- Nascondere i piatti del lunch dal menu pubblico PER SINGOLA PORTATA.
-- Estende (senza sostituire) il vecchio flag globale hide_items:
--   { "entree": true, "plat": false, "dessert": true }
-- Se la colonna manca, il codice ricade automaticamente su hide_items
-- (degrada senza errori). I menù FISSI (set_menus) non hanno bisogno di
-- migrazione: il flag "hide" per portata viaggia dentro il JSON `courses`.
alter table lunch_menus add column if not exists hide_by_course jsonb;
