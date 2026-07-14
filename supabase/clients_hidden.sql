-- ============================================================
-- Colonna `hidden` sulla tabella clients.
-- Un cliente "cancellato" dall'admin che ha degli ordini non viene
-- eliminato davvero (gli ordini restano in contabilità): viene
-- nascosto dalla lista con hidden = true. Se rifà un ordine,
-- il webhook lo riattiva (hidden = false).
-- Idempotente.
-- ============================================================
alter table public.clients
  add column if not exists hidden boolean not null default false;
