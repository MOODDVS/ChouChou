# Migrazioni Supabase — ordine di esecuzione

Tutte idempotenti (`create table if not exists`, `add column if not exists`,
`on conflict do nothing`): rilanciarle non fa danni. SQL Editor di Supabase.
NB: se l'insert su `storage.buckets` è bloccato dal SQL Editor, crea i bucket
dalla dashboard (Storage → New bucket, **Public** ON): `popups`, `menu`, `documents`.

| # | File | Cosa crea |
|---|---|---|
| 1 | `schema.sql` | Base: `menu_items`, `settings`, `orders` + GRANT |
| 2 | `app_config.sql` | Store chiave/valore `app_config` (orari cucina, link, Général, réservations…) |
| 3 | `special_days.sql` | Giorni speciali (chiusure/aperture eccezionali) |
| 4 | `menu_categories.sql` | Sezioni del menu |
| 5 | `menu_categories_kind.sql` | Tipo sezione: food / drink |
| 6 | `menu_discount.sql` | Sconti per piatto (`discount_*`) |
| 7 | `menu_flags.sql` | Badge: bestseller / vegan / spicy |
| 8 | `menu_suggestion.sql` | Badge Suggestion |
| 9 | `menu_image.sql` | Foto piatti (`image_url`) + bucket `menu` |
| 10 | `admin_notes.sql` | Note della dashboard admin |
| 11 | `order_status_done.sql` | Stato ordine `done` |
| 12 | `clients.sql` | Rubrica clienti |
| 13 | `clients_hidden.sql` | Flag `hidden` sui clienti |
| 14 | `coupons.sql` | Codici promo + colonne coupon su `orders` |
| 15 | `popups.sql` | Pop-up marketing (bilingue) + bucket `popups` |
| 16 | `newsletter.sql` | Storico invii + disiscritti |
| 17 | `newsletter_credits.sql` | Crediti newsletter acquistati (Stripe MOODD) |
| 18 | `team.sql` | Rubrica Team (contatti, foto, predisposizione accessi) |
| 19 | `documents.sql` | Bucket `documents` (PDF, admin → Assets) |
| 20 | `reservations.sql` | Prenotazioni V1 (widget proprio, conferma automatica, cancel_token) |
| 21 | `reservations_source.sql` | Colonna `source` (web / walkin / phone / google) |
| 22 | `service_closures.sql` | Chiusure di servizio per giorno (Complet / Fermeture exceptionnelle) |
| 23 | `zone_closures.sql` | Chiusure di section per giorno (Terrasse fermée, ecc.) |
| 24 | `reservations_review.sql` | Email di recensione: id Resend per poterla annullare |
| 25 | `reservations_options.sql` | Opzioni `birthday` + `special_event` (Anniversaire / Événement spécial) |
| 26 | `reservations_seated.sql` | `seated_at`: arrivo reale al tavolo (timer En cours) |
| 27 | `reservations_table_time.sql` | `table_minutes`: durata reale del tavolo (Fini manuale = tempo reale; auto-Fini = durée+15; no-show = azzerata) |
| 28 | `reservations_spent.sql` | `spent_cents`: addition inserita dallo staff a fine tavolo (modale dettagli) |
| 29 | `orders_source.sql` | `source` su orders: 'web' (sito) / 'manual' (ordine creato dallo staff con link di pagamento) |
| 30 | `orders_cancel_token.sql` | `cancel_token` su orders: link « Annuler ma commande » nell'email di pagamento |
| 31 | `clients_photo.sql` | `photo_url` su clients: foto del cliente (modale di modifica) |
| 32 | `clients_block.sql` | `blocked` su clients: blocco delle prenotazioni dal widget (ordini sempre permessi) |
| 33 | `special_days_services.sql` | `services` su special_days: switch dei servizi attivi nei giorni speciali "ouvert" |
| 34 | `admin_notes_tags.sql` | `tags` su admin_notes: etichette Important / Récurrent / Fournisseur sulle note |
| 35 | `brand_bucket.sql` | Bucket Storage `brand`: loghi (normale/negativo/1 colore) + favicon da Réglages → Général |
| 36 | `restaurant_tables.sql` | Plan de salle: tavoli per section (nome, posti, forma, posizione) disegnati nei Réglages |
| 37 | `reservations_tables.sql` | `tables` su reservations: tavoli assegnati automaticamente (plan de salle fase 2) |
| 38 | `lunch_menus.sql` | Formules Lunch: portate, intervallo date, piatti dal menu, combinazioni con prezzo |
| 39 | `newsletter_schedule.sql` | Newsletter programmate/ricorrenti: contenuto, segmento, una-tantum o weekly/monthly |
| 40 | `admin_docs_meta.sql` | Metadati documents admin: email riferimento, scadenza e preavviso dei contratti |
| 41 | `orders_refund.sql` | Rimborsi Stripe su orders: totale rimborsato, data, id ultimo refund |
| 42 | `reservations_client_action.sql` | `client_action_at` su reservations: annullo/modifica dal cliente (toast live admin) |
| 43 | `reservations_recontact.sql` | Flag `recontact` su reservations: "à recontacter" alla chiusura d'une section |
| 44 | `push_subscriptions.sql` | Iscrizioni push PWA admin (endpoint + chiavi p256dh/auth) |
| 45 | `gift_cards.sql` | Buoni regalo: valore prepagato con saldo scalabile (uso online + riscatto manuale in sala) + registro riscatti + colonne `gift_card_*` su orders |
| 46 | `gift_card_orders.sql` | Acquisto di buoni FISICI dal ristoratore presso MOODD (pagamento su Stripe MOODD, come i crediti newsletter) |
| 47 | `traffic.sql` | Analytics interno cookieless: tabella `page_views` (provenance des visites) + RPC `traffic_sources` (agrégation par source) |
| 48 | `reservation_reminder.sql` | `reminder_sent_at` su reservations: rappel client ~3h avant (jour futur uniquement, anti-doublon) |
| 49 | `orders_manual_payment.sql` | orders: toglie il check lang fr/en (ora fr/en/it/nl/es come reservations) + colonna `payment_method` (cash/card/link) per ordini pagati di persona in cassa |
| 50 | `orders_modifica_diff.sql` | orders: `supplement_due_cents`/`supplement_paid_at`/`refund_due_cents` per la differenza d'importo dopo una modifica (link supplemento se aumenta, bottone rimborso se diminuisce) |
| 51 | `lunch_hide_by_course.sql` | `hide_by_course` (jsonb) su lunch_menus: nascondi i piatti del lunch dal menu pubblico PER PORTATA (estende hide_items; fallback automatico se manca). I menù fissi usano il flag `hide` dentro il JSON `courses` (no migrazione). |
| 52 | `agenda_events.sql` | Tabella `agenda_events` (eventi/agenda): titolo, testo, immagine + galleria jsonb, data singola o intervallo, link jsonb, rsvp, active (pubblicato/bozza). Bucket immagini = `popups`. |
| 53 | `agenda_events_i18n.sql` | `title_i18n`/`body_i18n`/`body_long_i18n` (jsonb) + `rsvp_max` (int) su agenda_events: testi evento nelle lingue pubbliche + descrizione lunga rich-text + tetto iscrizioni. |
| 54 | `clients_lang.sql` | `lang` (text) su clients: lingua del cliente salvata (unica fonte, non più derivata dalle prenotazioni). Catturata dal widget web se assente, o impostata a mano nel modale. |
| 55 | `menu_sold_out.sql` | `sold_out` (bool) su menu_items: piatto segnalato «Esaurito» (resta in carta ma non disponibile). Distinto da available (visibile) e orderable (ordinabile). |
| 56 | `menu_i18n.sql` | `name_i18n`/`desc_i18n` (jsonb) su menu_items: nome e descrizione del piatto nelle lingue pubbliche. `name` resta il nome canonico (ordini/cucina) = lingua predefinita. |
| 57 | `menu_subcategories.sql` | `parent_id` (uuid, FK self) + `depth` (int) su menu_categories: sotto-categorie fino a 3 livelli (gerarchia sulle sezioni; nomi ancora unici → link piatti per nome invariato). + indice parent. |
| 58 | `menu_categories_i18n.sql` | `name_i18n` (jsonb) su menu_categories: nome della sezione/categoria nelle lingue pubbliche (titoli tradotti nel menu pubblico). |
| 59 | `lunch_i18n.sql` | `name_i18n` (jsonb) su lunch_menus: nome del menu lunch nelle lingue pubbliche. |
| 60 | `lunch_hide_items.sql` | `hide_items` (bool) su lunch_menus: flag GLOBALE per nascondere i piatti del lunch dal menu pubblico. Poi esteso per-portata dalla #51 (`hide_by_course`, con fallback a questo flag). |
| 61 | `set_menus.sql` | Tabella `set_menus` (menù fissi / prix fixe): name + name_i18n/desc_i18n, immagine, `courses` jsonb (portate con lista piatti), prezzo, supplemento vini, date_from/to, active, hide_items, is_draft. RLS + grant service_role. |
| 62 | `set_menus_draft.sql` | `is_draft` (bool) su set_menus: incrementale per i DB dove la tabella esisteva prima che la #61 includesse la colonna nel create (idempotente). |
| 63 | `set_menus_grant.sql` | RLS + GRANT (select/insert/update/delete a service_role) su set_menus: incrementale per i DB dove la tabella esisteva prima dei grant nel create (idempotente). |
| 64 | `menu_seasonal.sql` | `is_seasonal` (bool) su menu_items: badge «stagionale» sul piatto. |
| 65 | `popups_i18n.sql` | `title_i18n`/`body_i18n`/`btn1_label_i18n`/`btn2_label_i18n` (jsonb) su popups + backfill dei campi fr/en esistenti: contenuto del pop-up nelle lingue pubbliche. |
| 66 | `popups_position.sql` | `position` (text, default 'center') su popups: posizione del pop-up (center/bottom-left/bottom-center/bottom-right). |
| 67 | `google_reviews.sql` | Tabella `google_reviews` (sync recensioni Google Business Profile API v4): review_id, resource name, autore/foto/rating/commento, create/update_time, `reply_comment`/`reply_time` (risposta ristorante), synced_at + indice per data. NB: distinta da `/api/reviews` (cache Places API del sito pubblico). |

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
| `GOOGLE_SA_KEY_B64` | opzionale (host) | Base64 del JSON del service account Google (Search Console → onglet Visibilité). Robot da aggiungere come utente nella Search Console di ogni cliente. |
| `GOOGLE_PLACES_API_KEY` | opzionale (host) | Google Places API (New) per le recensioni pubbliche (`/api/reviews` del sito). Richiede anche `google_place_id` in `app_config`. |
