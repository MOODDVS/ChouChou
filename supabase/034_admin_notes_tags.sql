-- #34 — Tag sulle note admin
-- Colonna jsonb: lista di tag TESTUALI LIBERI, es. ["important","metro"].
-- I tre tag storici (important / recurrent / fournisseur) sono solo quelli che
-- l'admin propone gia' pronti e traduce; la colonna non li conosce e non ha
-- nessun vincolo. ⚠️ Percio' aggiungere un tag nuovo NON e' una migrazione:
-- chi cerca qui la tabella dei tag non la trova perche' non esiste, ed e'
-- voluto — una lista chiusa in SQL vorrebbe dire una migrazione per ogni
-- parola che a un ristoratore viene in mente.
-- Tabella gia' concessa a service_role: nessun GRANT necessario.
alter table public.admin_notes add column if not exists tags jsonb;
