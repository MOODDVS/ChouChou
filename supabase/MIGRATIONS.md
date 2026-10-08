# Migrazioni Supabase — ordine di esecuzione

Tutte idempotenti (`create table if not exists`, `add column if not exists`,
`on conflict do nothing`): rilanciarle non fa danni. SQL Editor di Supabase.

⚠️ **«Idempotente» deve valere anche per i dati, non solo per lo schema.** Una
CREATE che non fa niente la seconda volta e' facile; un UPDATE di seed che
rigira riscrive scelte che il ristoratore ha fatto mesi dopo, e nessuno va a
ricontrollare le sezioni del menu dopo aver lanciato uno script. Il 05/10/2026
`005_menu_categories_kind.sql` rimetteva «bevanda» a una sezione spostata a
«cibo». Da allora **ogni UPDATE di una migrazione dice come si accorge di
essere il secondo giro** — `where <colonna> is null`, `not exists (...)` o
`is distinct from` — e `tests/migrazioni.test.mjs` lo pretende.

## Il nome del file porta il numero: `078_admin_notes_done_at.sql`

Il numero di una migrazione viveva solo in questa tabella, cioè **fuori dal
file**. Finché le due cose non si toccano sembra a posto; il guaio è il momento
in cui qualcuno dice «lancia la #78» e chi deve lanciarla ha davanti una
cartella di nomi senza numeri: si apre questo file, si cerca, e nel frattempo
si sbaglia riga — e una migrazione lanciata al posto di un'altra non si disfa.

Tre cifre e non una: `78_` e `9_` messi in fila da un `ls` danno 1, 10, 11, 2…
cioè l'ordine sbagliato proprio nel momento in cui lo si guarda per sapere
l'ordine.

Il numero è scritto **anche in testa al file** (`-- #78 — …`): il nome resta
nella cartella, la prima riga viaggia col testo quando lo si incolla
nell'editor SQL di Supabase, dove il nome del file non esiste più.
`tests/migrazioni.test.mjs` pretende tutti e due, e che dicano lo stesso
numero di questa tabella.

## Cliente nuovo, o dubbio su cosa è stato lanciato → `TUTTO.sql`

`supabase/TUTTO.sql` è **tutte le migrazioni in un file solo**, nell'ordine di
questa tabella: si incolla nell'SQL Editor e si esegue. Vale sia per un
Supabase appena creato, sia per «non ricordo se avevo lanciato la #57» —
essendo idempotenti, quelle già applicate non fanno niente.

⚠️ **È generato, non si modifica a mano.** Quando aggiungi una migrazione:
crea il `.sql`, aggiungi la riga qui sotto, poi `node scripts/genera-tutto.mjs`.
`tests/migrazioni.test.mjs` lo ricalcola e lo confronta, quindi se te ne
dimentichi il test diventa rosso — prima che un cliente nuovo si prenda uno
schema a metà, che è un guasto che si manifesta settimane dopo.
NB: se l'insert su `storage.buckets` è bloccato dal SQL Editor, crea i bucket
dalla dashboard (Storage → New bucket, **Public** ON): `popups`, `menu`, `documents`.

| # | File | Cosa crea |
|---|---|---|
| 1 | `001_schema.sql` | Base: `menu_items`, `settings`, `orders` + GRANT |
| 2 | `002_app_config.sql` | Store chiave/valore `app_config` (orari cucina, link, Général, réservations…) |
| 3 | `003_special_days.sql` | Giorni speciali (chiusure/aperture eccezionali) |
| 4 | `004_menu_categories.sql` | Sezioni del menu |
| 5 | `005_menu_categories_kind.sql` | Tipo sezione: food / drink |
| 6 | `006_menu_discount.sql` | Sconti per piatto (`discount_*`) |
| 7 | `007_menu_flags.sql` | Badge: bestseller / vegan / spicy |
| 8 | `008_menu_suggestion.sql` | Badge Suggestion |
| 9 | `009_menu_image.sql` | Foto piatti (`image_url`) + bucket `menu` |
| 10 | `010_admin_notes.sql` | Note della dashboard admin |
| 11 | `011_order_status_done.sql` | Stato ordine `done` |
| 12 | `012_clients.sql` | Rubrica clienti |
| 13 | `013_clients_hidden.sql` | Flag `hidden` sui clienti |
| 14 | `014_coupons.sql` | Codici promo + colonne coupon su `orders` |
| 15 | `015_popups.sql` | Pop-up marketing (bilingue) + bucket `popups` |
| 16 | `016_newsletter.sql` | Storico invii + disiscritti |
| 17 | `017_newsletter_credits.sql` | Crediti newsletter acquistati (Stripe MOODD) |
| 18 | `018_team.sql` | Rubrica Team (contatti, foto, predisposizione accessi) |
| 19 | `019_documents.sql` | Bucket `documents` (PDF, admin → Assets) |
| 20 | `020_reservations.sql` | Prenotazioni V1 (widget proprio, conferma automatica, cancel_token) |
| 21 | `021_reservations_source.sql` | Colonna `source` (web / walkin / phone / google) |
| 22 | `022_service_closures.sql` | Chiusure di servizio per giorno (Complet / Fermeture exceptionnelle) |
| 23 | `023_zone_closures.sql` | Chiusure di section per giorno (Terrasse fermée, ecc.) |
| 24 | `024_reservations_review.sql` | Email di recensione: id Resend per poterla annullare |
| 25 | `025_reservations_options.sql` | Opzioni `birthday` + `special_event` (Anniversaire / Événement spécial) |
| 26 | `026_reservations_seated.sql` | `seated_at`: arrivo reale al tavolo (timer En cours) |
| 27 | `027_reservations_table_time.sql` | `table_minutes`: durata reale del tavolo (Fini manuale = tempo reale; auto-Fini = durée+15; no-show = azzerata) |
| 28 | `028_reservations_spent.sql` | `spent_cents`: addition inserita dallo staff a fine tavolo (modale dettagli) |
| 29 | `029_orders_source.sql` | `source` su orders: 'web' (sito) / 'manual' (ordine creato dallo staff con link di pagamento) |
| 30 | `030_orders_cancel_token.sql` | `cancel_token` su orders: link « Annuler ma commande » nell'email di pagamento |
| 31 | `031_clients_photo.sql` | `photo_url` su clients: foto del cliente (modale di modifica) |
| 32 | `032_clients_block.sql` | `blocked` su clients: blocco delle prenotazioni dal widget (ordini sempre permessi) |
| 33 | `033_special_days_services.sql` | `services` su special_days: switch dei servizi attivi nei giorni speciali "ouvert" |
| 34 | `034_admin_notes_tags.sql` | `tags` su admin_notes: etichette Important / Récurrent / Fournisseur sulle note |
| 35 | `035_brand_bucket.sql` | Bucket Storage `brand`: loghi (normale/negativo/1 colore) + favicon da Réglages → Général |
| 36 | `036_restaurant_tables.sql` | Plan de salle: tavoli per section (nome, posti, forma, posizione) disegnati nei Réglages |
| 37 | `037_reservations_tables.sql` | `tables` su reservations: tavoli assegnati automaticamente (plan de salle fase 2) |
| 38 | `038_lunch_menus.sql` | Formules Lunch: portate, intervallo date, piatti dal menu, combinazioni con prezzo |
| 39 | `039_newsletter_schedule.sql` | Newsletter programmate/ricorrenti: contenuto, segmento, una-tantum o weekly/monthly |
| 40 | `040_admin_docs_meta.sql` | Metadati documents admin: email riferimento, scadenza e preavviso dei contratti |
| 41 | `041_orders_refund.sql` | Rimborsi Stripe su orders: totale rimborsato, data, id ultimo refund |
| 42 | `042_reservations_client_action.sql` | `client_action_at` su reservations: annullo/modifica dal cliente (toast live admin) |
| 43 | `043_reservations_recontact.sql` | Flag `recontact` su reservations: "à recontacter" alla chiusura d'une section |
| 44 | `044_push_subscriptions.sql` | Iscrizioni push PWA admin (endpoint + chiavi p256dh/auth) |
| 45 | `045_gift_cards.sql` | Buoni regalo: valore prepagato con saldo scalabile (uso online + riscatto manuale in sala) + registro riscatti + colonne `gift_card_*` su orders |
| 46 | `046_gift_card_orders.sql` | Acquisto di buoni FISICI dal ristoratore presso MOODD (pagamento su Stripe MOODD, come i crediti newsletter) |
| 47 | `047_traffic.sql` | Analytics interno cookieless: tabella `page_views` (provenance des visites) + RPC `traffic_sources` (agrégation par source) |
| 48 | `048_reservation_reminder.sql` | `reminder_sent_at` su reservations: rappel client ~3h avant (jour futur uniquement, anti-doublon) |
| 49 | `049_orders_manual_payment.sql` | orders: toglie il check lang fr/en (ora fr/en/it/nl/es come reservations) + colonna `payment_method` (cash/card/link) per ordini pagati di persona in cassa |
| 50 | `050_orders_modifica_diff.sql` | orders: `supplement_due_cents`/`supplement_paid_at`/`refund_due_cents` per la differenza d'importo dopo una modifica (link supplemento se aumenta, bottone rimborso se diminuisce) |
| 51 | `051_lunch_hide_by_course.sql` | `hide_by_course` (jsonb) su lunch_menus: nascondi i piatti del lunch dal menu pubblico PER PORTATA (estende hide_items; fallback automatico se manca). I menù fissi usano il flag `hide` dentro il JSON `courses` (no migrazione). |
| 52 | `052_agenda_events.sql` | Tabella `agenda_events` (eventi/agenda): titolo, testo, immagine + galleria jsonb, data singola o intervallo, link jsonb, rsvp, active (pubblicato/bozza). Bucket immagini = `popups`. |
| 53 | `053_agenda_events_i18n.sql` | `title_i18n`/`body_i18n`/`body_long_i18n` (jsonb) + `rsvp_max` (int) su agenda_events: testi evento nelle lingue pubbliche + descrizione lunga rich-text + tetto iscrizioni. |
| 54 | `054_clients_lang.sql` | `lang` (text) su clients: lingua del cliente salvata (unica fonte, non più derivata dalle prenotazioni). Catturata dal widget web se assente, o impostata a mano nel modale. |
| 55 | `055_menu_sold_out.sql` | `sold_out` (bool) su menu_items: piatto segnalato «Esaurito» (resta in carta ma non disponibile). Distinto da available (visibile) e orderable (ordinabile). |
| 56 | `056_menu_i18n.sql` | `name_i18n`/`desc_i18n` (jsonb) su menu_items: nome e descrizione del piatto nelle lingue pubbliche. `name` resta il nome canonico (ordini/cucina) = lingua predefinita. |
| 57 | `057_menu_subcategories.sql` | `parent_id` (uuid, FK self) + `depth` (int) su menu_categories: sotto-categorie fino a 3 livelli (gerarchia sulle sezioni; nomi ancora unici → link piatti per nome invariato). + indice parent. |
| 58 | `058_menu_categories_i18n.sql` | `name_i18n` (jsonb) su menu_categories: nome della sezione/categoria nelle lingue pubbliche (titoli tradotti nel menu pubblico). |
| 59 | `059_lunch_i18n.sql` | `name_i18n` (jsonb) su lunch_menus: nome del menu lunch nelle lingue pubbliche. |
| 60 | `060_lunch_hide_items.sql` | `hide_items` (bool) su lunch_menus: flag GLOBALE per nascondere i piatti del lunch dal menu pubblico. Poi esteso per-portata dalla #51 (`hide_by_course`, con fallback a questo flag). |
| 61 | `061_set_menus.sql` | Tabella `set_menus` (menù fissi / prix fixe): name + name_i18n/desc_i18n, immagine, `courses` jsonb (portate con lista piatti), prezzo, supplemento vini, date_from/to, active, hide_items, is_draft. RLS + grant service_role. |
| 62 | `062_set_menus_draft.sql` | `is_draft` (bool) su set_menus: incrementale per i DB dove la tabella esisteva prima che la #61 includesse la colonna nel create (idempotente). |
| 63 | `063_set_menus_grant.sql` | RLS + GRANT (select/insert/update/delete a service_role) su set_menus: incrementale per i DB dove la tabella esisteva prima dei grant nel create (idempotente). |
| 64 | `064_menu_seasonal.sql` | `is_seasonal` (bool) su menu_items: badge «stagionale» sul piatto. |
| 65 | `065_popups_i18n.sql` | `title_i18n`/`body_i18n`/`btn1_label_i18n`/`btn2_label_i18n` (jsonb) su popups + backfill dei campi fr/en esistenti: contenuto del pop-up nelle lingue pubbliche. |
| 66 | `066_popups_position.sql` | `position` (text, default 'center') su popups: posizione del pop-up (center/bottom-left/bottom-center/bottom-right). |
| 67 | `067_google_reviews.sql` | Tabella `google_reviews` (sync recensioni Google Business Profile API v4): review_id, resource name, autore/foto/rating/commento, create/update_time, `reply_comment`/`reply_time` (risposta ristorante), synced_at + indice per data. NB: distinta da `/api/reviews` (cache Places API del sito pubblico). |
| 68 | `068_print_orders.sql` | Tabella `print_orders` (ordini di prodotti stampati acquistati dal ristoratore presso MOODD, pagati sullo Stripe MOODD): product_slug/label + qty + amount_cents + meta (snapshot), stripe_session_id UNIQUE (idempotenza), status pending/paid/cancelled, buyer_email, paid_at/shipped_at + indice per status. |
| 69 | `069_reservations_extra_minutes.sql` | `extra_minutes` (int, default 0) su reservations: minuti di estensione del tavolo (+15/+30/+45 dal modale). Finestra tavolo = heure + durée + extra_minutes; usata da fase/timer, auto-Fini, disponibilità pubblica e piano sala. |
| 70 | `070_gift_cards_langs.sql` | `sender_lang` + `recipient_lang` (text) su gift_cards: lingua dell'email all'offrant e lingua dell'email al destinataire + del PDF. NULL = lingua predefinita del sito pubblico. Il PDF (on-demand) legge `recipient_lang`. Idempotente. |
| 71 | `071_menu_variants.sql` | `variants` (jsonb, default `[]`) su menu_items: formati/varianti di un piatto con prezzo proprio (pizza 30/40 cm, calice/bottiglia, porzione). Array di `{ key, label_i18n, price_cents, orderable, sold_out }`. Vuoto = comportamento invariato (prezzo unico); pieno = `price_cents` diventa «a partire da» e il prezzo incassato è quello della variante, risolto lato server. Vincolo: deve essere un array. Idempotente. |
| 72 | `072_admin_docs_lang.sql` | `lang` (text) su admin_docs_meta: lingua della LETTERA DI DISDETTA di un contratto. Non segue `admin_lang` perché l'email va al FORNITORE, non al ristoratore: si sceglie per documento in Réglages → Documents. NULL = lingua dell'admin (comportamento storico). L'API ripiega da sola se la colonna manca. Idempotente. |
| 73 | `073_locations.sql` | **Multi-sede, passo 1 (solo schema, nessun effetto visibile).** Tabella `locations` (nome, slug, foto, fuso, ordine, attiva — **solo l'identità della sede**) + colonna `location_id uuid null references locations(id) on delete restrict` su 28 tabelle, con indice. **NULL = «vale per tutte le sedi»**: le righe esistenti restano a NULL, quindi per un cliente a sede unica non cambia niente. Nessuna chiave primaria toccata — `app_config` e `settings` hanno una chiave naturale e restano il livello del MARCHIO, sovrascritto per sede da due tabelle nuove, `location_config` e `location_settings` (riga assente = vale quella del marchio). Terza tabella `location_secrets`, **separata di proposito** dalla chiave/valore generica: ci vanno `stripe_secret_key` e `stripe_webhook_secret` (tre società = tre conti), e la lettura generica della configurazione non le vede mai. Assente = si ripiega sull'ambiente, cioè il comportamento di oggi. I vincoli `unique (date, service_key)` e `unique (date, zone)` diventano per sede con `NULLS NOT DISTINCT` (PG 15+, ripiego su `coalesce()` sotto), altrimenti i clienti a sede unica perderebbero in silenzio la protezione dal doppione. **Sezione 8 (aggiunta il 13/09):** indirizzo, CAP, città, telefono, email, ragione sociale, IVA e scheda Google escono da `locations` e finiscono in `location_config` con le chiavi che Réglages → Général usa già (`company_street`, `company_zip`, `public_phone`… vedi il file). Motivo: la scheda Sedi sta in `/admin/super`, dove il ristoratore non entra, e quei dati sono suoi — li scrive lui da Général sulla sede scelta in alto. Il travaso avviene prima del `drop column`, quindi quello che era già stato scritto non si perde, e le stringhe vuote non diventano sovrascritture. **Chi ha già lanciato la #73 la rilancia** e si prende solo la sezione 8. Idempotente. |
| 74 | `074_reservations_source_canali.sql` | Allarga il `check` di `reservations.source` a **`instagram`** e **`qr`**, oltre a `web`/`walkin`/`phone`/`google`. Serve al `?ref=` dei link esterni (scheda Google Business, bio Instagram, QR sui tavoli). Il vincolo si rifà (drop + add): PostgreSQL non sa modificarlo sul posto. **Finché non si lancia, `?ref=instagram` farebbe fallire l'insert** — prenotazione persa, non statistica sbagliata; per questo il codice ripiega su `web` e `tests/sorgente.test.mjs` confronta l'elenco del codice con questo `check`. `qr` resta un valore distinto anche se nell'admin mostra l'icona del sito: stessa esperienza per chi guarda la lista, due canali diversi per chi decide dove spendere. Idempotente. |
| 75 | `075_orders_onsite_payment.sql` | Allarga il `check` di `orders.payment_method` a **`onsite`** (ordine fatto online e pagato al ritiro), oltre a `cash`/`card`/`link`. **Finche' non si lancia, un locale col pagamento in cassa acceso NON crea nessun ordine**: il checkout risponde «Impossibile creare l'ordine», il carrello si svuota e in cucina non arriva niente. Stesso guasto della #74 sulle prenotazioni — il codice impara un valore nuovo e il vincolo resta indietro — percio' da oggi `tests/ordini.test.mjs` confronta i valori scritti dal codice con questo `check`. Il vincolo si rifa' (drop + add): PostgreSQL non lo sa modificare sul posto. Idempotente. |
| 76 | `076_print_tickets.sql` | **La coda dei ticket di cucina.** Tabella `print_tickets` (ordine, sede, tipo, origine, stato, token, job, tentativi). Il ticket esce da una stampante che sta in cucina, dall'altra parte di internet: quando l'ordine viene pagato quella stampante puo' essere spenta o senza carta, e senza una riga che aspetta il ticket e' perso **in silenzio** — nessun errore, in cucina non arriva niente, l'ordine si scopre quando il cliente si presenta. Con la coda la riga resta `queued` e riparte da sola. Lo stato diventa `printed` solo quando il servizio di stampa lo conferma, non quando noi abbiamo spedito: e' l'unico modo di distinguere «stampato» da «mai uscito». **Indice unico su (order_id, kind) solo per le righe `auto`**: lo stesso ordine puo' essere visto piu' volte (webhook ripetuto, modifica) e due comande uguali in cucina sono due pizze; le ristampe a mano sono righe `manual` e restano illimitate. `location_id` NULL = sede unica. Idempotente. |
| 77 | `077_print_tickets_dest.sql` | Un ticket per STAMPANTE: colonna `dest` e indice unico `(order_id, kind, dest)`. L'indice della #76 vietava il secondo e il terzo ticket dello stesso ordine, cioe' proprio le bibite al bar. |
| 78 | `078_admin_notes_done_at.sql` | `done_at` (timestamptz) su admin_notes: QUANDO una nota e' stata spuntata. `done` sa solo *se* e' fatta, quindi «quante ne abbiamo chiuse questa settimana» non e' una domanda difficile — e' impossibile, e lo resta per sempre anche sul passato. Le note gia' fatte restano a NULL: «non si sa» e «fatta il 3 marzo» sono due cose diverse, e riempirle con `created_at` avrebbe inventato una data, cioe' una statistica sbagliata che sembra vera. Si azzera alla riapertura. L'API ripiega da sola se la colonna manca. Idempotente. |
| 79 | `079_admin_notes_done_by.sql` | `done_by` (text) su admin_notes: CHI ha spuntato una nota. `author` dice chi l'ha *scritta*, ed e' un'altra domanda: in una lavagnetta di squadra chi scrive «chiamare il fornitore» e chi lo chiama non sono la stessa persona quasi mai, e contare gli autori chiamandolo «chi fa le cose» sarebbe una classifica plausibile e sbagliata. Si riempie da adesso (le note gia' spuntate restano NULL: chi le ha chiuse non e' scritto da nessuna parte). Si azzera alla riapertura, come la #78. Il NOME e non l'id, cosi' la riga resta leggibile dopo che la persona ha lasciato il locale. L'API ripiega da sola se la colonna manca. Idempotente. |
| 80 | `080_admin_notes_scadenza.sql` | `due_at` (timestamptz) e `repeat` (jsonb) su admin_notes: quando va fatta una nota e ogni quanto torna. `repeat` ha quattro forme — giorno / settimana / mese / anno — descritte in testa al file e provate da `tests/ricorrenza.test.mjs`. Nessun `check` in SQL: la forma la fa rispettare l'API, che e' l'unica a scriverla, se no ogni regola nuova sarebbe una migrazione. Indice su `due_at` per le sole note da fare. Una nota ricorrente, quando la si spunta, NON diventa fatta: il server le sposta avanti la scadenza e la lascia fra quelle da fare. L'API ripiega da sola se le colonne mancano. Idempotente. |
| 81 | `081_admin_notes_assegnata.sql` | `assigned_to` (uuid, la persona in `team`) e `assigned_name` (text, il suo nome al momento) su admin_notes. Due colonne per una cosa sola, e ci vogliono entrambe: l'id serve a sapere a chi riscrivere quando una nota ricorrente torna, il nome a leggere la nota fra sei mesi quando quella persona non lavora piu' qui. Nessuna foreign key: cancellando una persona dalla rubrica un vincolo costringerebbe a scegliere fra rifiutare la cancellazione e cancellare le note. Chi e' assegnabile lo decide `src/lib/admin/teamRegole.ts` — `team` e' una rubrica e contiene anche fornitori e consulenti. L'API ripiega da sola se le colonne mancano. Idempotente. |

Manca ancora nel repo: `menu_seed.sql` (i 182 piatti La Molisana — solo per questo cliente).

## Variabili d'ambiente richieste

| Variabile | Dove | A cosa serve |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | .env + host | Supabase (client browser: login admin) |
| `PUBLIC_SUPABASE_ANON_KEY` | .env + host | Supabase (client browser) |
| `SUPABASE_URL` | .env + host | Supabase lato server |
| `SUPABASE_ANON_KEY` | .env + host | Supabase lato server (letture pubbliche) |
| `SUPABASE_SERVICE_KEY` | .env + host | Supabase service role (API admin, Storage, token HMAC disiscrizione) |
| `PUBLIC_SITE_URL` | .env + host | URL pubblico (logo email, link disiscrizione) |
| `STRIPE_SECRET_KEY` | .env + host | Stripe del CLIENTE (ordini) |
| `STRIPE_WEBHOOK_SECRET` | .env + host | Webhook `checkout.session.completed` |
| `MOODD_STRIPE_SECRET_KEY` | .env + host | Stripe MOODD (crediti newsletter) |
| `RESEND_API_KEY` | .env + host | Invio email |
| `RESEND_FROM` | .env + host | Mittente email (dominio verificato) |
| `KITCHEN_EMAIL` | .env + host | Fallback email cucina (prio: app_config) |
| `SLACK_WEBHOOK_URL` | opzionale | Notifica ordini su Slack |
| `CRON_SECRET` | .env + host | Protegge i cron: /api/cron/daily-brief, /api/cron/newsletter, /api/cron/reservation-reminders |
| `GOOGLE_CLIENT_ID` | opzionale (host) | OAuth app **MOODD** (Business Profile API). Serve per il collegamento della scheda Google dall'admin (`admin/google`). Uguale per tutti i clienti; il refresh token del singolo ristoratore finisce in `app_config.google_oauth_refresh`. Redirect da registrare su Google Cloud: `{PUBLIC_SITE_URL}/api/google/callback`. |
| `GOOGLE_CLIENT_SECRET` | opzionale (host) | Secret dell'app OAuth MOODD (coppia con `GOOGLE_CLIENT_ID`). |
| `GOOGLE_SA_KEY_B64` | opzionale (host) | Base64 del JSON del service account Google (Search Console → onglet Visibilité). Robot da aggiungere come utente nella Search Console di ogni cliente. |
| `GOOGLE_PLACES_API_KEY` | opzionale (host) | Google Places API (New) per le recensioni pubbliche (`/api/reviews` del sito). Richiede anche `google_place_id` in `app_config`. |
