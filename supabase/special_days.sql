-- ============================================================
-- SPECIAL_DAYS — giorni speciali che scavalcano gli orari settimanali:
--   type='closed' : chiuso in quelle date (ferie, festivi)
--   type='open'   : aperto eccezionalmente (es. un martedì specifico),
--                   con orari propri (lunch_* e opzionale dinner_*)
-- Range di date: date_from..date_to (giorno singolo = from = to).
-- RLS attiva SENZA policy => accesso solo via service key.
-- ============================================================
create table if not exists public.special_days (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('closed','open')),
  date_from   date not null,
  date_to     date not null,
  lunch_open  time,
  lunch_close time,
  dinner_open  time,
  dinner_close time,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists idx_special_days_range
  on public.special_days (date_from, date_to);

alter table public.special_days enable row level security;

grant select, insert, update, delete on public.special_days to service_role;
