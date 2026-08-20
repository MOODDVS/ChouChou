-- La tabella set_menus è stata creata senza GRANT: senza questo, ogni query
-- del service_role dà "permission denied for table set_menus" (SQLSTATE 42501),
-- perché nel progetto "Automatically expose new tables" è OFF.
alter table public.set_menus enable row level security;
grant select, insert, update, delete on public.set_menus to service_role;
