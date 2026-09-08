-- ============================================================
-- #72 — ADMIN_DOCS_META.lang : lingua della lettera di disdetta
--
-- La richiesta formale di résiliation di un contratto parte dall'admin e
-- arriva al FORNITORE, non al ristoratore. Quindi non segue `admin_lang`:
-- segue la lingua del destinatario, che si sceglie sul documento stesso
-- (Réglages -> Documents -> contratto -> "Lingua della lettera").
--
-- NULL / colonna assente = comportamento storico: la lettera parte nella
-- lingua dell'admin. Nessun documento esistente cambia.
--
-- Idempotente.
-- ============================================================

alter table public.admin_docs_meta
  add column if not exists lang text;
