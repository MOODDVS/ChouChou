# RestoHub — engine multi-cliente

L'admin di questo repo (`/admin`) è **RestoHub**, il pannello multi-cliente
di MOODD per i siti ristorante. Il sito pubblico è per-cliente; l'admin è
il motore riutilizzabile. **Nessun brand è hardcodato nel motore**: tutto
passa da `src/config/client.ts` e da Réglages → Général (app_config).

## Cos'è motore, cos'è per-cliente

| Motore (identico per tutti) | Per-cliente |
|---|---|
| `src/pages/admin/**` (pannello) | `src/pages/**` pubbliche (home, menu, order…) |
| `src/pages/api/**` (tutte le API) | `src/components/**` pubblici (Layout, Header, Footer…) |
| `src/components/admin/**` | `src/i18n/**` |
| `src/lib/**` + `src/lib/admin/**` | `public/**` (loghi, icone, foto, manifest.json) |
| `supabase/*.sql` (migrazioni) | `src/config/client.ts` (brand) |
| | `src/config/siteImageSlots.ts` (slot immagini del sito) |
| | `src/config/sitePages.ts` (pagine del sito) |
| | `astro.config.mjs` (site URL) |

`src/lib/admin/` contiene le lib usate SOLO dall'admin
(adminAuth, superAdmin, imageCompress, newsletterQuota).
`src/lib/ristorante.ts` fornisce alle email nome/telefono/indirizzo:
legge Réglages → Général con fallback su `client.ts`.

### Dove passa il confine (deciso 06/09/2026)

Il motore è **l'admin e i dati**: quello che il ristoratore può inserire e
cambiare, e le regole che lo governano. **Design, markup, testi e resa del
sito pubblico sono del cliente**: il motore fornisce i dati, non decide come
si vedono.

Il repo del motore contiene comunque un sito pubblico completo, ma serve solo
come **punto di partenza** per il clone di un nuovo cliente. Attenzione: la
protezione `ours` scatta solo quando ENTRAMBI i lati hanno modificato lo
stesso file — finché un cliente non tocca `Header.astro` o `OrderApp.tsx`,
le modifiche del motore gli arrivano lo stesso.

**L'eccezione consapevole è `OrderApp.tsx`.** Non è design: è il flusso
d'ordine (carrello, scelta del formato, chiamata al checkout), la parte dove
si sbaglia un prezzo o si perde un ordine. Sta nel motore come implementazione
di riferimento, e vale la regola:

> Ogni decisione VISIVA di quel componente deve essere una **prop passata
> dalla pagina del cliente** o un **default sovrascrivibile** — mai una scelta
> cablata nel componente.

Esempi già in piedi: `sceltaFormato` (`"pulsanti"` o `"modale"`), `foto`
(`true`/`false`), e le etichette di `i18nMenu.ts`, dove il dizionario passato
dal cliente vince sempre su quello del motore.

Un cliente che vuole un flusso d'ordine tutto suo si tiene la propria copia
del componente — e da quel momento smette di ricevere le correzioni: è una
scelta legittima, ma va fatta sapendo il prezzo.

⚠️ **`OrderApp` è un'isola React**: importa da `src/lib/pricing.ts` e
`src/lib/i18nMenu.ts`, moduli **senza dipendenze**. Non deve MAI importare da
`src/lib/db.ts`, che crea il client Supabase con la **service key**: finirebbe
nel bundle del browser.

## Checklist nuovo cliente

1. **Clona** il repo engine e crea il repo del cliente.
2. **`src/config/client.ts`** — nome, claim, loghi, telefono, email,
   indirizzo, firma email, social di fallback.
3. **`public/`** — loghi SVG, `favicon.svg/ico`, `apple-touch-icon.png`,
   `icon-192.png`/`icon-512.png`, e **`manifest.json`** (campo `name`!).
4. **`astro.config.mjs`** — `site` col dominio del cliente.
5. **Supabase** — nuovo progetto; lancia le migrazioni nell'ordine di
   `supabase/MIGRATIONS.md`; crea i bucket Storage `popups`, `menu`,
   `documents` (pubblici — dalla dashboard se l'insert SQL è bloccato).
   Data API ON, auto-expose OFF (le migrazioni includono i GRANT).
6. **Env** (`.env` locale + host di produzione) — vedi MIGRATIONS.md.
7. **Stripe del cliente** — chiavi live + webhook `checkout.session.completed`
   → `https://<dominio>/api/stripe-webhook`.
8. **Stripe MOODD** — `MOODD_STRIPE_SECRET_KEY` (crediti newsletter,
   incassati da MOODD; nessun webhook).
9. **Resend** — verifica il dominio del cliente (SPF/DKIM), poi `RESEND_FROM`.
10. **Sito pubblico** — design e pagine per-cliente.
11. **Super admin** — l'utente `admin@moodd.online` (in
    `src/lib/admin/superAdmin.ts`) va creato in Supabase Auth; da
    `/admin/super` decide quali pagine vede il cliente.

## Aggiornare i clienti a una nuova versione dell'engine (via MERGE)

Il metodo è il **merge git dal motore**, reso sicuro da `.gitattributes`:
i file per-cliente (brand, pagine pubbliche, loghi, config) sono marcati
`merge=ours`, quindi il merge NON li tocca mai; si fondono solo i file del
motore (admin, api, lib, migrazioni, stili). Niente più copie a mano.

### Come è protetto il brand
`.gitattributes` (nella radice, propagato dal motore) elenca i path
per-cliente con `merge=ours`. Perché il driver funzioni serve, una volta
per repo cliente: `git config merge.ours.driver true` (lo fa lo script).

### Aggiornare TUTTI i clienti in un colpo
Dal repo motore, con i repo cliente clonati in locale:
```
./scripts/sync-clienti.sh --dry   # anteprima: cosa entrerebbe, nessun push
./scripts/sync-clienti.sh         # fetch + merge + push su ogni cliente
```
Lo script salta i clienti già aggiornati o con lavoro non committato, al
primo giro crea da solo il `.gitattributes`, e a fine merge elenca le
**migrazioni Supabase nuove** da lanciare per ciascun cliente (quello resta
manuale: ogni cliente ha il suo Supabase). Aggiungi i nuovi clienti nella
lista `CLIENTI` in cima allo script.

### Aggiornare UN solo cliente a mano
```
cd <repo-cliente>
git config merge.ours.driver true        # solo la prima volta
git fetch engine && git merge engine/main
git push
```

### Regola d'oro (perché i merge restano puliti)
Il cliente non tocca MAI i file del motore, e il motore non mette MAI il
brand nei suoi file. Finché vale questa separazione (la tabella qui sopra),
i merge non generano conflitti. Se un conflitto appare, vuol dire che un
file del motore è stato modificato lato cliente: va riportato nel motore o
ripristinato.

### Nota migrazioni ed env
Le migrazioni sono idempotenti (rilanciarle è sicuro); lanciale sul Supabase
di OGNI cliente dopo il merge. Le env nuove richieste da una versione vanno
aggiunte in `.env` locale + host di produzione (vedi supabase/MIGRATIONS.md).
