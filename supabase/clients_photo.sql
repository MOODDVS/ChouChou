-- #31 · Foto del cliente (modale di modifica nella pagina Clients)

alter table public.clients
  add column if not exists photo_url text;
