-- ============================================================
-- Bucket Storage `documents` (admin → Assets → Documents) :
-- PDF caricati dall'admin (menu stampabili, volantini, listini…).
-- Lettura pubblica, scrittura solo via API admin. Idempotente.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;
