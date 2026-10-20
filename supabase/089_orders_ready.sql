-- ============================================================
-- #89 — «PRÊT» SU UN ORDINE ANCORA DA INCASSARE
--
-- Il fast-food: si ordina, la cucina prepara, il cliente viene CHIAMATO
-- («c'est prêt») e paga al banco. L'avviso parte prima dell'incasso, quindi
-- l'ordine resta `pending` + `onsite` (non e' pagato) ma deve ricordarsi di
-- essere pronto: per non rimandare l'email, e perche' all'incasso si chiuda
-- subito (`done`) invece di tornare «in corso».
--
--   orders.ready_at   quando e' stato segnato pronto (e il cliente avvisato)
--
-- Senza, «Prêt» su un ordine da incassare non si puo' segnare: il pannello
-- lo dice. Il resto (pagati, «Terminée») funziona come prima.
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

alter table public.orders add column if not exists ready_at timestamptz;
