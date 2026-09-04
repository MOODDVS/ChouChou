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
| **Educazione Napoletana** | ⚫ Fuori motore | — | (live su admin vecchio) | — | mai | **richiede rebuild totale sul motore** |

---

## ⚠️ Migrazioni pendenti per TUTTI i clienti
**04/09/2026** — ✅ **#68 print_orders, #69 reservations.extra_minutes, #46 gift_card_orders** già lanciate su **ChouChou, La Molisana, L'Huile** durante i merge del 04/09 (EducazioneNapoletana fuori dal motore).

🟡 **PENDENTE al prossimo merge** (lavoro motore 04/09: buoni regalo multilingua):
- **`gift_cards_langs.sql`** (#70) — colonne `sender_lang` + `recipient_lang` su gift_cards (lingua email offrant/destinataire + PDF; NULL = default sito pubblico).

Idempotente (`add column if not exists`). **Nessun cron nuovo.** L'API dei buoni è tollerante (ritenta senza le colonne se la #70 non è ancora lanciata), ma senza #70 le lingue scelte non vengono salvate. Le altre modifiche 04/09 (alert conflitto estensione, notifica push form contatti, push tradotte) **non richiedono migrazioni**.

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

## Educazione Napoletana — ⚫ Fuori motore
- **LIVE su admin VECCHIO** (fork pre-motore, troppo divergente: niente `client.ts`/middleware/lib-admin del motore; DB fatto a mano). Repo `MOODDVS/educazionenapoletana`. **NIENTE merge** — incompatibile.
- **Piano = REBUILD TOTALE sul motore** (ricode completo), in parallelo:
  - Supabase nuovo con tutte le migrazioni del motore in ordine.
  - Si re-inseriscono solo **menu + orari**; storico ordini → CSV d'archivio.
  - Salvare: GA4, SEO, cookie consent. Valutare a parte: stampa termica (ex BizPrint) come feature nativa futura.
- Sviluppo su 2 macchine (Mac mini + MacBook) → `git pull` prima, `git push` dopo.

---

## Come allineare un cliente (promemoria)
1. Dal repo del cliente: `git fetch engine && git merge engine/main --no-edit`.
2. Risolvere gli eventuali conflitti (di norma: **tenere sito/branding del cliente**, prendere la struttura del motore). Per La Molisana i file vetrina/config vanno SEMPRE tenuti lato cliente.
3. `npm run build` (dal Mac) = deve passare.
4. Applicare le **migrazioni nuove** che il merge ha aggiunto in `supabase/` sul Supabase del cliente (tutte `if not exists`; se una policy blocca, lanciare le tabelle mancanti singolarmente).
5. `git commit --no-edit` (se merge con conflitti) + `git push` → deploy Hostinger.
6. Verificare i **5 job pg_cron** (dominio vero + `CRON_SECRET`): daily-brief, newsletter, reservation-reminders, auto-complete-orders, google-reviews.
7. Ri-pinnare tema/permessi se serve e **aggiornare questo file**.
