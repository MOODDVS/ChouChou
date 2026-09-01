# CLIENTI — stato di allineamento col motore

Registro di quali installazioni girano sul motore (`MOODDVS/MOODD-Admin`) e quanto sono allineate.
Aggiornare a ogni merge/deploy di un cliente. Vedi `SETUP.md` (setup), `NUOVO_PROGETTO.md` (checklist nuovo cliente), `supabase/MIGRATIONS.md` (#1–#67).

**Motore — riferimento attuale:** HEAD `e373d8a` (29/08/2026) · migrazioni **#1–#67**.

## Legenda stato
- 🟢 **Allineato** — a pari (o quasi) con `engine/main`, migrazioni #1–#67 lanciate.
- 🟡 **Parziale** — allineato a una data passata; mancano commit motore recenti e/o migrazioni.
- 🔴 **Indietro** — molto distante dal motore, richiede merge importante.
- ⚫ **Fuori motore** — non gira ancora sul motore (da ricostruire).

## Quadro

| Cliente | Stato | Hosting | Dominio | Design | Ultimo allineamento | Migrazioni | Cron |
|---|---|---|---|---|---|---|---|
| **L'huile sur le feu** | 🟢 Allineato *(setup in corso)* | Hostinger *(da conf.)* | *(da definire)* | *(da definire)* | clone da `e373d8a` (29/08) | #1–#67 da lanciare al setup | da configurare (5 job) |
| **Comptoir ChouChou** | 🟡 Parziale | Hostinger | comptoirchouchou.be | Chiaro (widget rosa #ed2289) | merge **21/08** + cron 29/08 | ~#1–#50 ✅ · #51 e #52–#67 da verificare | 5 job pg_cron ✅ (29/08) |
| **La Molisana** | 🔴 Indietro | Hostinger (EU) | — (live) | Scuro (pinnato) | blocco PUSH **27/07** | #1–#44 ✅ · **#45–#67 mancanti** | daily-brief + newsletter ✅ (mancano auto-complete-orders, reminders, google-reviews) |
| **EducazioneNapoletana** | ⚫ Fuori motore | — | — (live su admin vecchio) | — | mai (fork pre-motore) | — (DB fatto a mano, 4 tabelle) | — |

---

## L'huile sur le feu — 🟢 Allineato *(setup in corso)*
- **Nuovo cliente** (avviato 29/08). Repo `MOODDVS/lhuilesurlefeu` **clonato dal motore a HEAD `e373d8a`** → nasce a pari col motore (storia git condivisa, remote `engine` già configurato). Primo `push -u origin main` fatto.
- **Setup in corso** seguendo `NUOVO_PROGETTO.md`: brand (`client.ts`/`public/`/`astro.config`) · Supabase nuovo (**migrazioni #1–#67** in ordine) · env su Hostinger (**`CRON_SECRET` NUOVO**) · deploy · **5 job pg_cron**.
- Hosting: Hostinger *(da confermare)*. Dominio e design: *da definire*.
- Lavoro cliente: nel **suo progetto Claude** dedicato (qui si tocca solo il motore).

## Comptoir ChouChou — 🟡 Parziale
- **LIVE** su `comptoirchouchou.be` (ex dominio temp `blanchedalmond-pheasant-795745.hostingersite.com`).
- **Merge 21/08**: era molto indietro → portato al motore (~11 conflitti + template demo01, pagine legali, feedback, recensioni Google). `astro check` 0 errori. ReservationWidget tenuto coi colori ChouChou (rosa #ed2289).
- **Migrazioni**: al merge mancavano solo `google_reviews` / `popups_i18n` / `popups_position` → **lanciate**. Le altre erano già presenti. Da verificare/lanciare (idempotenti): **#51** (`lunch_hide_by_course`) e le **#52–#67** riconciliate.
- **Cron (29/08)**: erano TUTTI mancanti (`cron.job` vuoto) → ricreati i **5 job pg_cron** col dominio vero + suo `CRON_SECRET` (header `x-cron-key`). Run `succeeded`.
- **Env minima attuale**: Supabase + `MOODD_STRIPE_SECRET_KEY` (crediti + gift card via retrieve; NO webhook/Resend ancora).
- ⚠️ **Da fare al prossimo merge**: manca ancora `public/restohub/wordmark.png` (mergiato PRIMA del fix wordmark → footer email rotto su tema chiaro). Applicare il passo wordmark del merge.
- ⚠️ **Delta motore non ancora incluso**: il merge è del 21/08, quindi NON ha il lavoro motore del **26–29/08** (modale Nuovo ordine, floor-plan + prenotazioni 27/08, redesign mobile clienti/menu 28/08, menu tab dal/fuori menu + agenda rich text 29/08). Da portare al prossimo allineamento.

## La Molisana — 🔴 Indietro
- **LIVE** (primo cliente). Tema **scuro** pinnato in Réglages → Design.
- **Ultimo allineamento: 27/07** (blocco PUSH). Base motore ~`a2b6611`/`5dab4a9`. Push attivo (chiavi **VAPID** su Hostinger, migrazione **#44**). Ha remote `engine` e branch `backup-pre-merge`.
- **Migrazioni lanciate: #1–#44.** **Mancano #45–#67** (gift cards, gift_card_orders, traffic, reminder, orders_manual_payment, orders_modifica_diff, lunch_hide_by_course + le 16 riconciliate: agenda, menu i18n/sotto-categorie/sold_out/seasonal, set_menus, clients_lang, popups i18n/position, google_reviews…).
- **Delta motore mancante = quasi tutto agosto**: email transazionali ridisegnate, recensioni Google + gating feedback, marketing 2.0 (pop-up/newsletter/coupon/buoni), menu (sotto-categorie, i18n, esaurito, stagionale, menù fissi), agenda eventi, clienti (lingua, storico, mobile), modifica ordine con differenza, floor-plan, demo01 sito, ecc.
- ⚠️ **Merge SELETTIVO obbligatorio** (ha lo strato vetrina Molise congelato): dopo `git merge engine/main`, `git checkout HEAD -- public/ src/config/ src/pages/{index,en/index,links}.astro src/layouts/Layout.astro astro.config.mjs` per NON cancellare foto/loghi del sito live. Poi `git checkout engine/main -- public/restohub/` per il branding motore (incl. wordmark). Lanciare le migrazioni mancanti, ri-pinnare il tema, verificare i cron.
- **Codice buono auto**: `LAMOL-…` (5 iniziali del nome).

## EducazioneNapoletana (EN) — ⚫ Fuori motore
- **LIVE su admin VECCHIO** (fork pre-motore, troppo divergente: niente `client.ts`/middleware/lib-admin; DB fatto a mano, 4 tabelle). **NIENTE merge.**
- **Piano EN v2 = rebuild da zero sul motore**, in parallelo: Supabase nuovo (#1–#67), si re-inseriscono solo **menu + orari** (storico ordini → CSV d'archivio). Salvare: GA4, SEO, cookie consent. Lasciare: BizPrint (→ futura stampa termica nativa).
- Sviluppo su 2 macchine (Mac mini + MacBook) → `git pull` prima di lavorare, `git push` dopo.

---

## Come allineare un cliente (promemoria)
1. `git fetch engine && git merge engine/main` (dal repo del cliente).
2. Se ha strato vetrina congelato (es. La Molisana) → **merge selettivo** (checkout `HEAD --` sui file vetrina/config, checkout `engine/main -- public/restohub/`).
3. `npx astro check` (dal Mac) = 0 errori.
4. Lanciare le **migrazioni mancanti** di `MIGRATIONS.md` (tutte idempotenti → rilanciarle non fa danni).
5. `git push` → deploy Hostinger.
6. Verificare i **5 job pg_cron** (dominio vero + `CRON_SECRET`): daily-brief, newsletter, reservation-reminders, auto-complete-orders, google-reviews.
7. Ri-pinnare tema/permessi se serve, aggiornare questo file.
