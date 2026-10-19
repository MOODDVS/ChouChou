-- ============================================================
-- #88 — I PAGAMENTI DEL CONTO APERTO (fase 4, conto-aperto.md)
--
-- Si paga l'addizione dal telefono: «Ce que j'ai commandé», «Une part
-- égale», «Tout le reste». ⚠️ Le parti uguali e il resto NON corrispondono a
-- ordini precisi: un pagamento non e' un ordine, ed e' una riga sua.
--
--   table_payments   un pagamento sul conto (la prenotazione «seated»)
--     kind           'mine' (i propri ordini) | 'share' (una parte uguale) |
--                    'rest' (tutto il resto) | 'staff' (incassato dal
--                    personale, contanti o carta, alla chiusura)
--     method         'online' | 'cash' | 'card'
--     status         'pending' (pagamento online in corso: l'importo e'
--                    PRENOTATO fino a `hold_until`) | 'paid' | 'cancelled'
--     amount_cents   quanto copre del conto, mancia ESCLUSA
--     tip_cents      la mancia, a parte: non paga piatti
--     order_ids      per 'mine': gli ordini che copre (cosi' «ce que j'ai
--                    commandé» non si paga due volte)
--     token          lo conosce solo il telefono che paga: serve ad annullare
--                    tornando indietro da Stripe
--     hold_until     = la scadenza della sessione Stripe. Dopo, la sessione
--                    non si puo' piu' pagare, e l'importo torna libero.
--
-- ⚠️ DUE PERSONE CHE PAGANO NELLO STESSO ISTANTE: la parte che una sta
-- pagando e' prenotata, e l'altra paga solo cio' che resta. Chi decide e'
-- `reservations.tab_pay_lock`, un contatore che ogni prenotazione fa
-- avanzare SOLO se nessuno l'ha mosso nel frattempo (`… where tab_pay_lock
-- = v`). Chi perde annulla la sua riga e ricalcola.
--
--   reservations.tab_pay_lock    il contatore qui sopra
--   reservations.tab_receipt_at  la ricevuta unica e' partita (una volta sola)
--
-- ⚠️ IL GRANT AL service_role E' OBBLIGATORIO (vedi #83).
-- Idempotente: rilanciarla e' sicuro.
-- ============================================================

create table if not exists public.table_payments (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid null references public.locations(id) on delete restrict,
  reservation_id    uuid not null references public.reservations(id) on delete cascade,
  kind              text not null check (kind in ('mine', 'share', 'rest', 'staff')),
  method            text not null check (method in ('online', 'cash', 'card')),
  status            text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  amount_cents      integer not null check (amount_cents > 0),
  tip_cents         integer not null default 0 check (tip_cents >= 0),
  payer_name        text,
  payer_email       text,
  order_ids         uuid[] not null default '{}',
  stripe_session_id text,
  token             uuid not null default gen_random_uuid(),
  hold_until        timestamptz,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

create index if not exists table_payments_conto on public.table_payments (reservation_id);
create unique index if not exists table_payments_sessione
  on public.table_payments (stripe_session_id) where stripe_session_id is not null;
create unique index if not exists table_payments_token on public.table_payments (token);

grant select, insert, update, delete on public.table_payments to service_role;

alter table public.reservations
  add column if not exists tab_pay_lock   integer not null default 0,
  add column if not exists tab_receipt_at timestamptz;
