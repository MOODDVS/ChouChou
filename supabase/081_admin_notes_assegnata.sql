-- ============================================================
-- #81 — `assigned_to` / `assigned_name` sulle note admin.
--
--   assigned_to    uuid  la persona in `team` (NULL = nessuno)
--   assigned_name  text  il suo nome AL MOMENTO dell'assegnazione
--
-- ⚠️ DUE COLONNE PER UNA COSA SOLA, ed e' voluto. L'id serve a sapere a chi
-- riscrivere quando la nota ricorrente torna; il nome serve a leggere la nota
-- fra sei mesi, quando quella persona magari non lavora piu' qui e la sua
-- riga in `team` non c'e' piu'. Con il solo id, una nota di marzo diventa
-- «assegnata a (nessuno)»; con il solo nome, non si sa piu' a chi scrivere.
--
-- ⚠️ `assigned_to` NON ha una foreign key verso `team`. Cancellando una
-- persona dalla rubrica, un vincolo obbligherebbe a scegliere fra rifiutare
-- la cancellazione e cancellare anche le note: due comportamenti sbagliati
-- per lo stesso fatto. Senza vincolo l'id resta e non trova nessuno —
-- l'assegnazione diventa storia, che e' cio' che e'. Il nome, salvato
-- accanto, continua a dire di chi si trattava.
--
-- ⚠️ Non tutta la rubrica si puo' assegnare: `team` contiene anche
-- fornitori, tecnici e consulenti. La regola di chi e' assegnabile sta in
-- `src/lib/admin/teamRegole.ts`, in UN posto, e la applicano sia l'elenco che
-- si vede sia l'email che parte. Un vincolo qui direbbe la stessa cosa in un
-- secondo posto, e il giorno in cui si aggiunge una categoria sarebbe una
-- migrazione.
-- ============================================================
alter table public.admin_notes add column if not exists assigned_to uuid;
alter table public.admin_notes add column if not exists assigned_name text;

-- «Che cosa tocca a Marco»: la domanda che questa colonna rende possibile.
create index if not exists idx_admin_notes_assigned
  on public.admin_notes (assigned_to) where done = false;
