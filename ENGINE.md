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

## Breakpoint — la scala del motore (decisa 08/09/2026)

Le variabili CSS **non funzionano dentro `@media`** (`@media (max-width: var(--bp))` non è valido; servirebbe un plugin PostCSS, cioè una dipendenza di build su ogni cliente). Quindi la scala è una **convenzione applicata a mano**, scritta qui e in nessun altro posto.

**Le coppie sono queste, per intero** — non c'è una regola aritmetica da applicare, perché sul confine desktop il numero che conta è la larghezza di un dispositivo vero:

| `max-width` (sotto) | `min-width` (sopra) | confine |
|---|---|---|
| 640 | 641 | mobile ↔ resto |
| 900 | 901 | tablet ↔ desktop |
| **1023** | **1024** | desktop ↔ large |
| 1279 | 1280 | large |

⚠️ **Il confine desktop è 1023/1024, NON 1024/1025.** `1024` è l'**iPad in orizzontale** e deve stare **dalla parte del desktop**: `google.astro` lo dice esplicitamente («Desktop + iPad orizzontale», la regola oggi a `min-width: 1024`), e i FAB a 1024 non devono sollevarsi sopra l'isola nav. Convertendo `max-width: 1023` → `1024` si sposta l'iPad orizzontale dalla parte tablet — errore fatto e corretto l'08/09 su 7 file.

ℹ️ Le regole che danno la **misura** ai pill/bottoni (`fab.css .fab-pill`, `savebar.css .save`) finiscono invece a `max-width: 1024`, quindi a 1024 il dispositivo prende la taglia tablet pur non essendo trattato da tablet per la posizione. Era già così prima: lasciato com'è, non verificabile senza l'iPad in mano.

**Perché queste**: erano già le tre più usate del codice (640 × 40, 900 × 28, 1024 × 16). Non è una scala inventata, è quella che il progetto usava già — ripulita dalle varianti nate caso per caso (520, 560, 600, 620 facevano tutte «mobile» a poca distanza l'una dall'altra, e un elemento che cambiava a 560 col vicino a 620 si rompeva nella fascia in mezzo).

**Eccezioni dichiarate** — hanno una ragione, non sono deviazioni:
- **Home, tile** (`admin/index.astro` e `TileGoogle.astro`): 760 / 920 / 1280. Non è la stessa domanda — lì si decide quanto è larga una *tile*, non quando un testo va a capo. Vive dentro `--cols`.
- **1366** (`orders`, `reservations`, `AdminHeader`): iPad in orizzontale. Regole nate per quel dispositivo preciso.
- **834** (`reservations`): iPad in verticale.
- **1024 / 1025** (`clients`): l'unica pagina in cui l'**iPad in orizzontale sta con i tablet**, non col desktop. Non e' una svista: la riga ha 348px di colonne fisse + 410 con i gap, e con il nome a ~380px su una finestra da 1024 restano **~148px da dividere fra email e telefono**. Il layout desktop li ridurrebbe a due monconi illeggibili. La regola `721-1024` (ricerca in alto, niente email, font piu piccoli) e' scritta apposta per quel dispositivo — lo dice il suo commento. La stessa coppia e' usata da `MQ_TABLET` nel JS delle colonne: CSS e JS devono restare d'accordo.
- **720 / 721** (`clients`): confine fra **tabella** e **schede impilate**, e limite inferiore della regola `721-900` che porta il commento «Tablet in VERTICALE (es. iPad mini 768)». Tarato: a 640 resterebbe una tabella da 7 colonne in ~590px, a 900 l'iPad mini verticale passerebbe a schede. **Non convertire.**
- **760 / 761** (`reservations` modale Nuova prenotazione, `menu` modale piatto/formula): confine due colonne ↔ una. Verificato a schermo l'08/09 e **tenuto così**: il modale è largo 920px, sotto i 760 le due colonne diventano scomode, sopra stanno bene. Portarlo a 900 renderebbe una colonna anche dove due funzionano. È anche il limite inferiore delle due regole iPad qui sopra. `menu.astro` aveva **780** per la stessa identica domanda (due colonne dentro un modale da 940px): allineato a 760 l'08/09, perché due valori diversi per la stessa decisione sono esattamente la deriva che questa scala deve chiudere.
- **1180** (`google`, tab Post): larghezza massima dell'iPad in orizzontale, come 1366. La regola `landscape + 901-1180` dà le colonne 2fr/3fr solo sul tablet.
- **1024 / 1025** (`google`, tab Post): coppia **guardata da `orientation`**. L'iPad orizzontale a 1024 entra dal ramo `landscape + min-width: 901`, quindi non passa a modale; il `1025` serve solo a chiudere il ramo `portrait`. Convertirla a 1023/1024 non cambierebbe nulla per l'iPad e romperebbe la simmetria con `max-width: 900`. **Lasciata.**
- **390** (`MobileNav`): telefono stretto.

⚠️ **Non è un rinominare**: spostare una regola da 520 a 640 cambia il comportamento fra quelle due larghezze. Va fatto **una pagina alla volta, guardandola**, non con una regex a tappeto. `astro check` ed esbuild qui non aiutano: è una modifica puramente visiva.

**Stato della conversione (08/09)**: famiglia **FAB + isola nav** ✅ chiusa in blocco — `fab.css`, `savebar.css`, `AdminNav`, `AdminHead`, `AdminHeader`, `clients`, `index`, `menu`, `orders`, `reservations`. ✅ `google` (560×2 → 640, 999/1000 → 1023/1024, `.g-split` 1000 → 1023). ✅ `clients` (le larghezze delle colonne non stanno piu nei `@media`: le calcola il JS in `--grid-cols`, perche il set visibile dipende anche da una preferenza dell'utente). ✅ `menu` (780 → 760). ✅ `agenda` (tre soglie **tolte**, non convertite: 1024, 520, 720 — legate al contenuto; 780 → 760). ✅ `stats` (1024 → 1023, 560 → 640, `.rkpi-grid` passata a `auto-fit`). ✅ `marketing` (stesso trattamento di `agenda`: `.mtabs` scorrevoli legati al contenuto, `520` e `720` **tolti** passando a `auto-fit`). ✅ `assets` (il `1024` dei tab **tolto**, non convertito). ✅ `super` (1080 → 1024, 560×2 → 640). ✅ `print` (non aveva **nessun** `@media`: era gia legata al contenuto). ✅ `login` e `reset-password` (860 → 900). ✅ `SpecialDaysForm` (soglia **tolta**: gli orari si stringono da soli) e `TileGoogle` (560 → **759**, in coppia con `--cols: 1`). ✅ `settings` (1024 **tolto**, 1100 → 1279, 700×2 · 620 · 560 → 640).

**La conversione è CHIUSA.** Nessuna deviazione residua nel motore: restano solo i valori della scala (640/641, 900/901, 1023/1024, 1279/1280), le eccezioni dichiarate qui sopra e i due `@media (pointer: coarse)` di `settings`, che non sono soglie di larghezza. Le altre in `moodd-admin-avanzamento.md`.
