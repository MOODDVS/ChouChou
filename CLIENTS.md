# CLIENTI — stato di allineamento col motore

Registro di quali installazioni girano sul motore (`MOODDVS/MOODD-Admin`) e quanto sono allineate.
Aggiornare a ogni merge/deploy di un cliente. Vedi `SETUP.md` (setup), `NUOVO_PROGETTO.md` (checklist nuovo cliente), `supabase/` (migrazioni).

**Motore — riferimento attuale:** HEAD `8b1481c` (08/09/2026, secondo giro della giornata).

## Legenda stato
- 🟢 **Allineato** — a pari con `engine/main` (HEAD attuale), migrazioni applicate.
- 🟡 **Parziale** — allineato a una data passata; mancano commit motore recenti e/o migrazioni.
- 🔴 **Indietro** — molto distante dal motore, richiede merge importante.
- ⚫ **Fuori motore** — non gira sul motore (da ricostruire).

## Quadro

| Cliente | Stato | Hosting | Dominio | Design | Ultimo allineamento | Note |
|---|---|---|---|---|---|---|
| **La Molisana** | 🟢 Allineato | Hostinger (EU) | lamolisana.be (live) | Scuro (pinnato) | **merge `8b1481c` — 08/09/2026** | merge pulito 0 conflitti; ✅ redeploy fatto |
| **Comptoir ChouChou** | 🟢 Allineato | Hostinger | comptoirchouchou.be (live) | Chiaro (widget rosa #ed2289) | **merge `8b1481c` — 08/09/2026** | merge pulito 0 conflitti; ✅ redeploy fatto |
| **L'huile sur le feu** | 🟢 Allineato *(setup in corso)* | Hostinger *(da conf.)* | *(da definire)* | *(da definire)* | **merge `8b1481c` — 08/09/2026** | merge pulito 0 conflitti; ✅ redeploy fatto |
| **Educazione Napoletana** | 🟡 v2 in ricostruzione | Hostinger *(da fare)* | educazionenapoletana.be *(switch finale)* | Storico EN portato sul motore | **merge `8b1481c` — 08/09/2026** | merge pulito 0 conflitti; ✅ redeploy fatto; unico trilingue → controllo live da fare |

---

## 🔄 Secondo giro di merge dell'08/09/2026 — motore `8b1481c`

**Tutti e 4 puliti, zero conflitti**, stessa identica lista di 35 file. Porta due sessioni di lavoro (da `b8bd85d`):

- **Breakpoint: conversione CHIUSA.** Nessuna deviazione residua nel motore. Molte soglie non convertite ma **tolte** (tab scrollabili in agenda/marketing/assets/settings, `.gs-packs` e `.n-stats` passate ad `auto-fit`, orari di `SpecialDaysForm`). Le eccezioni dichiarate stanno in `ENGINE.md`.
- **Clienti**: larghezze delle colonne calcolate nel JS (`--grid-cols`), selettore colonne accanto alla ricerca con preferenza in `localStorage`, lingua tolta dalla colonna e messa come bandierina sul badge, dati in bianco pieno, totale a zero → trattino.
- **Google**: mai più WebP verso Google (accetta solo JPG/PNG — era la causa del logo PNG che non si caricava su EN), tab Post impilato su tablet e mobile, recensioni a una colonna quando la scheda si impila, spazi dei campi della scheda uniformati.
- **Marketing e Assets**: bottoni «aggiungi» uniformati al FAB corallo condiviso.
- **Agenda**: modale evento che non accavalla più le due colonne a una colonna.
- **Documenti**: lingua scelta per documento (résiliation nella lingua del fornitore) → **migrazione #72**. Email «Commande Print» con il guscio delle altre.

✅ **Migrazione #72 (`supabase/admin_docs_lang.sql`) lanciata su tutti e 4** l'08/09.

---

## 🔄 Giro di merge dell'08/09/2026 — motore `b8bd85d`

**Tutti e 4 puliti, zero conflitti.** Porta: ordini (date future nel datepicker, nome+telefono obbligatori), checkout e coupon nelle 5 lingue, prefisso Stripe che legge `defaultLang` dal cliente, modale prenotazioni scrollabile con tavoli nella finestra persone−1/+2, colonne della home 4/3/2/1, switch push che dice perché è spento.

⚠️ **Trappola vista su La Molisana**: `git merge` è morto con `fatal: stash failed`. Causa: un `.git/index.lock` rimasto da un `git status` lanciato dalla VM Cowork (che nelle cartelle senza permesso di cancellazione crea il lock ma non riesce a toglierlo). Il merge non era nemmeno partito. Si risolve con `rm -f .git/index.lock`. **Da qui in avanti: niente comandi git nei repo dal lato Cowork** — si leggono i file, non l'indice.

---

## 🔄 Giro di merge del 07/09/2026 — motore `7936e3b`

Tutti e 4 i clienti allineati nella stessa sessione. Cosa porta: notifiche al ristoratore nella **lingua admin**, form Jours spéciaux condiviso (due tab nel modale della home), tempo di preparazione dal tile Cuisine, liaisons fino a 16 tavoli, `i18nMenu.ts`.

| Cliente | Conflitti | Risoluzione |
|---|---|---|
| ChouChou | `src/lib/db.ts` (6 blocchi) | ChouChou aveva una versione **fatta a mano** di `name_i18n` (`MENU_SELECT_I18N`): sostituita da quella del motore, che ripiega su qualunque colonna nuova. **Tenute** le due cose sue: `cacheOr("menu:public", …)` e il fallback delle categorie standard (`i18nDi`, era già fuori dai conflitti). |
| L'Huile | `.gitignore` | Due aggiunte in coda che non si escludono: tenute entrambe. |
| La Molisana | nessuno | — |
| Educazione Napoletana | `.gitattributes` | EN si era già protetto `siteImageSlots.ts` da solo; presa la versione del motore, che copre anche `sitePages.ts`. |

⚠️ **Trappola vista su EN**: `OrderApp.tsx` aveva modifiche **non committate** — la stessa correzione sulle lingue che stavo facendo nel motore, applicata a mano dentro il cliente. Il merge si è rifiutato di partire. Verificato con `diff` che il motore fosse un superset (lo era: aveva in più la restrizione di `SlotPicker` a fr/en), poi `git restore`. Se le due versioni avessero divergiuto sarebbe stato un pasticcio: **`OrderApp.tsx` non si tocca nei clienti**.

**Correzioni per-cliente fatte nello stesso giro** (non toccano il motore):
- L'Huile: 20 errori `astro check` preesistenti — tipi mancanti in `src/pages/print/menu.astro` (frontmatter in JS puro) e `LinksBoard.astro`.
- La Molisana: `Layout.astro` non aveva la prop `noindex`, che `feedback.astro` gli passava — **la pagina feedback era indicizzabile**. Aggiunta la prop e il `<meta name="robots">`. Inoltre `tsconfig.json` non escludeva `build/`, e `astro check` analizzava anche l'output compilato (446 file invece di ~220).

---

## ✅ Migrazioni — nessuna pendente (08/09/2026)
**#72 `admin_docs_lang.sql`** (colonna `lang` su `admin_docs_meta`) **lanciata su tutti e quattro** l'08/09. Tutti i clienti sono a pari con le migrazioni del motore.

**#71 `menu_variants.sql` lanciata su ChouChou, La Molisana e L'Huile.** Educazione Napoletana v2 aveva già #1→#71. Tutti e 4 i clienti sono a pari con le migrazioni del motore.

**Chiavi VAPID: tutte e 4 a posto.** Mancavano su ChouChou (righe assenti nel `.env`) e su L'Huile (righe vuote) — generate il 07/09 con `npx web-push generate-vapid-keys`.
⚠️ `PUBLIC_VAPID_KEY` è una variabile `PUBLIC_*`: Astro la **incolla nel bundle al build**. Metterla su Hostinger e riavviare NON basta, serve il rebuild.

✅ **Redeploy Hostinger fatto su tutti l'08/09** (secondo giro), **verificato live**: logo PNG che si carica nel tab Foto di Google (era il caso che ha fatto scoprire la conversione in WebP), notifiche EN in italiano, ordine EN con `lang: it`. Il promemoria di sopra resta valido come metodo: senza redeploy il codice nuovo resta nel repo.

ℹ️ **«Varianti» è una feature opzionale**: si accende cliente per cliente da Super admin → Impostazioni. Per ora la vuole **solo Educazione Napoletana**; gli altri non vedono nemmeno il tab.

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
