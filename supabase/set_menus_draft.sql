-- Stato bozza per i menù fissi: consente di salvare e continuare più tardi
-- un menù incompleto (non pubblicato). is_draft=true => bozza.
alter table set_menus add column if not exists is_draft boolean default false;
