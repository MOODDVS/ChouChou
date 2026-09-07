# CLIENTI — stato di allineamento col motore

Registro di quali installazioni girano sul motore (`MOODDVS/MOODD-Admin`) e quanto sono allineate.
Aggiornare a ogni merge/deploy di un cliente. Vedi `SETUP.md` (setup), `NUOVO_PROGETTO.md` (checklist nuovo cliente), `supabase/` (migrazioni).

**Motore — riferimento attuale:** HEAD `bbe0885` (01/09/2026).

## Legenda stato
- 🟢 **Allineato** — a pari con `engine/main` (HEAD attuale), migrazioni applicate.
- 🟡 **Parziale** — allineato a una data passata; mancano commit motore recenti e/o migrazioni.
- 🔴 **Indietro** — molto distante dal motore, richiede merge importante.
- ⚫ **Fuori motore** — non gira sul motore (da ricostruire).

## Quadro

| Cliente | Stato | Hosting | Dominio | Design | Ultimo allineamento | Note |
|---|---|---|---|---|---|---|
| **La Molisana** | 🟢 Allineato | Hostinger (EU) | lamolisana.be (live) | Scuro (pinnato) | **merge `bbe0885` — 01/09/2026** | sito+branding tenuti, migrazioni recuperate |
| **Comptoir ChouChou** | 🟢 Allineato | Hostinger | comptoirchouchou.be (live) | Chiaro (widget rosa #ed2289) | **merge `bbe0885` — 01/09/2026** | conflitto solo middleware (cacheEdge) |
| **L'huile sur le feu** | 🟢 Allineato *(setup in corso)* | Hostinger *(da conf.)* | *(da definire)* | *(da definire)* | **merge `bbe0885` — 01/09/2026** | merge pulito, 0 conflitti |
| **Educazione Napoletana** | 🟡 v2 in ricostruzione | Hostinger *(da fare)* | educazionenapoletana.be *(switch finale)* | Storico EN portato sul motore | **clone + merge — 05/09/2026** | repo NUOVO `educazione-napoletana`; il sito live gira ancora dal vecchio |

---

## ✅ Migrazioni — nessuna pendente (05/09/2026)
**Tutti e 3 i clienti allineati al motore `1f9c983`** (ChouChou, La Molisana, L'Huile). **Educazione Napoletana v2** ha già tutte le migrazioni #1→#71.

⚠️ **#71 `menu_variants.sql` (varianti) è da lanciare su ChouChou, La Molisana e L'Huile** al prossimo merge. Senza, il sito non si rompe (le query ripiegano) ma i formati non esistono.

- **04/09** — #68 `print_orders`, #69 `reservations.extra_minutes`, #46 `gift_card_orders`: lanciate su tutti e 3.
- **05/09** — #70 `gift_cards_langs.sql` (`sender_lang`/`recipient_lang` su gift_cards): lanciata su tutti e 3.

**Nessun cron nuovo.** Il merge del 05/09 porta anche: CSP `script-src` enforced su `/admin` (nonce per-richiesta), **guard di autenticazione lato server** sulle pagine `/admin` (niente più flash della nav prima del login), cache `app_config` 30s + `/api/admin/pages` da 6 query a 1, revisione di sicurezza (`esc()` con virgolette, `no-store` su admin/api-admin, limiti input form contatti) — **tutto senza migrazioni**.

⚠️ **Lezione deploy (05/09)**: il middleware è codice SERVER. Dopo il push, il deploy Hostinger deve risultare **Completed + Current** PRIMA di testare: un test troppo presto mostra ancora la versione vecchia (successo con ChouChou: `/admin` dava 200 con la pagina admin, poi 302 corretto a deploy concluso). Verifica rapida: incognito su `/admin` → deve rispondere **302**, non 200.

---

## La Molisana — 🟢 Allineato (01/09/2026)
- **LIVE** su `lamolisana.be` (primo cliente). Tema **scuro** pinnato in Réglages → Design.
- **Merge `engine/main` → `bbe0885` (01/09)**: era indietro di **164 commit** (base 30/07). Merge pulito a parte **5 conflitti**, risolti tenendo il sito/branding di La Molisana e prendendo la struttura del motore:
  - `package.json` / `public/manifest.json` → nome, colori PWA (#231f20) di La Molisana (versione motore 3.0.0, icone `/restohub/`).
  - `src/config/client.ts` → firma email fr/en "La famille de La Molisana" (footer prodotto → "RestoHub v3.0" dal motore).
  - `src/layouts/Layout.astro` → Layout di La Molisana + import del motore per la favicon-da-DB (`supabaseAdmin`/`cacheOr`; `CLIENT` scartato perché non usato).
  - `src/pages/index.astro` → **homepage vera di La Molisana** (Hero/Story/Molise/PhotoStrip), scartato il template "coming soon" del motore.
- `npx tsc --noEmit` 0 errori · `npm run build` OK · push fatto.
- **Migrazioni recuperate (01/09)**: il merge portava `db.ts` che seleziona `is_seasonal` → menu/order davano 500 finché la colonna mancava. Applicato lo script `MIGRAZIONI_DA_APPLICARE.sql` (**19 migrazioni**, tutte `if not exists`): menu (seasonal, sold_out, i18n, sotto-categorie, categorie i18n), lunch/formule (hide_items, hide_by_course, i18n, set_menus + draft/grant), ordini (manual_payment, modifica_diff), popup (i18n, position), agenda (events + i18n), google_reviews, clients_lang.
  - ⚠️ Attenzione: alcune migrazioni con `create policy` NON sono idempotenti e possono fermare lo script → applicare `google_reviews` da sola se la tabella manca ("Could not find table public.google_reviews in schema cache").
- ⚠️ **Merge futuri**: NON sovrascrivere lo strato vetrina — tenere sempre `src/pages/index.astro`, `src/layouts/Layout.astro`, `src/config/client.ts`, `public/manifest.json`, `package.json` (nome/colori) lato La Molisana.

## Comptoir ChouChou — 🟢 Allineato (01/09/2026)
- **LIVE** su `comptoirchouchou.be`. Widget prenotazioni coi colori ChouChou (rosa #ed2289).
- **Merge `engine/main` → `bbe0885` (01/09)**: era 12 commit indietro. **Un solo conflitto**, `src/middleware.ts`: il motore aggiunge `securityHeaders` + `rateLimit`, ChouChou aveva `cacheEdge` → risolto combinando la sequence: `sequence(securityHeaders, rateLimit, metodoOverride, redirectWww, cacheEdge)`. Push fatto.
- Migrazioni: base recente → il merge non ha aggiunto migrazioni nuove. Se comparisse un 500 menu o "google_reviews in schema cache", applicare `menu_seasonal` / `google_reviews`.

## L'huile sur le feu — 🟢 Allineato (01/09/2026) *(setup in corso)*
- Repo `MOODDVS/lhuilesurlefeu`, clonato dal motore (base `e373d8a`, 29/08). Remote `engine` configurato.
- **Merge `engine/main` → `bbe0885` (01/09)**: 11 commit indietro, **0 conflitti** (lavoro cliente sito/menu e commit motore su file diversi). `npm run build` + push.
- **Nessuna migrazione DB nuova** dal merge (i .sql erano già nel repo dal clone). A patto che al setup siano state applicate le migrazioni di base (incl. `menu_seasonal`, `google_reviews`), il DB è a posto.
- Hosting/dominio/design: *da definire*. Lavoro cliente nel suo progetto Claude dedicato.

## Educazione Napoletana — 🟡 v2 in ricostruzione (05/09/2026)
- **Il sito LIVE è ancora il vecchio** (repo `MOODDVS/educazionenapoletana`, admin pre-motore). Intatto, non toccato.
- **v2 = repo NUOVO `MOODDVS/educazione-napoletana`**, clone del motore. Distinto dal vecchio apposta: Hostinger deploya al push, e un push sul repo vecchio avrebbe messo online la v2 incompleta.
- Fatto: Supabase nuovo con le 71 migrazioni, menu importato dal vecchio DB (61 piatti, 21 con formati), design storico portato dentro le componenti del motore, footer collegato all'admin.
- Da fare: seed Général/Liens/orari, Hostinger + env, 5 cron, accendere la funzione «Varianti», foto dei piatti da travasare, poi switch del dominio.
- 📄 **Stato completo e trappole: `EN_V2_STATO.md` nel repo del cliente.**
- Lavoro cliente nel suo progetto Claude dedicato.

---

## Come allineare un cliente (promemoria)
1. Dal repo del cliente: `git fetch engine && git merge engine/main --no-edit`.
2. Risolvere gli eventuali conflitti (di norma: **tenere sito/branding del cliente**, prendere la struttura del motore). Per La Molisana i file vetrina/config vanno SEMPRE tenuti lato cliente.
3. `npm run build` (dal Mac) = deve passare.
4. Applicare le **migrazioni nuove** che il merge ha aggiunto in `supabase/` sul Supabase del cliente (tutte `if not exists`; se una policy blocca, lanciare le tabelle mancanti singolarmente).
5. `git commit --no-edit` (se merge con conflitti) + `git push` → deploy Hostinger.
6. Verificare i **5 job pg_cron** (dominio vero + `CRON_SECRET`): daily-brief, newsletter, reservation-reminders, auto-complete-orders, google-reviews.
7. Ri-pinnare tema/permessi se serve e **aggiornare questo file**.
