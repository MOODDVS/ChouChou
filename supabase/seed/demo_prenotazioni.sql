-- ============================================================
-- DEMO — prenotazioni finte per far vedere il pannello pieno.
--
-- ⚠️ NON E' UNA MIGRAZIONE. Sta in `supabase/seed/` apposta: non e' elencata
-- in MIGRATIONS.md, non finisce in TUTTO.sql, e non va lanciata su un cliente
-- vero. Serve a una demo.
--
-- ⚠️ Le date sono RELATIVE a `current_date`: lanciandolo fra tre settimane la
-- demo e' comunque di oggi e domani. Date fisse sarebbero una demo che invecchia
-- e un pannello pieno di prenotazioni passate.
--
-- Rispetta gli orari configurati:
--   Lunch   12:00 - 14:00, slot 30 min, tutti i giorni
--   Dinner  17:00 - 22:30, slot 15 min, LUNEDI' CHIUSO
-- e il piano di sala: tavoli da 2, unibili fino a 6 → gruppi da 2 a 6.
-- La riga finale filtra le cene che cadrebbero di lunedi': se la si toglie,
-- la demo mostra prenotazioni in un servizio che non esiste, ed e' la prima
-- cosa che un ristoratore nota.
--
-- ⚠️ `service_key` qui e' 'midi' / 'soir', le chiavi predefinite del motore.
-- Se questo locale ha rinominato i servizi, si cambiano quelle due parole:
-- le chiavi vere stanno in app_config, chiave `reservation_services`.
--
-- Per cancellare la demo:
--   delete from public.reservations where email like '%@demo.invalid';
-- (`.invalid` e' un dominio che per standard non esiste: nessuna email di
--  queste righe puo' partire verso una persona vera, nemmeno per sbaglio.)
-- ============================================================

insert into public.reservations
  (date, heure, service_key, people, zone, first_name, last_name, phone, email, lang,
   status, source, notes, high_chair, birthday, business)
select
  current_date + d.giorno,
  d.heure,
  case when d.heure < '17:00' then 'midi' else 'soir' end,
  d.people, d.zone, d.nome, d.cognome, d.tel, d.mail, d.lingua,
  d.stato, d.canale, d.note, d.seggiolone, d.compleanno, d.lavoro
from (values
  -- ---- OGGI ----
  (0, '12:00', 2, 'Interno',  'Claire',   'Dubois',      '0470 11 22 01', 'claire.dubois@demo.invalid',   'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (0, '12:30', 4, 'Terrazzo', 'Marc',     'Lefevre',     '0470 11 22 02', 'marc.lefevre@demo.invalid',    'fr', 'confirmed', 'phone',     'Tavolo all''ombra se possibile',       false, false, false),
  (0, '13:00', 2, 'Interno',  'Sofia',    'Rinaldi',     '0470 11 22 03', 'sofia.rinaldi@demo.invalid',   'it', 'confirmed', 'web',       null,                                   false, false, false),
  (0, '13:30', 6, 'Terrazzo', 'Anne',     'Peeters',     '0470 11 22 04', 'anne.peeters@demo.invalid',    'nl', 'confirmed', 'instagram', 'Pranzo di lavoro, fattura',            false, false, true),
  (0, '19:00', 2, 'Interno',  'Julien',   'Moreau',      '0470 11 22 05', 'julien.moreau@demo.invalid',   'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (0, '19:30', 4, 'Terrazzo', 'Elena',    'Conti',       '0470 11 22 06', 'elena.conti@demo.invalid',     'it', 'confirmed', 'google',    'Allergia alle noci',                   false, false, false),
  (0, '20:00', 2, 'Interno',  'Thomas',   'Janssens',    '0470 11 22 07', 'thomas.janssens@demo.invalid', 'nl', 'confirmed', 'web',       null,                                   false, false, false),
  (0, '20:15', 6, 'Terrazzo', 'Camille',  'Rousseau',    '0470 11 22 08', 'camille.rousseau@demo.invalid','fr', 'confirmed', 'web',       'Compleanno — dolce a sorpresa',        false, true,  false),
  (0, '20:30', 3, 'Interno',  'Paolo',    'Greco',       '0470 11 22 09', 'paolo.greco@demo.invalid',     'it', 'confirmed', 'phone',     'Un bambino piccolo',                   true,  false, false),
  (0, '21:00', 2, 'Interno',  'Laura',    'Simon',       '0470 11 22 10', 'laura.simon@demo.invalid',     'fr', 'cancelled', 'web',       null,                                   false, false, false),

  -- ---- DOMANI ----
  (1, '12:00', 4, 'Terrazzo', 'Nicolas',  'Vermeulen',   '0470 11 22 11', 'nicolas.v@demo.invalid',       'nl', 'confirmed', 'web',       null,                                   false, false, false),
  (1, '12:30', 2, 'Interno',  'Chiara',   'Fontana',     '0470 11 22 12', 'chiara.fontana@demo.invalid',  'it', 'confirmed', 'qr',        null,                                   false, false, false),
  (1, '13:30', 2, 'Terrazzo', 'Hugo',     'Mertens',     '0470 11 22 13', 'hugo.mertens@demo.invalid',    'nl', 'confirmed', 'web',       null,                                   false, false, false),
  (1, '19:00', 6, 'Terrazzo', 'Isabelle', 'Lambert',     '0470 11 22 14', 'isabelle.l@demo.invalid',      'fr', 'confirmed', 'phone',     'Tavolo tranquillo',                    false, false, false),
  (1, '19:45', 2, 'Interno',  'Andrea',   'Marchetti',   '0470 11 22 15', 'andrea.m@demo.invalid',        'it', 'confirmed', 'web',       null,                                   false, false, false),
  (1, '20:00', 4, 'Interno',  'Sarah',    'Declercq',    '0470 11 22 16', 'sarah.declercq@demo.invalid',  'fr', 'confirmed', 'google',    null,                                   false, false, false),
  (1, '20:30', 2, 'Terrazzo', 'Lucas',    'Fernandez',   '0470 11 22 17', 'lucas.f@demo.invalid',         'es', 'confirmed', 'web',       null,                                   false, false, false),
  (1, '21:15', 4, 'Interno',  'Emma',     'Willems',     '0470 11 22 18', 'emma.willems@demo.invalid',    'nl', 'confirmed', 'web',       null,                                   false, false, false),

  -- ---- DOPODOMANI ----
  (2, '12:30', 2, 'Interno',  'Pierre',   'Gilles',      '0470 11 22 19', 'pierre.gilles@demo.invalid',   'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (2, '19:30', 4, 'Terrazzo', 'Valentina','Bruno',       '0470 11 22 20', 'valentina.bruno@demo.invalid', 'it', 'confirmed', 'instagram', null,                                   false, false, false),
  (2, '20:00', 2, 'Interno',  'Antoine',  'Charlier',    '0470 11 22 21', 'antoine.c@demo.invalid',       'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (2, '20:45', 6, 'Terrazzo', 'Lotte',    'De Smet',     '0470 11 22 22', 'lotte.desmet@demo.invalid',    'nl', 'confirmed', 'phone',     'Sei persone, due vegetariani',         false, false, false),

  -- ---- FRA TRE E CINQUE GIORNI (il fine settimana si riempie) ----
  (3, '19:00', 4, 'Terrazzo', 'Mathieu',  'Leroy',       '0470 11 22 23', 'mathieu.leroy@demo.invalid',   'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (3, '19:30', 2, 'Interno',  'Giulia',   'Esposito',    '0470 11 22 24', 'giulia.e@demo.invalid',        'it', 'confirmed', 'web',       null,                                   false, false, false),
  (3, '20:00', 6, 'Terrazzo', 'Charlotte','Dupont',      '0470 11 22 25', 'charlotte.d@demo.invalid',     'fr', 'confirmed', 'google',    'Anniversario di matrimonio',           false, true,  false),
  (3, '20:30', 4, 'Interno',  'Bram',     'Claes',       '0470 11 22 26', 'bram.claes@demo.invalid',      'nl', 'confirmed', 'web',       null,                                   false, false, false),
  (3, '21:00', 2, 'Interno',  'Alice',    'Bernard',     '0470 11 22 27', 'alice.bernard@demo.invalid',   'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (4, '12:00', 5, 'Terrazzo', 'Famiglia', 'Russo',       '0470 11 22 28', 'famiglia.russo@demo.invalid',  'it', 'confirmed', 'phone',     'Due bambini',                          true,  false, false),
  (4, '13:00', 2, 'Interno',  'Yasmine',  'Haddad',      '0470 11 22 29', 'yasmine.h@demo.invalid',       'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (4, '19:15', 4, 'Terrazzo', 'Olivier',  'Grandjean',   '0470 11 22 30', 'olivier.g@demo.invalid',       'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (4, '20:15', 2, 'Interno',  'Marta',    'Ferrari',     '0470 11 22 31', 'marta.ferrari@demo.invalid',   'it', 'confirmed', 'instagram', null,                                   false, false, false),
  (5, '12:30', 4, 'Terrazzo', 'Vincent',  'Maes',        '0470 11 22 32', 'vincent.maes@demo.invalid',    'nl', 'confirmed', 'web',       null,                                   false, false, false),
  (5, '13:30', 2, 'Interno',  'Nadia',    'Benali',      '0470 11 22 33', 'nadia.benali@demo.invalid',    'fr', 'confirmed', 'web',       null,                                   false, false, false),
  (6, '12:00', 6, 'Terrazzo', 'Groupe',   'Van Dam',     '0470 11 22 34', 'groupe.vandam@demo.invalid',   'nl', 'confirmed', 'phone',     'Pranzo di famiglia, sei persone',      false, false, false),
  (6, '13:00', 3, 'Interno',  'Stefano',  'Barbieri',    '0470 11 22 35', 'stefano.b@demo.invalid',       'it', 'confirmed', 'web',       null,                                   false, false, false)
) as d(giorno, heure, people, zone, nome, cognome, tel, mail, lingua, stato, canale, note, seggiolone, compleanno, lavoro)
-- ⚠️ Niente cene di lunedi': il servizio della sera non apre, e una
-- prenotazione in un servizio chiuso e' la prima cosa che si nota.
where not (extract(isodow from current_date + d.giorno) = 1 and d.heure >= '17:00');
