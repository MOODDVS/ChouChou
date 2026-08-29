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
