-- #74 — Altri canali di provenienza: instagram e qr
--
-- La #21 aveva creato `source` con quattro valori. Il link della scheda
-- Google Business (?ref=google) ne ha aperti altri: la bio di Instagram e il
-- QR sui tavoli e sui volantini.
--
-- ⚠️ Il `check` va RIFATTO, non allargato: PostgreSQL non sa modificare un
-- vincolo esistente. Si toglie e si rimette. Finche' non si lancia questo
-- file, `?ref=instagram` farebbe fallire l'inserimento — cioe' una
-- prenotazione persa, non una statistica sbagliata: per questo il codice
-- ripiega su 'web' e c'e' una prova che confronta i due elenchi.
--
-- `qr` resta un valore a se' anche se nell'admin porta l'icona del sito:
-- il QR sui tavoli e il sito sono la stessa esperienza per chi guarda la
-- lista, ma sono due canali diversi per chi decide dove spendere.
--
-- Idempotente: si puo' rilanciare.

do $$
begin
  if to_regclass('public.reservations') is null then
    raise notice 'reservations non esiste: niente da fare';
    return;
  end if;

  alter table public.reservations drop constraint if exists reservations_source_check;

  alter table public.reservations
    add constraint reservations_source_check
    check (source in ('web', 'walkin', 'phone', 'google', 'instagram', 'qr'));

  raise notice 'source: ammessi web, walkin, phone, google, instagram, qr';
end $$;
