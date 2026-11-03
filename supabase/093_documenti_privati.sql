-- ============================================================
-- #93 — I DOCUMENTI DELL'ADMIN IN UN BUCKET PRIVATO (audit 3/11/2026)
--
-- Contratti, fatture, ricevute (Réglages → Documents) stavano nel bucket
-- `documents`, PUBBLICO perche' serve anche i PDF del sito (Assets →
-- Documents). Un link a un contratto restava aperto per sempre.
--
--   storage bucket `admin_docs`  privato: si legge solo con un link firmato
--                                che scade dopo un'ora (lib/admin/bucketDocs.ts)
--
-- I file gia' caricati si spostano da soli alla prima apertura di Réglages →
-- Documents (stessi percorsi: i metadati non cambiano). Il bucket `documents`
-- resta pubblico per i PDF del sito.
--
-- Senza questa migrazione tutto funziona come prima. Idempotente.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('admin_docs', 'admin_docs', false)
on conflict (id) do update set public = false;
