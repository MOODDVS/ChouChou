-- #32 · Blocco prenotazioni per cliente
-- blocked = true → il WIDGET pubblico rifiuta le prenotazioni con la sua
-- email o il suo telefono. Gli ordini dal sito restano permessi (paga subito).

alter table public.clients
  add column if not exists blocked boolean not null default false;
