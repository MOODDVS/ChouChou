-- ============================================================
-- #80 — Scadenza e ricorrenza sulle note admin.
--
--   due_at  timestamptz  quando va fatta (NULL = nessuna scadenza)
--   repeat  jsonb        la regola, o NULL per una nota che si fa una volta
--
-- FORMA DI `repeat` — una sola, descritta qui e provata in
-- `tests/ricorrenza.test.mjs`:
--   { "ogni": "giorno",   "ora": "09:00" }
--   { "ogni": "settimana","ora": "09:00", "dow": 1 }   -- 1 = lunedi', 7 = domenica
--   { "ogni": "mese",     "ora": "09:00", "dom": 15 }  -- 1..31
--   { "ogni": "anno",     "ora": "09:00", "mese": 9, "dom": 1 }
--
-- ⚠️ `jsonb` e non cinque colonne: quattro regole su cinque lascerebbero
-- sempre tre colonne vuote, e la quinta regola che qualcuno vorra' domani
-- sarebbe una migrazione. Nessun vincolo in SQL — la forma la fa rispettare
-- l'API, che e' l'unica a scriverla; un `check` qui vorrebbe dire una
-- migrazione per ogni regola nuova, cioe' il problema di prima con piu'
-- passaggi.
--
-- ⚠️ `timestamptz` per la scadenza, non `date`: «tutti i giorni alle 9»
-- esiste, e un'ora senza fuso in un pannello che gira su tre sedi e' un'ora
-- che cambia da sola.
-- ============================================================
alter table public.admin_notes add column if not exists due_at timestamptz;
alter table public.admin_notes add column if not exists repeat jsonb;

-- Le note da fare si leggono per scadenza: chi scade prima, prima.
create index if not exists idx_admin_notes_due
  on public.admin_notes (due_at) where done = false;
