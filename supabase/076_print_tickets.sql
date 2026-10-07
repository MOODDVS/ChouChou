-- ============================================================
-- #76 — `print_tickets`: la coda dei ticket da stampare
--
-- ⚠️ PERCHE' UNA CODA E NON UNA CHIAMATA DIRETTA. Il ticket esce da una
-- stampante che sta in cucina, dall'altra parte di internet. Quando l'ordine
-- viene pagato quella stampante puo' essere spenta, senza carta, o il tablet
-- puo' essersi addormentato. Senza una riga che aspetta, quel ticket e' perso
-- e nessuno lo sa: in cucina semplicemente non arriva niente, e l'ordine si
-- scopre quando il cliente si presenta al banco.
--
-- Con la coda, la riga resta `queued` e riparte da sola appena la stampante
-- torna viva. Ed e' anche l'unico modo di distinguere «stampato» da «mai
-- uscito»: lo stato diventa `printed` solo quando il servizio di stampa lo
-- conferma, non quando noi abbiamo spedito.
--
-- ⚠️ L'INDICE UNICO E' LA PROTEZIONE DAL DOPPIO TICKET. Un ordine pagato puo'
-- essere visto piu' volte (webhook Stripe ripetuto, polling, modifica),
-- e ogni volta si proverebbe a mettere in coda lo stesso ticket. In cucina
-- due comande uguali vogliono dire due pizze. L'indice vale solo per le righe
-- `auto`: le ristampe chieste a mano sono righe nuove, e devono poter essere
-- quante se ne vogliono.
--
-- `location_id` NULL = cliente a sede unica, come in tutte le altre tabelle.
-- Idempotente: si puo' rilanciare.
-- ============================================================

create table if not exists public.print_tickets (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  location_id uuid null references public.locations(id) on delete restrict,
  -- Oggi solo la cucina. `customer` esiste perche' il giorno che serve lo
  -- scontrino cliente non si tocchi ne' la tabella ne' l'indice.
  kind        text not null default 'kitchen' check (kind in ('kitchen', 'customer')),
  origin      text not null default 'auto'    check (origin in ('auto', 'manual')),
  status      text not null default 'queued'  check (status in ('queued', 'sent', 'printed', 'failed')),
  -- Chiave della pagina pubblica del ticket: e' l'unica cosa che protegge i
  -- dati del cliente, perche' quella pagina la deve poter leggere il servizio
  -- di stampa, che non sa fare login.
  token       text not null unique,
  -- Id del lavoro restituito dal servizio di stampa: serve a ricollegare la
  -- sua conferma a questa riga.
  job_id      text,
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  printed_at  timestamptz
);

create unique index if not exists print_tickets_auto_unico
  on public.print_tickets (order_id, kind) where origin = 'auto';

create index if not exists print_tickets_da_fare
  on public.print_tickets (status, created_at) where status in ('queued', 'sent');

create index if not exists print_tickets_order on public.print_tickets (order_id);

-- ⚠️ IL GRANT, che qui mancava (06/10/2026). In questi progetti Supabase
-- «Automatically expose new tables» e' SPENTO: una tabella nuova nasce senza
-- privilegi per i ruoli dell'API, e il service_role — la chiave del server —
-- non ci puo' nemmeno scrivere. L'insert torna `42501 permission denied for
-- table print_tickets`, e `accodaTicket` lo inghiotte come inghiotte tutto
-- (la stampa non deve far fallire un ordine): la tabella c'e', la stampante
-- funziona, la prova di stampa esce, e dell'ordine vero non arriva niente.
-- Visto su 450 Gradi, in sala, con un ordine pagato davanti.
grant select, insert, update, delete on public.print_tickets to service_role;
