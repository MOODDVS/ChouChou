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
| `CRON_SECRET` | .env + host | Protegge /api/cron/daily-brief (email quotidiana "Votre journée") |
