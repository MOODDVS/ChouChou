# RestoHub — engine multi-cliente

L'admin di questo repo (`/admin`) è **RestoHub**, il pannello multi-cliente
di MOODD per i siti ristorante. Il sito pubblico è per-cliente; l'admin è
il motore riutilizzabile. **Nessun brand è hardcodato nel motore**: tutto
passa da `src/config/client.ts` e da Réglages → Général (app_config).

## Cos'è motore, cos'è per-cliente

| Motore (identico per tutti) | Per-cliente |
|---|---|
| `src/pages/admin/**` (pannello) | `src/pages/**` vetrina (home, menu, order…) — **nel motore non ci sono più: c'è `demo01`** |
| `src/pages/api/**` (tutte le API) | `src/components/**` vetrina (Layout, Header, Footer…) — **idem** |
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

### Il motore non ha un sito (deciso 16/09/2026)

Il motore è **l'admin e le API**. Punto.

Fino a oggi il repo conteneva anche un sito pubblico completo — che era quello
di un cliente vero, testi e fotografie comprese — tenuto come «punto di
partenza» per il clone. Ventuno pagine che nessun altro cliente avrebbe usato
così, degli slot immagine che puntavano a fotografie mai state in questo repo,
e a ogni aggiornamento del motore quelle pagine venivano spinte addosso a tutti.
Un motore che ha un sito non è un motore: è un sito con dentro un pannello.

**Il cliente porta il suo sito.** Il motore deve essere pronto ad accoglierlo,
e questo vuol dire due cose precise: non avere un sito proprio da cui il
cliente debba ripulire, e dichiarare il contratto che il sito deve rispettare.

### I DEMO non sono un modello da clonare

`demo01` — e i prossimi — sono **vetrine di dimostrazione**. Vivono su
`restohub.moodd.online` per far vedere un caso reale a chi guarda, e
**non vanno installate con un cliente**. Al clone si cancellano, tutte insieme:

    src/pages/demo01/        src/components/demo01/        src/layouts/Demo01Layout.astro

Non deve restare niente che le cerchi. Due reti in `tests/motore.test.mjs` lo
difendono: nessun file fuori dai demo li importa, e il motore non prende
decisioni in base al nome di un demo. La seconda è nata da un difetto vero —
il checkout aveva scritto dentro `source === "demo01" ? "/demo01" : undefined`,
e il prefisso del sito ora lo dice la configurazione (`public_site_base`,
letta solo da `lib/basePubblica.ts`).

### Il contratto: cosa deve avere il sito di un cliente

L'admin, Stripe e le email generano link verso queste rotte. Senza, un
pagamento riuscito finisce su un 404 e una recensione non si può lasciare:

| Rotta | Chi ci manda |
|---|---|
| `/order-confirm?session_id=…` | Stripe, dopo il pagamento |
| `/order-cancel` | Stripe, se il cliente rinuncia |
| `/feedback?…` | l'email di richiesta recensione |
| `/menu`, `/order`, … | il sito stesso (libere, vedi `config/sitePages.ts`) |

Se il sito sta sotto un prefisso (`/demo01`), va scritto in
Réglages → `public_site_base`: tutti i link di ritorno lo useranno.

Le rotte che il motore fornisce già — e che non vanno riscritte — sono
dichiarate in `tests/motore.test.mjs`: la coming soon, il manifest, le pagine
legali, l'annullamento di ordine e prenotazione, il widget da incorporare.

### I mattoni riutilizzabili restano

In `src/components/` restano i pezzi neutri che un sito cliente può montare:
`OrderApp`, `SlotPicker`, `ReservationWidget`, `SitePopup`, `LegalDoc`,
`ContactForm`, `CookieBanner`.

⚠️ **`OrderApp` e `SlotPicker` non sono montati da nessuna pagina del motore.**
È una scelta consapevole: restano come implementazione di riferimento del
flusso d'ordine, ma nessuna pagina li esercita, quindi possono rompersi senza
che niente diventi rosso. Chi li tocca li prova a mano.

Attenzione al merge: la protezione `ours` scatta solo quando ENTRAMBI i lati
hanno modificato lo stesso file — finché un cliente non tocca `OrderApp.tsx`,
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

0. **Da quale ramo: `main`, e basta.** Il multi-sede è dentro `main` dal
   03/10/2026, il ramo `multi-sede` ha finito il suo lavoro ed è stato
   chiuso: tenerlo vivo accanto a `main` voleva dire due verità su quale sia
   il motore buono, e un giorno dimenticare di allinearle. Il tag
   `single-location` segna l'ultimo motore a sede unica, prima di tutto
   questo: è un archivio, non un punto di partenza — non ha le correzioni
   venute dopo.

1. **Clona** il repo engine e crea il repo del cliente. Poi **cancella i
   demo**, che sono vetrine di MOODD e non vanno installate da un cliente:

       rm -rf src/pages/demo01 src/components/demo01 src/layouts/Demo01Layout.astro

   Non deve restare niente che li cerchi (`tests/motore.test.mjs` lo
   verifica). ⚠️ Il motore **non ha un sito**: il clone ti dà l'admin, le API
   e le rotte funzionali, non delle pagine vetrina da ripulire.
2. **`src/config/client.ts`** — nome, claim, loghi, telefono, email,
   indirizzo, firma email, social di fallback. ⚠️ **Va compilato davvero**:
   ChouChou è andato in linea col segnaposto del motore dentro. È l'unico
   posto del codice dove i recapiti possono stare — ovunque altro nel sito
   li vieta `tests/recapiti.test.mjs`, e il motivo sta in fondo a questo
   file.
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
10. **Sito pubblico** — design e pagine per-cliente, da zero. Le rotte che
    l'admin, Stripe e le email si aspettano sono nella tabella «Il contratto»
    più sopra: senza `/order-confirm` un pagamento riuscito finisce su un 404.
    Se il sito sta sotto un prefisso, va scritto in `public_site_base`.

11. **Multi-sede (solo se ne ha più di uno)** — lancia `supabase/locations.sql`
    e crea le sedi da `/admin/super` → Sedi. ⚠️ Un cliente con UN punto solo
    **non deve creare nessuna sede**: tabella `locations` vuota vuol dire
    nessun filtro, cioè esattamente il comportamento di sempre. La sede si
    crea il giorno che ne arriva una seconda.
    Sul sito, ogni chiamata al motore porta il punto: header `x-sede` o
    `?sede=<id>` (vedi `reservation-embed.astro`).
12. **Super admin** — l'utente `admin@moodd.online` (in
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
manuale: ogni cliente ha il suo Supabase). Avvisa anche quando `package.json`
è cambiato, perché allora serve `npm install` nel repo cliente.

⚠️ **La lista `CLIENTI` in cima allo script è la sola fonte.** Un cliente che
non è in lista non viene mergiato **e non compare nel riepilogo**: il giro
sembra riuscito e quel cliente resta indietro. Il 12/09 mancavano L'Huile
(mergiato a mano da sessioni) ed EN v2. Quando si aggiunge un cliente, si
aggiunge lì lo stesso giorno.

### Aggiornare UN solo cliente a mano
```
cd <repo-cliente>
git config merge.ours.driver true        # solo la prima volta
git fetch engine && git merge engine/main
git push
```

### Quando un conflitto è un sintomo, non un incidente
Il 12/09 due clienti su quattro hanno dato conflitto su `tsconfig.json`: il
motore aveva aggiunto `_to_delete` agli `exclude`, La Molisana ci aveva messo
`build` e L'Huile `build` + `_backup` — cartelle di lavoro loro. Stessa riga,
due parti, conflitto.

La correzione NON è stata risolvere il conflitto: è stata **mettere tutti e
quattro gli exclude nel motore**, così nessun cliente ha più motivo di toccare
quel file. Un conflitto ripetuto sullo stesso file del motore va letto come
«manca qualcosa nel motore», non come sfortuna.

### Regola d'oro (perché i merge restano puliti)
Il cliente non tocca MAI i file del motore, e il motore non mette MAI il
brand nei suoi file. Finché vale questa separazione (la tabella qui sopra),
i merge non generano conflitti. Se un conflitto appare, vuol dire che un
file del motore è stato modificato lato cliente: va riportato nel motore o
ripristinato.

### `package.json` NON si rebrandizza
Il campo `name` (`restohub-admin`) è metadato interno di npm: non compare da
nessuna parte, né per il ristoratore né per i suoi clienti. Se un cliente lo
cambia, il `package-lock.json` porta quel nome in due punti, il merge lo
riporta a quello del motore e il primo `npm install` lo riscrive indietro:
il repo resta sporco e al giro dopo `sync-clienti.sh` lo salta. La Molisana ci
è passata due volte il 12/09 prima che si capisse.

### L'ordine giusto: merge PRIMA, `npm install` DOPO
`npm install` riscrive il `package-lock.json` anche quando non cambia nulla di
sostanziale. Se lo si lancia **prima** del merge, il repo cliente risulta
sporco e `sync-clienti.sh` lo **salta** — giustamente, per non mergiare sopra
del lavoro non salvato. Succede allo stesso modo se si rilancia il sync dopo
un install.

Se un cliente viene saltato, la prima cosa da guardare è quella:
```
git -C <repo-cliente> status --short
```
Se l'unica riga è ` M package-lock.json`, si scarta (`git checkout --
package-lock.json`) e si rilancia il sync: la versione buona arriva dal
motore. Se compare un file sotto `src/`, no: lì c'è del lavoro vero da
salvare prima.

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

## Modali — la struttura unica (decisa 11/09/2026)

Riferimento visivo: il modale d'acquisto della pagina **Stampa**. Ogni modale
dell'admin deve avere questa forma, e la forma sta in **un posto solo**.

**Dove vive.** `src/styles/modal.css` (classi `.md-*`), importato una volta da
`AdminHead` → vale su ogni pagina admin. Il guscio in markup è
`src/components/admin/Modal.astro`.

```
.md-overlay            fondo scuro + centratura
  .md-back             sfondo cliccabile (chiude)
  .md-box              la scatola, angoli 16px
    .md-head           titolo + ×, filetto sotto  — MAI scorre
    .md-body           il contenuto               — scorre lui
    .md-foot           i bottoni, filetto sopra   — MAI scorre
```

**Header e footer restano fermi per COSTRUZIONE, non con `position: sticky`**:
la scatola è un flex in colonna, loro sono `flex: 0 0 auto`, il corpo è l'unico
con `overflow-y: auto` (e `min-height: 0`, senza il quale un flex item non
scende sotto il suo contenuto e spinge fuori header e footer). Niente z-index
da governare, niente filetti che sbavano sugli angoli arrotondati.

**Larghezza**: si cambia con `--md-w` sul `.md-box` (default 600px), MAI con una
classe nuova per ogni misura → `<Modal width="900px">`.

**Bottoni**: `.md-btn` e `.md-btn.md-btn-primary`. La coppia «annulla /
conferma» è sempre la stessa.

**Le uniche cose che cambiano per formato** (tutto il resto è identico):

| | Titolo | Header | Body | Footer |
|---|---|---|---|---|
| desktop | 1.5rem | 1.4/1.6/1rem | 1.3/1.6rem | 1/1.6/1.4rem |
| tablet ≤1023 | 1.3rem | 1.05/1.25/0.85rem | 1.05/1.25rem | 0.85/1.25/1.05rem |
| mobile ≤640 | 1.12rem | 0.85/1/0.7rem | 0.9/1rem | 0.7/1/0.85rem |

**Chiusura**: la pagina aggancia `[data-md-close]` (sfondo, ×, Annulla). Il
guscio non porta JS proprio, così ogni pagina resta padrona del suo stato
(reset dei campi, blocco dello scroll del body).

**Le regole `.md-*` non hanno `!important`**: sono la base. Una pagina che deve
deviare lo fa col suo `<style>` scoped, che vince nella cascata.

✅ **La conversione è FINITA (12/09/2026).** Nessun modale admin usa più il
guscio fatto a mano: `.overlay`, `.modal`, `.m-close`, `.m-actions`, `.m-save`
sono spariti da tutte le pagine, e con loro il blocco di compatibilità in fondo
a `modal.css` — che era pieno di `!important` per battere gli stili scoped.
Resta fuori solo `ImagePicker`, che ha un guscio TUTTO SUO (`.imgpick-*`), mai
stato `.overlay`.

⚠️ **Il secondo inciampo di ogni conversione**: le pagine hanno regole
agganciate a `.modal` — tipicamente `.modal input, .modal textarea { … }`. Un
modale convertito non ha più quella classe (è `.md-box`), e i suoi campi
tornano al bianco di sistema. Finché convivono le due forme, quei selettori
vanno scritti **in coppia**: `.modal input, .md-box input { … }`. Succede anche
ai controlli «c'è un modale aperto?» — vedi sotto.

⚠️ **Finché convivono due meccaniche** (`.is-open` sui vecchi, `hidden` sui
nuovi), ogni controllo del tipo «c'è un modale aperto?» deve guardare
**entrambe**: `document.querySelector(".overlay.is-open, .md-overlay:not([hidden])")`.
In Prenotazioni quel controllo ferma il refresh automatico della lista:
dimenticarlo significa ricaricare la pagina sotto le mani di chi sta
compilando un modale.

**Pagine FINITE** (nessun `.overlay` rimasto, CSS del guscio vecchio tolto):
TUTTE: `reservations` · `assets` · `marketing` · `settings` · `orders` ·
`clients` · `index` · `agenda` · `menu`.
Chiudere una pagina vuol dire anche togliere `.overlay`, `.modal`, `.m-close`,
`.m-actions` e il ramo `.overlay.is-open` dei controlli «modale aperto».

**Convertiti altrove**: `print` (acquisto) · `index` (Tuiles, Giorni speciali,
Note) · `agenda` (evento) · `orders` (nuovo ordine) · `clients` (attività
cliente, modifica/aggiungi) · `menu` (piatto, sezioni) · `super` (nuovo utente)
· `settings` (piantina della sala, contatto team, documento — pagina CHIUSA).
**FINITO.** `ImagePicker` era l'ultimo e il 12/09 e' passato anche lui: non
esiste piu' un modale admin fuori dal guscio condiviso.

⚠️ **Un modale che si apre DA un altro modale** (la libreria immagini) deve
stare sopra il `z-index: 400` di `.md-overlay`, e non puo' affidarsi all'ordine
nel DOM: il componente e' incluso in punti diversi da pagina a pagina. La
libreria dichiara `z-index: 440` su `#imgpick-overlay`. Stessa famiglia di
trappola dei riquadri flottanti della piantina.

🧹 **Codice morto rimasto** (non urgente): `.m-actions` / `.m-cancel` in
`reservations.astro` non aggancia piu' niente.

⚠️ **Prima di convertire un modale, controllare che sia VIVO.** L'«aggiungi
cliente» di Clienti non si apriva piu' da quando creazione e modifica sono la
stessa finestra: nessuno chiamava `add("is-open")`. Convertirlo sarebbe stato
lavoro su codice morto. Il controllo e' una riga: cercare chi lo APRE, non chi
lo chiude.
`google` non e' in elenco: non ha modali, il pannello e' in pagina.

⚠️ **Anteprima PDF**: la fa `src/lib/admin/pdfThumb.ts`, importata dalle
pagine. pdf.js sta nel progetto (`import()` dinamico, servito da 'self'): la
CSP dell'admin blocca qualsiasi `<script>` da CDN, e il ripiego sull'icona e'
silenzioso — un'anteprima che non c'e' non e' distinguibile da un PDF
protetto. Se serve una miniatura da un'altra pagina, si importa il modulo:
**non si ricopia la funzione**, perche' e' esattamente cosi' che il guasto e'
sopravvissuto alla prima correzione.

⚠️ **Se il modale ha riquadri flottanti** (`position: fixed`) — la piantina ha
i due pannelli che seguono il tavolo selezionato — il loro `z-index` va portato
**sopra il 400 del `.md-overlay`**. Il guscio vecchio stava a 300 e un 60
bastava: convertendo, quei pannelli spariscono dietro il modale.

⚠️ **Se il contenuto deve riempire la finestra invece di adattarsi** (una
piantina, una tela), non basta dare l'altezza al `.md-box`: il `.md-body` va
messo a `display: flex; flex-direction: column` e il figlio a
`flex: 1 1 auto; min-height: 0`. Altrimenti il figlio resta alto quanto il suo
contenuto e ogni `height: 100%` o container query dentro di lui misura zero.

## Interruttori — il componente unico (deciso 11/09/2026)

**Dove vive.** `src/styles/switch.css`, importato una volta da `AdminHead` →
vale su ogni pagina admin. Non c'è un componente `.astro`: la struttura è tre
tag, il valore sta tutto nel CSS.

```html
<label class="switch">
  <input type="checkbox" />
  <span class="track"></span>
</label>
```

Con etichetta: `<span class="sw-wrap"><label class="switch">…</label><span class="sw-lab">Attivo</span></span>`

**Se lo stato non è un checkbox** — succede dove è cliccabile la riga intera —
si mette `is-on` sul `.switch`: fa esattamente quello che fa `input:checked`.

**Misura**: `--sw-w` / `--sw-h` / `--sw-k` sul `.switch`, MAI una classe nuova
per ogni taglia. `.switch-sm` (40×22) è l'unica scorciatoia, per le liste fitte.

**Le tre cose che erano disegnate male e qui sono risolte:**

1. **La pallina si centra con `top: 50%` + `translateY(-50%)`**, non con un
   `top` fisso: era quello a farla sembrare storta appena l'altezza cambiava.
2. **Lo spento ha il fondo PIENO**, ricavato dal colore del testo mescolato al
   fondo (`color-mix`). Un token fisso (`--c-line`, `--c-input`) sparisce
   appena il cliente cambia tema — ed è esattamente quello che era successo.
   Niente bordo: il bordo lo faceva sembrare un campo da compilare.
3. **L'input copre tutto l'interruttore** (`inset: 0`), non `width: 0`: il
   tocco prende ovunque, bordi compresi.

⚠️ **La conversione è IN CORSO, una pagina alla volta.** Le pagine non ancora
passate hanno la loro copia di `.switch` nel `<style>` scoped, che vince nella
cascata: si toglie quella copia e la pagina eredita il componente.
Fatti: **Home** (tile Tuiles), **SpecialDaysForm** (servizi) e
**reservations** (`.sv-switch`).
**Se l'interruttore è un `<button role="switch">`** — dove la riga non ha una
label propria e il bottone È il comando — lo stato lo porta `aria-checked`, che
serve già all'accessibilità: il componente lo legge direttamente, senza
duplicarlo in una classe che sarebbe una seconda verità da tenere allineata.

Fatti **tutti** (17/09/2026). Le ultime tre sono state `google`, `settings`
e `super`, che avevano ancora la loro copia nel `<style>` scoped e quindi
vincevano sulla cascata: la correzione dello spento fatta in `switch.css` non
le raggiungeva, e si e' visto su 450 Gradi — tema diverso, spento sbiadito.

Chi ha bisogno di una taglia diversa la dichiara con le **variabili**
(`--sw-w` / `--sw-h` / `--sw-k`), che non sono una ridefinizione ma il modo
previsto: `google` 38×21, `settings` e `menu` 44×24, la riga annidata di
`super` 34×19.

⚠️ Una rete in `tests/motore.test.mjs` fallisce se una pagina admin torna a
ridisegnare `.switch .track` in casa propria. Non e' pedanteria: quel difetto
non si vede sul tema di chi scrive il codice, si vede sul tema di un cliente,
mesi dopo.

## Campi — il componente unico (deciso 11/09/2026)

### L'intorno del campo: etichetta, riga, nota (13/09/2026)

`field.css` vestiva la **casella** ma non quello che ci sta intorno. `.f-field`
e `.f-label` erano riscritte dentro cinque pagine, e in un modale nuovo non
esistevano affatto: l'etichetta usciva grande come il testo e senza spazio fra
un campo e l'altro. Adesso stanno nel foglio condiviso.

```html
<div class="f-field">
  <label class="f-label" for="x">Nome</label>
  <input type="text" id="x" />
</div>
<p class="f-note">Spiegazione che si attacca al campo di sopra.</p>

<div class="f-line">
  <div class="f-field">…</div>
  <div class="f-field">…</div>
</div>
```

`.f-line` mette lo spazio sotto **lui**, non i campi: due campi affiancati ne
accumulerebbero due. Sotto i 520px vanno a capo da soli.

⚠️ In `agenda` esistono gia' `.f-row` e `.f-hint` con un altro significato
(griglia 1fr 1fr, nota da 0.72rem). I nomi condivisi sono `.f-line` e `.f-note`
apposta, per non scontrarsi con quelli.

⚠️ `menu` e `reservations` tengono un `.f-field` proprio: li' i campi stanno in
riga, si dividono lo spazio e non hanno margine sotto. **Non e' una copia della
regola condivisa, e' una specializzazione sopra di essa** — e nel file c'e'
scritto, cosi' la prossima pulizia non la scambia per debito.

Restano da migrare i modali che si sono scritti la loro riga di campi
(`dc-row` in Impostazioni, `us-frow` nel super, `ed-row` in Clienti): si fanno
quando si tocca quel modale, non tutti insieme.

**Dove vive.** `src/styles/field.css`, importato una volta da `AdminHead` →
vale su ogni pagina admin.

**Dentro un modale del guscio condiviso non serve nessuna classe**: `input`,
`textarea` e `select` dentro `.md-box` prendono la grafica da soli. Fuori dai
modali si mette `.fld` sul campo.

```
fondo    var(--c-card)   — lo stesso delle card (riga prenotazione, tile, sezioni)
bordo    nessuno         — 1px transparent, diventa corallo sul focus
angoli   6px
```

**Il fondo è quello delle card, e non è un caso**: una casella da riempire e una
card sono tutte e due un piano rialzato rispetto al fondo, quindi devono stare
alla stessa altezza. Cambiando tema si muovono insieme.

**Il bordo a riposo è `1px solid transparent`, non `border: 0`**: così quando
prende il fuoco e diventa corallo l'altezza non salta di due pixel.

⚠️ **Il selettore dei modali è volutamente lungo** (`.md-overlay .md-box …`).
Le pagine si erano scritte le loro copie con la stessa specificità (`.md-box
input { … }`): chi vince dipenderebbe dall'ordine in cui il bundle le mette,
cioè dal caso. Con un selettore più forte «uguale in ogni modale» è vero
davvero, e le copie locali si tolgono con calma pagina per pagina — finché ci
sono non fanno danno, sono codice morto. Tolte in `clients`.

⚠️ **Mai la scorciatoia `background`**, solo `background-color`: la scorciatoia
azzererebbe la freccia disegnata dei `select`.

⚠️ **Il corpo del testo resta 0.95rem anche su mobile.** Sotto i 16px Safari
iOS ingrandisce la pagina al primo tocco nel campo e il modale finisce fuori
schermo: lì rimpicciolire fa danno.

⚠️ **Checkbox, radio, file, range, color e hidden sono esclusi** dal selettore:
hanno una grafica loro. Fra questi c'è anche l'input invisibile di `.switch`,
che senza l'esclusione si sarebbe ritrovato un fondo.

## Bottoni — il componente unico (deciso 11/09/2026)

**Dove vive.** `src/styles/button.css`, importato una volta da `AdminHead`.

`.btn` è il bottone d'azione DENTRO un modale o una scheda: «Carica una foto»,
«Libreria», «Rimuovi», «+ Aggiungi una variante». Neutro: non chiede
l'attenzione che spetta al bottone di conferma.

```html
<button type="button" class="btn">Carica una foto</button>
<button type="button" class="btn btn-danger">Rimuovi</button>
<button type="button" class="btn btn-sm">+ Variante</button>
```

**Non sostituisce `.md-btn`** di `modal.css`: quello è la coppia «annulla /
conferma» del footer. `.btn` è tutto il resto, che ogni pagina si era
riscritto a modo suo (`.ed-pill`, `.sec-btn`, `.f-img-btn`, `.ed-upl`,
`.pill`, `.m-ghost`…).

Fondo `--c-card` come i campi — bottone e casella sono tutti e due un piano
rialzato sul fondo del modale. `.btn-danger` è grigio a riposo e rosso solo al
passaggio: rosso fisso sembra un allarme sempre acceso.

**Regola dei colori nel footer**: UN SOLO bottone corallo per modale, ed è la
conferma. Se un'azione facoltativa sta in mezzo al form, è `.btn`.

**Ordine dei bottoni**: azioni leggere a sinistra, conferma in fondo a destra.
Non è solo estetica — in Newsletter «Invia a tutti» stava dove negli altri
modali c'è «Annulla».

### `.ibtn` — la coppia modifica / elimina (13/09/2026)

Tondo, 34px, una sola icona. E' quello in fondo a ogni card e a ogni riga.

```html
<button type="button" class="ibtn" title="Modifica">✎</button>
<button type="button" class="ibtn ibtn-danger" title="Elimina">🗑</button>
```

`.ibtn-danger.confirm` e' il secondo tempo della cancellazione: la pillola si
allarga per contenere «Confermare?». Si usa insieme a `conAttesa()`.

⚠️ Era riscritto in **otto pagine** con otto nomi diversi — `.i-btn` (Google),
`.dc-btn` (Impostazioni), `.b-edit` (Prenotazioni), `.ntile-btn` (Home),
`.loc-btn`, `.r-del`, `.i-del`… tutti da 34px e tutti leggermente diversi nel
bordo. **Al 13/09 e' convertito solo il super admin**: le altre si convertono
quando si tocca quella pagina, come per i messaggi d'errore delle API.

👉 **Ordine nella riga azioni**: lo stato a sinistra (l'interruttore
attiva/disattiva), le azioni a destra. Si legge da «che cos'e' questo oggetto»
a «che cosa posso farci».

### `.is-loading` — la rotella dentro il bottone (12/09/2026)

Stesso foglio, stessa disponibilità ovunque. Si mette sul bottone che ha appena
fatto partire una richiesta: l'etichetta sparisce, al suo posto gira una rotella.

```ts
btn.classList.add("is-loading");
try { … } finally { btn.classList.remove("is-loading"); }
```

⚠️ **`disabled` da solo non è un segnale.** Un bottone spento sembra un click
che non è stato registrato: chi lo usa riclicca. Vale per ogni attesa che possa
superare il mezzo secondo — un upload, un invio, un salvataggio su rete mobile.

Era riscritto identico in sei pagine (agenda, assets, clients, marketing, menu,
settings) e mancava proprio dove serviva di più, il caricamento di un PDF da
10 MB nei Documenti. `:not(.fab-add)` c'è perché il FAB è già `position: fixed`.

**Per le cancellazioni si usa `conAttesa()`** (`src/lib/admin/attesa.ts`), che
mette la rotella, disabilita il bottone e — soprattutto — **ignora i click
successivi** finché la richiesta è in volo:

```ts
await conAttesa(del, async () => {
  const res = await fetch(…, { method: "POST", headers: { …, "X-Method-Override": "DELETE" } });
  …
});
```

Il cestino a due tempi non basta: il secondo tap parte, e da lì in poi non
succede più niente di visibile. Tre secondi in sala diventano cinque click e
cinque DELETE. `conAttesa` misura il bottone e usa la rotella piccola
(`.is-loading-sm`) sui cestini tondi da 34px.

Coperte **tutte** le cancellazioni dell'admin (12/09): documenti, team e tavoli
della piantina in Impostazioni; documenti e immagini in Assets; clienti; piatti,
lunch, menù fissi e sezioni in Menu; buoni sconto, buoni regalo e newsletter
programmate in Marketing; prenotazioni e chiusure future in Prenotazioni;
agenda; risposte, post e foto in Google; utenti nel super admin.

Due note di merito:

- in **Prenotazioni** il modale non si chiude più subito: resta aperto con la
  rotella finché il server non ha risposto. Chiuderlo prima lasciava la lista
  invariata per qualche secondo, e sembrava che non fosse successo niente;
- in **Menu**, cancellare una sezione sono DUE giri di rete (prima salva le
  modifiche in sospeso, poi elimina): è il punto dove l'attesa è più lunga.

## Test unitari (decisi 11/09/2026)

`tests/*.test.mjs`, lanciati con `node --test tests/<file>.test.mjs`. Nessuna
dipendenza: solo `node:test` e `node:assert`.

⚠️ **Le funzioni sotto test si copiano VERBATIM dal codice vero.** Riscriverle
«equivalenti» fa passare il test su codice rotto: è successo con `esc()` nella
pagina Ordini, dove lo stub faceva `String(x)` e il codice vero no.

Servono per la logica pura: nomi di file, calcoli di finestre e capienza,
macchine a stati (il cestino a due tempi). Non sostituiscono `astro check`,
che resta l'unico a vedere gli identificatori non dichiarati.

⚠️ **Un modulo che lancia all'import non e' testabile.** `db.ts` pretende
SUPABASE_URL e SUPABASE_SERVICE_KEY e lancia se mancano; Astro gliele passa,
vitest no (Vite espone a `import.meta.env` solo le `VITE_*`). `slots.ts` lo
importava in cima, e `slots.test.ts` — **16 test** — non e' partito per mesi
senza che nessuno se ne accorgesse: vitest segnava «0 test», non un errore
rosso. Il client Supabase ora si carica dentro la funzione che lo usa.
Regola: un file di calcolo puro non importa `./db` in cima.

⚠️ **«0 test» in un file va letto come un fallimento**, non come «non c'e'
niente da fare».

## Letture dal database — le mille righe (decisa 12/09/2026)

**PostgREST rende al massimo 1000 righe per richiesta.** Una `select()` senza
`.range()` si ferma lì **senza errore e senza avviso**: il dato arriva
troncato e sembra completo. L'unico indizio è un numero tondo.

Ogni lettura che può superare la soglia va fatta a pagine. Lo schema è
`ordiniPagati` in `src/lib/admin/calcolaStats.ts`:

```ts
const PAGINA = 1000;
const tutti: Riga[] = [];
for (let da = 0; ; da += PAGINA) {
  const { data, error } = await supabaseAdmin.from("t").select("…").range(da, da + PAGINA - 1);
  if (error) break;
  tutti.push(...(data ?? []));
  if (!data || data.length < PAGINA) break;
}
```

Vale anche per le letture che sembrano «di servizio»: l'insieme degli id già
noti delle recensioni Google era troncato, e oltre le mille recensioni faceva
risultare NUOVE delle recensioni vecchie — con notifica push al ristoratore.

## Una cosa sola, in un posto solo

Tre guasti della sessione del 12/09 avevano la stessa forma: **due copie della
stessa logica, corretta in una sola**. L'anteprima PDF (giusta in Assets, rotta
in Impostazioni per settimane), il rosso del secondo tempo su «Invia a tutti»
(la regola CSS puntava a una classe sparita in una conversione precedente), e
le statistiche (due file gemelli da 180 righe, non ancora divergenti).

⚠️ **Un commento che dice «se cambi qui, aggiorna anche là» non è una
protezione: è la descrizione di un guasto che deve ancora succedere.** Se una
funzione serve a due pagine, va in `src/lib/admin/` e la si importa.

Quarto caso, 12/09: la **disconnessione**, quattro righe copiate in 13 pagine.
`supabaseBrowser.auth.signOut()` revoca la sessione su tutti i dispositivi e per
farlo fa un giro di rete; il codice lo *aspettava* prima di andare al login. Con
la rete lenta il bottone restava immobile per secondi e sembrava rotto — guasto
intermittente, quindi invisibile. Ora tutto sta in `src/lib/admin/logout.ts`:
revoca globale in sottofondo (`fetch` con `keepalive`, sopravvive al cambio
pagina), sessione locale tolta subito senza rete, redirect immediato.

👉 La regola generale che ne esce: **niente rete tra un clic e il suo effetto
visibile.** Se il server deve sapere qualcosa, glielo si dice in sottofondo.

Stesso giorno, stessa forma, terzo posto: il **caricamento di un PDF**. Il
documento era salvato dopo la prima chiamata, ma il modale restava aperto ad
aspettare la miniatura — cioe' il download di pdf.js e il disegno della pagina.
Per chi guardava era il caricamento a essere lentissimo, e un PDF da 530 KB
sembrava rotto. Ora la miniatura parte quando si SCEGLIE il file (mentre si
sceglie la categoria, pdf.js si carica), il modale si chiude appena il
documento e' salvato, e la miniatura sostituisce l'icona quando e' pronta.

👉 Corollario: **quello che e' cosmetico non sta sul percorso critico.** Se il
lavoro e' finito, l'interfaccia lo dice subito; il resto arriva dopo.


## Astro 7 — `Astro` va nominato nel frontmatter (scoperto 12/09/2026)

Dalla 7 il compilatore è scritto in Rust, ed è molto più severo di quello
vecchio: **crea il binding `Astro` dentro il componente solo se il frontmatter
lo nomina davvero.** Se `Astro` compare unicamente nel template, il file
compila, `astro check` passa, `npm run build` passa — e a runtime la pagina
muore con `ReferenceError: Astro is not defined`.

Il nostro caso: `nonce={Astro.locals.cspNonce}` sui `<script is:inline>` di
`AdminHead`, `login` e `reset-password`. Nominarlo in un *commento* del
frontmatter non basta: il compilatore analizza il codice, non il testo.

✅ La forma sicura, sempre:

```astro
---
const nonce = Astro.locals.cspNonce;   // letto nel frontmatter
---
<script is:inline nonce={nonce}>…</script>
```

Per trovarli tutti: cercare i `.astro` in cui `Astro` compare nel template ma
non nel frontmatter (commenti esclusi). Al 12/09 nel motore sono zero.

## Multi-sede — il filtro passa da un punto solo (deciso 13/09/2026)

**Dove vive.** `src/lib/admin/sedeRegole.ts` (le regole, senza un solo import)
e `src/lib/admin/sede.ts` (l'applicazione). I test sono in `tests/sede.test.mjs`
e girano **sulla funzione vera**, non su una copia: è il motivo per cui le
regole stanno in un file che non importa niente.

**La regola di fondo**: `location_id` NULL significa «vale per tutte le sedi».
Le righe che esistono oggi sono tutte a NULL, quindi per un cliente con un
punto solo la verità è già nel dato e non serve nessun filtro.

`CLASSIFICA` dice a chi appartiene ogni tabella — `marchio`, `sede`, `mista` —
e una tabella che non è lì dentro **lancia un errore**, non passa non filtrata.
Un test scorre `src/` e verifica che ogni tabella davvero letta sia dichiarata.

```ts
const ambito = await ambitoDi({ sedeUtente, sedeScelta });
const { data } = await leggi("orders", ambito, "id, total_cents").order("created_at");
```

`leggi`, `inserisci`, `aggiorna` e `cancella` restituiscono query che il filtro
ce l'hanno **già dentro**. Non è una convenzione da ricordare: non esiste un
modo di ottenerle senza. `aggiorna` e `cancella` sono filtrati come le letture —
passando l'id di una riga di un altro punto, quella riga non viene toccata.

⚠️ **Tre cose da non confondere, perché si somigliano e non sono la stessa.**

1. **NULL in una riga** («vale per tutte le sedi») non è **la richiesta di
   tutte le sedi**. Hanno due nomi diversi apposta: `"marchio"` e
   `{ modo: "tutte" }`. Se si scrivessero uguale, una query a cui per sbaglio
   non arriva la sede diventerebbe indistinguibile da un aggregato legittimo.
2. **L'aggregato si chiede per nome**, con `tutteLeSedi()`, mai lasciando vuoto
   un parametro. Leggendo il codice si deve vedere che qualcuno l'ha chiesto.
3. **La sede arriva dalla sessione**, da `app_metadata` dentro il JWT firmato,
   **mai da un parametro mandato dal client**: quello lo sceglie il browser.

**E l'id di sede si valida sempre** (`sede(id)` lo fa): finisce dentro
un'espressione di filtro PostgREST, che è testo. Un id non validato è
un'iniezione nel filtro, non un valore sbagliato.

👉 Il motivo di tutta questa disciplina: `supabaseAdmin` usa la service role key
e **scavalca la RLS**. Sotto al codice non c'è nessuna rete di sicurezza, e un
filtro dimenticato non dà errore — dà le righe di un'altra società. È il
contrario del guasto di Astro 7, che almeno faceva morire la pagina.

### Due assi, non una scala di ruoli (deciso 13/09/2026)

Verrebbe naturale, col multi-sede, aggiungere un ruolo «manager» fra `admin` e
`user`. **Non si fa.** Sono due domande indipendenti:

| | dove vive | risponde a |
|---|---|---|
| `role` (`super` / `admin` / `user`) | `app_metadata.role` | **cosa** puoi fare |
| sede | `app_metadata.location_id` | **dove** puoi farlo |

Un «manager» non e' un ruolo: e' un `admin` con una sede addosso. Impilare i
due assi in una scala sola li schiaccia da matrice 2×2 a riga, e le caselle che
restano fuori arrivano subito: il contabile del gruppo (solo Statistiche, ma
tutte e tre le sedi) non ha piu' un posto, e un responsabile a cui non vuoi
dare il Marketing richiederebbe un quinto livello.

E il timore che sta dietro alla richiesta — «un responsabile non deve toccare
la roba del marchio» — **non si risolve con un permesso, e' gia' risolto dalla
forma della scrittura**: `sedeDaScrivere` non rende mai `null` per un ambito di
sede. Chi e' legato a un punto scrive righe di quel punto e basta. Non e' un
controllo che qualcuno puo' dimenticare di mettere: e' che la scrittura non ha
la forma per fare il danno.

⚠️ Quello che manca davvero e che **non c'entra col multi-sede**: gli
interruttori delle pagine in Réglages sono **globali per l'installazione**, non
per persona, e `user` significa «admin meno `PAGINE_SOLO_ADMIN`», una lista
fissa nel codice. Permessi per utente servirebbero anche a un ristorante con un
locale solo. Lavoro suo, da fare dopo.

### Chi installa e chi possiede (deciso 13/09, rivisto il 14/09/2026)

La scheda **Sedi** vive in `/admin/super`, dove il ristoratore non entra. Ne
segue una regola secca su dove va ogni campo:

> Nel modale della sede sta quello che **MOODD installa** — nome, slug, foto,
> fuso, ordine, chiavi Stripe. In Réglages → Général e in Intégrations sta
> quello che **il ristoratore possiede**.

E su quest'ultimo, la regola e' ancora piu' semplice:

> **Con una sede selezionata, Général e' tutto suo.** Ogni sede ha la sua
> scheda, come se fosse un ristorante solo — perche' e' esattamente quello che
> e'.

⚠️ **Si era provata la strada opposta e non regge.** L'idea era: condiviso per
difetto, con un'eccezione per campo (una catena cliccabile accanto a ogni
etichetta). Cade su un fatto: un gruppo non e' per forza un marchio. Puo'
avere tre nomi, tre loghi e tre identita' diverse, quindi **non esiste nessun
elenco di «cose che di sicuro valgono per tutti»** che sia vero anche per il
cliente dopo. E l'asimmetria degli errori decide da sola: dividere un campo
che poteva restare condiviso costa riscrivere «Belgio» tre volte; NON dividere
un campo che andava diviso cambia l'indirizzo di un punto e lo cambia a tutti,
in silenzio. Fra una scocciatura e un guasto invisibile si sceglie sempre la
scocciatura.

**Come sta in piedi, in pratica.** `app_config` sono i valori
dell'INSTALLAZIONE; `location_config` quelli della sede, stessa forma
chiave/valore e le stesse chiavi (`company_street`, `public_phone`, …), cosi'
Général non impara niente di nuovo.

- **In lettura** i due strati si sovrappongono, e serve a una cosa sola: una
  sede che non ha ancora salvato niente parte con i campi gia' pieni invece
  che con un modulo vuoto.
- **In scrittura** non si sovrappone niente: con una sede selezionata tutto
  quello che si salva finisce in `location_config`. A sede unica — i quattro
  clienti di oggi — si scrive `app_config`, come e' sempre stato.

⚠️ E il rovescio della chiave/valore: una chiave scritta male non esplode,
**ricade** sul valore dell'installazione. `company_steet` non da' errore,
rende l'indirizzo di un altro. La difesa e' la whitelist `CHIAVI_GENERAL` che
`settings.ts` ha gia': la scrittura per sede ci deve passare dentro.

**A che livello sta ogni scheda** (deciso 14/09/2026). La scelta e' per SCHEDA,
non per campo — di una scheda si sa cosa contiene, e non cambia da cliente a
cliente:

| Scheda | Livello | Perche' |
|---|---|---|
| Général | sede | indirizzo, societa', IVA, IBAN: di quel punto |
| Horaires | sede | un posto fisico ha i suoi orari |
| Réservations | sede | zone, tavoli, servizi: di quella sala |
| Cuisine | sede | la cucina e' del punto |
| Notifications | sede | i numeri del brief sono di quel punto |
| Liens | **gruppo** | un solo sito pubblico → un solo Facebook |
| Team | **gruppo** | una sola pagina squadra sul sito (tabella `team`, «mista») |
| Documents | sede | contratti, fatture, documenti legali **di una societa'** |

⚠️ Su Documents la tentazione e' metterlo al gruppo, ed e' sbagliato in modo
pericoloso: quella scheda contiene `contrat / facture / recu / legal`, e 450
Gradi sono tre societa' con tre partite IVA. Il generatore della lettera di
disdetta che vive li' dentro firma con `company_name` e `company_vat` della
configurazione attiva — condividendo i documenti si disdice il contratto di un
punto con la partita IVA di un altro. Non da' errore: parte e basta.

🔜 **Resta aperto**: il sito pubblico e' UNO e deve mostrare un logo, un nome e
una favicon. Ora che Général e' per sede, quell'identita' non ha piu' nessuno
che la scrive quando il multi e' acceso. Si decide al pezzo 6 — il candidato e'
la sede principale (la prima per `sort_order`), che e' gia' il ripiego naturale
di tutto il resto.

### `app_metadata` si riscrive per intero (13/09/2026)

`supabaseAdmin.auth.admin.updateUserById` **non fonde** `app_metadata`: quello
che non rimandi sparisce. Il ruolo e la sede dell'utente vivono lì dentro tutti
e due, quindi una PUT che manda solo `{ role }` cancella la sede senza dire
niente — nessun errore, nessuna riga rossa, solo un responsabile che da domani
vede tutte le sedi.

Quindi: **prima si rilegge, poi si fonde a mano**, e lo si fa ogni volta che si
tocca `app_metadata`, non solo nel ramo che cambia la sede.

```ts
if (sede !== undefined || patch.app_metadata) {
  const { data: chi } = await supabaseAdmin.auth.admin.getUserById(id);
  const attuale = (chi?.user?.app_metadata ?? {}) as Record<string, unknown>;
  patch.app_metadata = {
    ...attuale,
    ...(patch.app_metadata ?? {}),
    ...(sede !== undefined ? { location_id: sede } : {}),
  };
}
```

Stessa famiglia di guasti del filtro dimenticato: silenzioso, e si vede solo
quando qualcuno legge dei dati che non gli appartengono.

### `leggi()` non deve cancellare i tipi (14/09/2026)

`applicaFiltro` lavora su un'interfaccia ridotta — `Query`, solo `eq` e `or` —
apposta, per poterla provare nei test con un costruttore finto. Ma le funzioni
di `sede.ts` **non devono rendere quella**: se lo fanno, il tipo vero della
query si perde e `data` diventa `any` (o peggio `unknown`) in cinquantacinque
file. Cioe' niente controlli proprio dove il filtro di sede puo' sbagliare.

⚠️ E il tipo giusto **non** si ottiene cosi':

```ts
type Tabella = ReturnType<typeof supabaseAdmin.from>;   // ← NO
```

Quella scrittura risolve il generico al suo vincolo e rende un costruttore in
cui `data` e' `unknown`. Provato: da 14 errori a 88. Si ricava invece da
CHIAMATE CAMPIONE, funzioni mai eseguite che esistono solo perche' `typeof`
possa guardarle:

```ts
const TABELLA_CAMPIONE = "nessuna";                     // variabile, non stringa:
function _qLettura() {                                  // il test che scandisce src/
  return supabaseAdmin.from(TABELLA_CAMPIONE).select("*"); // cerca .from("...")
}
type QLettura = ReturnType<typeof _qLettura>;
```

⚠️ Corollario: **non annotare a mano i parametri dei callback** (`.then((r: {…})`).
Adesso che il tipo vero c'e', un'annotazione scritta a mano lo SOVRASCRIVE e
rompe quello che segue. Si lascia dedurre.

### Il test che si sarebbe svuotato da solo (14/09/2026)

«Ogni tabella letta nel codice e' classificata» cercava `supabaseAdmin.from("x")`.
Ma il passo 5 sostituisce proprio quella forma con `leggi(...)` — quindi **a ogni
file convertito la rete perdeva una maglia**, e a conversione finita il test
sarebbe passato controllando zero tabelle. Verde, e inutile.

👉 La regola: quando si introduce un passaggio obbligato che SOSTITUISCE la forma
che un test cerca, il test va esteso nello stesso momento. Un controllo che
smette di controllare non fallisce — e' questo che lo rende pericoloso.

### Menu: la definizione è del gruppo, lo stato è del punto (14/09/2026)

450 Gradi: tre pizzerie, tre società, **un menu solo**. Ma due cose non sono
uguali nei tre punti, e sono cose diverse fra loro:

| | Cos'è | Dove vive | Default |
|---|---|---|---|
| «Stockel fa la pizza in teglia» | **definizione** — esiste o non esiste | `location_id` dentro l'oggetto formato, nel jsonb `menu_items.variants` | **solo questa sede** |
| «Il piatto è solo di Stockel» | **definizione** | `menu_items.location_id` (tabella *mista*) | **tutte le sedi** |
| «Oggi la burrata è finita» | **stato** — cambia dieci volte a settimana | `menu_sold_out (location_id, item_id, sold_out, variants_off[])` | riga assente = vale la carta del gruppo |

Tre regole che ne discendono, e che è facile sbagliare:

1. **Riga di `menu_sold_out` presente = comanda lei, anche quando dice `false`.**
   Se fosse solo additiva («può esaurire, non può ripristinare»), un punto non
   potrebbe mai rimettere in vendita ciò che il gruppo ha spento.

2. **Lo stato del punto deve passare anche dal CHECKOUT**, non solo dalla
   vetrina. Nascondere un piatto nel menu e poi accettarne il pagamento vuol
   dire incassare per qualcosa che quella cucina non ha. Per questo
   `applicaStatoSede` sta dentro `piattiPerOrdine`, non nei due chiamanti:
   così nessuno dei due può dimenticarsene.

3. **⚠️ Rimandare indietro la lista dei formati CANCELLA quelli che non si
   vedono.** Da dentro Stockel si vedono i formati di Stockel e quelli di
   tutti; salvando, il PUT rilegge i formati degli altri punti e li rimette
   in coda. Senza quella fusione, ogni salvataggio da un punto avrebbe
   cancellato in silenzio i formati degli altri due.

Il default opposto fra piatto («tutte») e formato («solo qui») non è una
svista: il menu del gruppo è lo stesso, quindi il piatto condiviso è la
norma; un formato aggiunto stando dentro un punto è quasi sempre la cosa
che quel punto fa e gli altri no. In entrambi i casi il verso dell'errore
decide: dividere per sbaglio costa una riscrittura, non dividere cambia
tre ristoranti insieme.

### Sezioni del menu: filtrate in lettura, MAI in scrittura (14/09/2026)

`menu_categories` è del **marchio**, e i piatti ci si agganciano **per nome**.
Quindi in `api/admin/categories.ts` convivono due comportamenti opposti, e
sono giusti tutti e due:

- il **conteggio** nella GET è filtrato — altrimenti si legge «Pizze (24)»
  sopra 22 righe;
- il **rinomino** e il **riordino** propagano ai piatti **senza filtro** —
  rinominare «Pizze» solo per il punto da cui si scrive lascerebbe i piatti
  degli altri due agganciati a una sezione che non esiste più, e
  sparirebbero dalla loro lista senza essere stati cancellati;
- il controllo «sezione vuota» prima di eliminare è **globale**, e quando è
  vuota *qui* ma piena altrove il messaggio lo dice, invece di mentire.


### Le CHIAVI di app_config — la stessa domanda, un piano piu' sotto (20/09/2026)

`CLASSIFICA` risponde per le TABELLE, e `app_config` la dichiara «marchio» —
giustamente: *e'* il livello marchio. Ma dentro ci sono settanta cose diverse,
e quella riga non dice niente su cosa contengono.

Il guasto che ne nasce e' sempre lo stesso: **scritta per sede, riletta per
marchio.** `scriviConfig` salva in `location_config` quando c'e' una sede
selezionata; chi rilegge con `from("app_config")` prende il valore
dell'installazione e non lo sa. Nessun errore, nessun log. L'abbiamo trovato
tre volte a mano — `events.ts`, `link_google_review`, `orders_closed` — e tre
volte per caso.

`CLASSIFICA_CONFIG` in `sedeRegole.ts` risponde una chiave alla volta:

- **`sede`** — puo' essere diversa da un punto all'altro (ragione sociale,
  IVA, orari della sala, scheda Google, cucina chiusa). **Ogni lettura deve
  passare un ambito.** Leggerla grezza e' il guasto.
- **`marchio`** — uguale per tutta l'installazione (lingua dell'admin, tema,
  lingue pubbliche, quota newsletter, token OAuth Google). Leggerla grezza va
  bene.
- **`utente`** — appartiene a chi guarda, non a un punto: il layout della home.

Le chiavi generate a runtime (`link_facebook`, `site_hero_1`,
`home_layout:<id>`) si classificano per prefisso. ⚠️ **L'elenco esplicito
vince sul prefisso**: `link_google_review` porta il prefisso dei link ed e' di
sede — senza quella precedenza, chi mangia a Schaerbeek lascia la recensione
sulla scheda di Stockel.

**Una chiave non dichiarata LANCIA**, in scrittura. E' l'unico momento in cui
qualcuno sta guardando: dopo, la chiave vive in una tabella e nessuno si
chiede piu' se vada letta con un ambito.

**Chi scrive non sceglie piu' il livello.** `scriviConfig` aveva un parametro
`livello`, e i chiamanti lo passavano a mano: i link social «gruppo», il fuso
«gruppo», tutto il resto implicitamente «sede». Due sorgenti di verita' per la
stessa domanda, e chi aggiungeva un campo doveva indovinare. Il parametro non
c'e' piu': decide la classifica, e `scriviConfig` manda ogni chiave dove deve
andare — anche mescolate nello stesso salvataggio.

⚠️ **Il fuso orario e' «marchio» perche' il codice ne supporta uno solo**, non
perche' sia giusto. `TIMEZONE` in `slots.ts` e' una variabile di modulo
mutabile, condivisa da tutte le richieste del processo. La classifica dice la
verita' di oggi, non quella che vorremmo: il giorno che quel refactor si fa,
la riga diventa `"sede"` e la rete indica da sola tutti i posti da sistemare.

**Le eccezioni sono dichiarate, non tollerate.** `tests/config.test.mjs` tiene
l'elenco dei posti che leggono una chiave di sede senza ambito, con il motivo,
e una terza prova fallisce se un'eccezione non serve piu' — o resterebbe li'
per sempre. Oggi sono due categorie: login e reset-password, dove una sede non
esiste ancora, e il sito pubblico, che non ha ancora un selettore di sede.

Trovati mentre si scriveva la classifica: la lettera di disdetta contratti
usciva con la ragione sociale e l'IVA del marchio invece che della sede (un
documento legale sbagliato); il form di contatto del sito mandava il messaggio
alla casella del marchio invece che del punto; `assicuraLocation` in
`googleBusiness.ts` leggeva la scheda Google a livello marchio — non la
chiamava piu' nessuno, ma restava esportata, pronta per il primo che la
riusava.

### ⚠️ Le reti del motore girano anche dai CLIENTI (21/09/2026)

Scoperto al primo merge di questo lavoro su 450 Gradi: due reti sono
diventate rosse li' e verdi qui, e non c'era niente di rotto.

Il motivo e' che un cliente vero **cancella le cartelle `demo01`** — sono il
modello, non il suo sito. Una rete che nomina `src/pages/demo01/...` in un
elenco di eccezioni lo trova nel motore e non lo trova dal cliente: una
faceva `readFileSync` e moriva con ENOENT, l'altra dichiarava l'eccezione
«morta» perche' il file non c'era.

**Regola: un percorso fisso dentro una rete va guardato con `existsSync`
prima di leggerlo, e un file assente non e' mai una violazione.** Una rete
che punisce un'installazione legittima e' una rete che qualcuno prima o poi
disattiva — e quel giorno smette di proteggere anche dalle violazioni vere.

Le reti che SCORRONO `src/` (la maggioranza) non hanno il problema: trovano
quello che c'e'. Il rischio e' solo negli elenchi scritti a mano.

## Il fuso orario — una variabile globale, diciannove file (21/09/2026)

Il fuso stava in `slots.ts` come **`export let TIMEZONE`**: una variabile di
modulo mutabile, riempita al primo accesso da `aggiornaTimezone()` e condivisa
da tutte le richieste del processo. Diciannove file la importavano e la
leggevano senza passare niente.

Era comoda — si importava e basta — ed e' esattamente per questo che era
pericolosa. ⚠️ **Con una sede sola non si vedeva niente.** Con due sedi in
fusi diversi, la richiesta di una cambiava il valore sotto i piedi a quella
dell'altra gia' partita, e il risultato non era un errore: era un **orario
sbagliato ma plausibile** — un'ora di ritiro nell'email, uno slot
prenotabile, un giorno speciale sparito la sera prima. Nessuno l'avrebbe
collegato alla richiesta di un'altra persona.

**Adesso il fuso viaggia di mano in mano.** `fusoDi(ambito)` in `lib/fuso.ts`
lo legge — da `appConfigEq`, quindi dalla cache di `app_config` con
`location_config` della sede sovrapposto, come ogni altra chiave; il fuso era
l'unica che si era fatta la sua strada. Chi calcola lo riceve come argomento.

⚠️ **`fuso` e' OBBLIGATORIO in `calcolaSlot`**, non ha un valore di default.
Un default rimetterebbe lo stesso guasto in forma piu' educata: chi dimentica
di passarlo calcolerebbe gli orari di Bruxelles per una sede che sta altrove,
senza che niente lo dica. Cosi' invece non compila. E `calcolaSlot` si
dichiarava «PURA: nessun I/O» mentre leggeva una globale: adesso lo e'.

**Tre lavori restano sul fuso dell'INSTALLAZIONE**, con il motivo scritto
accanto e una rete che controlla che il motivo ci sia ancora: la newsletter e
la sua programmazione (una lista, un calendario, un'ora sola — con sedi in
fusi diversi non esiste un «alle 9» che valga per tutte), la quota newsletter
(un abbonamento, un contatore, e tre «mesi correnti» darebbero tre conteggi
della stessa quota) e il cron che chiude gli ordini vecchi (passa su tutte le
sedi insieme, la soglia e' una). Sono scelte dichiarate, non un ripiego.

**Il promemoria in `sede.test.mjs` era diventato una riga di codice.** Prima
di questo lavoro `timezone` era classificata `"marchio"` — non perche' fosse
giusto, ma perche' il codice ne supportava uno solo — con un commento che
diceva «il giorno che quel refactor si fa, questa riga diventa "sede" e la
rete indica da sola i posti da sistemare». E' andata cosi': girata la riga,
`tests/config.test.mjs` ha elencato i file da aprire.

**Trovato per strada:** in `special-days.ts` l'ambito serviva alla validazione
delle date ma era dichiarato a meta' funzione, dopo l'uso. Non un errore di
compilazione — un `ReferenceError` a runtime, dentro un ramo che scatta solo
con una data passata. E' la terza volta in questo progetto che una `const`
dichiarata sotto il suo uso passa inosservata.


## I permessi — la porta, non il cartello (20–21/09/2026)

Prima di questo lavoro il ruolo era **un suggerimento**. La nav nascondeva i
link nel browser, `settings` e `super` si difendevano dentro uno `<script>` —
cioe' dopo che la pagina era gia' stata mandata — e delle 48 API sotto
`/api/admin/` solo cinque controllavano chi chiamava. Un «utente» che
scriveva `/admin/stats` a mano riceveva il fatturato del giorno gia' calcolato
dal server e incollato nell'HTML.

**La regola sta in `permessiRegole.ts`** (puro, senza database): quali pagine
vede un ruolo, `API_PAGINA` che lega ogni endpoint alla sua pagina,
`puoVederePagina` e `puoChiamareApi`.

**Chi la applica sono due**, e usano lo stesso contesto:

- il **middleware**, per ogni richiesta: `/admin/<pagina>` non permessa →
  redirect su `/admin`; `/api/admin/*` non permessa → **403 JSON**, mai un
  redirect (un redirect a una `fetch` arriva come HTML dove il client aspetta
  JSON, e il messaggio d'errore parla di parsing invece che di permessi);
- **l'SSR della home**, per decidere cosa mettere nell'HTML.

⚠️ **NEL DUBBIO SI LASCIA APERTO.** Una pagina o un'API sconosciuta e'
permessa: una pagina nuova non deve nascere bloccata, e se le claims non si
leggono (JWKS irraggiungibile) non si blocca niente. La severita' sta
altrove: una rete fallisce se un file sotto `pages/api/admin` non e' in
`API_PAGINA`, cosi' la dimenticanza si paga in `npm test` e non in produzione.

### La porta chiusa e la finestra aperta (21/09/2026)

Chiuse le API, restava la home. E' l'unica pagina con questo problema, ed e'
per costruzione: e' **sempre permessa**, e mette insieme dati di pagine che
chi guarda puo' non avere. `caricaHomeData` pre-caricava cinque isole lato
server e le incollava nell'HTML senza passare da nessun controllo.

Il dato non era generico: `ORDERS_SELECT` porta `customer_name`,
`customer_email`, `customer_phone`. Un utente senza la pagina «Commandes»
aveva nel sorgente della pagina i clienti del giorno con nome, email e
telefono. Nessun errore, nessun log: bastava guardare il sorgente.

⚠️ **Qui il 21/09 avevo scritto che «la tile non la vedeva nemmeno, perche'
AdminNav la rimuove». Era falso**, e l'ha trovato il primo giro di prove su
450 Gradi. `/api/admin/pages` calcolava `hidden` dalle sole pagine spente dal
super, piu' `settings` e `stats` per il ruolo «user»: le caselle del singolo
utente non entravano mai in quel calcolo. Quindi chi aveva spuntato solo
«Menu» vedeva lo stesso le voci Commandes e Réservations nella nav e le loro
tile in home — cliccarle non portava da nessuna parte, ma l'interfaccia
prometteva pagine che non c'erano: sembrava rotta invece che chiusa.

Adesso `hidden` e' il complemento di `pagineConsentite(ctx)`: ruolo, caselle
del modale utente e pagine spente per l'installazione, tutto dallo stesso
posto. Al super si continua a dare la lista grezza, perche' la sua pagina
Réglages mostra e risalva quegli interruttori.

Adesso `caricaHomeData(ambito, ctx)` prende il contesto dei permessi, e
**un'isola vietata non si legge nemmeno dal database**. Toglierla solo dalla
risposta chiuderebbe la falla lo stesso, ma lascerebbe il server a
interrogare Supabase per righe che butta via — e chi tocca il file dopo non
avrebbe modo di accorgersi che quel `.data` non doveva uscire di li'.

⚠️ **I due rami della home devono concordare anche quando rifiutano.** Con
SSR le isole arrivano dall'HTML, senza SSR dalle `fetch`. Un'isola assente
non e' un'isola vuota: e' un rifiuto, e `fakeRes` rende `ok: false`
esattamente come farebbe un 403. Altrimenti la stessa pagina si comporta in
due modi diversi a seconda di quale ramo e' partito — e
`(await res.json()).orders` esplode su `undefined`.

Le altre pagine (orders, clients, menu, stats) pre-caricano i dati della
**loro** pagina, e il middleware ci arriva prima: li' non serve niente.

**Il contesto si costruisce in un posto solo**, `lib/admin/permessi.ts`. Ne
erano nate due copie — una nel middleware, una che stava per nascere nell'SSR
— e due copie della stessa domanda sono il modo in cui si smette di sapere
quale risponde. Qui la risposta sbagliata non da' nessun errore: da' dati che
chi guarda non doveva vedere.


## FAB — il pulsante in basso a destra (unificato 13/09/2026)

**Dove vive.** `src/styles/fab.css`, importato una volta da `AdminHead` →
vale su ogni pagina admin. **Non va importato dalle singole pagine.**

```html
<button class="fab-add fab-pill" type="button"><span class="fab-plus">+</span>Sede</button>
```

`.fab-add` è **solo posizionamento**, `.fab-pill` è **solo il look**. La
divisione serve a Prenotazioni, che ha tre pulsanti fissi con posizioni proprie
(`.fab`, `.fab-serv`, `.fab-zone`) e lo stesso aspetto degli altri.

⚠️ **Fino a oggi ce n'erano due copie.** `AdminHead` stampava un `FAB_CSS`
inline che ridefiniva `.fab-add` col look completo, in contraddizione con
questo foglio; vinceva quella inline perché stava in fondo al `<head>`. Otto
pagine importavano `fab.css` e due no — e su quelle due il FAB **si comportava
diversamente sui tablet**, perché la regola `@media (max-width: 1023px)` che
lo solleva sopra la navbar non le raggiungeva. Nessuno l'aveva notato: il
pulsante c'era, era solo nel posto sbagliato su metà degli schermi.

👉 Quinto caso della stessa forma in due giorni. Vale la pena ripeterlo: **se
una cosa serve a tutte le pagine, si importa da `AdminHead` e basta.** Una
seconda definizione «per sicurezza, così vince nella cascata» non è una
sicurezza: è il guasto che aspetta il suo turno.

## Messaggi d'errore delle API admin — nella lingua dell'admin

Fino al 20/09 l'admin parlava cinque lingue e le API rispondevano in **francese**: 603 stringhe
d'errore in 52 endpoint, scritte quando l'admin era solo francese. Non era un
guasto — la richiesta fallisce correttamente — ma un ristoratore italiano legge
una pastiglia rossa in francese, e l'applicazione sembra di qualcun altro.

La macchina per farlo bene c'è già e non costa niente:

```ts
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}
return json({ error: await msg("loc.err.needOne") }, 400);
```

`adminLang()` legge `app_config.admin_lang`, che è **globale** (la sceglie il
super) e sta nella cache di `adminBoot`: zero query in più. Quindi il server sa
già in che lingua rispondere, e non serve far tradurre al client.

⚠️ Se una funzione di validazione deve segnalare un errore, **rende la chiave
i18n**, non la frase: chi risponde traduce. Così la validazione resta pura e
non ha bisogno di sapere la lingua.

**Fatto (20/09): tutte le API admin.** 598 messaggi in 52 endpoint, più
`slotsApi.ts`. Non più «quando si tocca ognuno»: erano 550 letterali per 227
frasi diverse, cioè la stessa frase riscritta decine di volte, e convertirli
uno alla volta voleva dire 227 traduzioni scritte 550 volte.

UN letterale francese = UNA chiave nello spazio condiviso **`err.*`**:
«Corps invalide» compariva in 48 punti e non ha 48 traduzioni diverse. Gli
spazi per modulo (`loc.err.*`, `cat.err.*`) restano per i messaggi che
appartengono davvero a un solo endpoint.

I messaggi sono stati anche **normalizzati**: niente punto finale. Prima
«Montant invalide» e «Montant invalide.» erano due stringhe diverse nello
stesso pannello.

⚠️ **Il modo in cui questo si rompe è silenzioso.** `adminT` restituisce la
CHIAVE quando la riga manca: nessun errore, nessun log, solo un toast rosso
che dice `err.body`. Per questo `tests/i18nApi.test.mjs` fallisce se una
chiave usata non ha la sua riga, se una riga non ha tutte e 5 le lingue, se
resta un letterale accentato in posizione `error:`, o se un file usa `msg()`
senza dichiararla e importarla.

⚠️ Una `const msg` locale **nasconde** la funzione: la chiamata diventa
«msg non è una funzione», a runtime, dentro un ramo d'errore raro che nessuno
prova. Cinque punti erano già così dopo la conversione. Il locale si chiama
`dettaglio`, e la rete lo controlla.

⚠️ Quando un messaggio **sceglie fra due chiavi**, si traduce DOPO aver
scelto — `await msg(cond ? "a" : "b")`, non un ternario fra due `await msg`.
Altrimenti si leggono due volte lingua e dizionario per stampare una frase.

## I recapiti non si scrivono nel codice (29/09/2026)

**ChouChou e L'Huile pubblicavano il numero di telefono di La Molisana.** La
pagina `/order` mostra, fuori orario, un riquadro «gli ordini sono chiusi,
chiamateci» con un bottone: quel numero era scritto a mano, ed era arrivato
col clone — quelle pagine nascono copiate da La Molisana, il cliente da cui
il motore è nato, e nessuno le aveva più guardate.

Sei pagine, due clienti, mesi. Nessun errore, nessuna riga nei log, e visibile
**solo quando il servizio è chiuso** — cioè quando nessuno guarda. Chi provava
a ordinare la sera telefonava a un altro ristorante.

Lo stesso giorno, la stessa forma altre due volte: La Molisana pubblicava
**due email diverse** (`pizzeria@` nel footer, `info@` nella pagina contatti e
nei dati strutturati letti da Google), e tre pagine avevano il fuso orario
scritto a mano. Tre difetti, una sola causa: **un dato del ristorante copiato
dentro il codice al momento del clone, e mai più toccato.**

⚠️ **Nessuna prova li aveva visti.** Le reti sorvegliavano le *chiavi* di
`app_config` — che si leggano con l'ambito giusto, che una chiave di sede non
sia letta a livello marchio. Nessuna guardava i **valori** scritti nel sito del
cliente, che è esattamente dove il clone li lascia.

**La regola.** I recapiti veri stanno nell'admin (Réglages → Général) e si
leggono con `datiRistorante(ambito)`, come fanno footer e dati strutturati.
Nel codice ne esiste **una copia sola, dichiarata**: il ripiego in
`src/config/client.ts`, che serve a quando il database non risponde.

`tests/recapiti.test.mjs` cerca telefoni e email scritti a mano in
`src/pages/`, `src/components/`, `src/layouts/`. Fuori: l'admin (lì un
recapito d'esempio non lo vede nessun cliente), `src/config/client.ts` (è il
ripiego, è il suo mestiere) e le **pagine legali** — un'informativa privacy
deve dire a chi si scrive, e un testo di legge non si compila da una tabella.

⚠️ **Questa rete serve nei clienti, non nel motore**: il motore un sito non ce
l'ha, quindi da solo non protegge nessuno. Arriva col merge, come le altre.

## Il webhook era l'unica strada (29/09/2026)

**450 Gradi e' andato in linea, due clienti hanno ordinato e pagato, e il
ristorante non ha visto niente**: nessun ordine nel pannello, nessuna email,
nessuna notifica. I webhook di Stripe puntavano ancora al dominio di prova.

Non e' stato un errore, e' stato un **silenzio**. Il pagamento riusciva, il
cliente vedeva la sua pagina di conferma e se ne andava contento, l'ordine
restava `pending` — che nel pannello vuol dire **invisibile**, perche' la lista
mostra solo `paid`, `done` e `cancelled`. L'unico posto al mondo dove era
scritto era il pannello di Stripe, e ci si guarda quando si sospetta qualcosa.

⚠️ **La causa vera non era il dominio sbagliato: era che il webhook fosse
l'unico modo di confermare un ordine.** Le quattro cose che accadono quando un
pagamento arriva — stato a `paid`, email al cliente, email alla cucina, push al
ristoratore, cliente in rubrica — vivevano tutte dentro il gestore del webhook.
Nessun webhook, nessuna di quelle cose, e nessuna seconda strada.

**La cura, in due pezzi.**

`src/lib/confermaOrdine.ts` — il gesto, in un posto solo, con l'idempotenza
dentro (si aggiorna solo se ancora `pending`, cosi' due chiamanti che arrivano
insieme non mandano due email). Oggi lo chiamano il webhook e il recupero; lo
chiamera' anche l'ordine senza pagamento online, il giorno che si fara'.

`src/pages/api/admin/orders-recupero.ts` — quando il ristoratore apre la pagina
Ordini, si chiede a Stripe se fra gli ordini in attesa ce n'e' qualcuno gia'
pagato, e in quel caso lo si conferma davvero. Non e' la strada normale: e' la
rete sotto.

⚠️ **NON BASTAVA UNA SPIA.** La prima idea era un avviso «ci sono N ordini in
attesa da piu' di un quarto d'ora». Ma un ordine in attesa e' quasi sempre un
carrello abbandonato, quindi quella spia sarebbe accesa quasi sempre — e una
spia sempre accesa non la guarda piu' nessuno. L'unico che sa se un ordine e'
stato pagato e' Stripe: percio' non si avvisa, si **chiede**, e si rimedia. Il
messaggio compare solo quando ha recuperato qualcosa, e dice anche di
controllare i webhook — il recupero rimedia all'ordine, non alla causa.

⚠️ **La chiave Stripe e' della sede, e la sede la dice la RIGA.** Con tre
societa' sono tre conti: chiedere di una sessione di Stockel con la chiave di
Schaerbeek non da' un ordine sbagliato, da' un «non trovata» — e l'ordine
resterebbe perso in silenzio, cioe' esattamente il guasto da cui veniamo.

Precedente in casa: `GET /api/admin/credits` fa gia' la stessa guarigione per i
crediti newsletter quando il browser viene chiuso prima del ritorno.

## Le prenotazioni esterne: tolte, non rinviate (01/10/2026)

In `Super → Integrazioni` c'era una scheda «Prenotazioni» con tre modi —
widget RestoHub, link esterno, widget esterno — salvati in `app_config` come
`resa_mode`, `resa_provider`, `resa_url`, `resa_embed`. **Non ha mai fatto
niente.** Il modo veniva scritto nel database e riletto nella stessa pagina;
nessun sito di cliente lo leggeva, perche' il pulsante «Prenota» di ogni
cliente e' nel suo tema, non nel motore. Verificato su tutti e sei i
repository: nessuno importava `src/lib/reservationMode.ts`.

Era un'opzione che si poteva accendere, che sembrava fare qualcosa, e che
lasciava il sito esattamente com'era. Peggio di un'opzione mancante.

⚠️ **Se un giorno servira', NON va rifatta cosi'.** La scelta e' del singolo
sito e non del gruppo (due sedi possono usare due servizi diversi, o nessuno),
quindi il posto giusto e' il `src/config/client.ts` del cliente — dove abita
gia' tutto il resto di cio' che e' suo — non una chiave di `app_config` scritta
da un pannello che il ristoratore non vede nemmeno.

**Tolto nello stesso giro, e per lo stesso motivo:** il bottone «Salva» della
scheda Google. Mandava **solo** i campi delle prenotazioni, quindi di Google
non salvava nulla: il Place ID sta nella scheda della sede, e la connessione
si salva da se' con `POST /api/admin/google/locations`. Un bottone che non
scrive quello che gli sta sopra e' una trappola, non una comodita'.

Le quattro chiavi `resa_*` restano classificate in `src/lib/admin/sedeRegole.ts`
(righe superstiti): i dati vecchi non si cancellano per ordine, e se una riga
e' rimasta in un database va comunque in un posto preciso.

## Lo stile che non arriva al componente figlio (01/10/2026)

La home «coming soon» di BROS mostrava il logo **schiacciato**: un bollo
quadrato stirato dentro un rettangolo. Il CSS diceva la cosa giusta —
`object-fit: contain` — e non veniva applicato.

Astro compila uno stile scoped in `.logo[data-astro-cid-xxxx]`, e quando la
classe e' su un COMPONENTE invece che su un elemento, passa `data-astro-cid-xxxx`
al componente **come prop**. Se il componente non rimette quell'attributo sul
proprio elemento, il selettore non trova niente.

⚠️ **Lo stile non sparisce con un errore: sparisce e basta.** `astro check` e'
verde, la pagina si vede, ed e' solo guardandola che ci si accorge che una
regola non c'e'. Gli attributi `width`/`height` continuavano a valere, quindi
il risultato non era «nessuno stile»: era il logo deformato a 280x120.

**La cura** sta in `src/components/Immagine.astro`: raccogliere gli attributi
non dichiarati con `...resto` e rimetterli sull'`<img>`. Vale per qualunque
componente nostro che avvolga un elemento e possa ricevere una classe.
`tests/prestazioni.test.mjs` adesso lo verifica.

**Secondo pezzo, sullo stesso schermo:** il logo di ripiego della home e'
`/icon-192.png`, e l'icona di un cliente si fa di norma su fondo bianco — su
una pagina a fondo scuro si vedeva un rettangolo bianco intorno al marchio.
Per BROS `icon-192` e `icon-512` sono state rifatte **trasparenti**;
`apple-touch-icon` resta opaca, perche' iOS non ha la trasparenza e al suo
posto mette il nero.

## Un colore solo per due sfondi (01/10/2026)

Il tema ha nove colori, e fra questi `header` e `bg` sono **indipendenti**: la
barra in alto puo' essere di un colore e la pagina di un altro. Il testo pero'
era uno solo — `text` e `muted` — e valeva in tutti e due i posti.

Finche' i temi sono stati tutti scuri l'assunzione ha retto, perche' nessuno
l'aveva mai messa alla prova. BROS e' il primo marchio chiaro: header rosso,
pagina bianca. Il testo giusto per la pagina — quasi nero — finiva dentro la
barra rossa.

⚠️ **Non era un colore sbagliato: era una domanda mai posta.** «Di che colore e'
il testo» ha due risposte quando gli sfondi sono due, e il tema ne accettava
una sola. Nessun controllo poteva accorgersene: i nove colori erano tutti
validi, presi uno per uno.

**La cura** sta in `src/lib/admin/temaColori.ts` — zero import, come
`ordiniRegole.ts`, cosi' il test lo puo' caricare. Tre variabili in piu' che
**nessuno sceglie**, perche' si calcolano dallo sfondo su cui finiscono:

- `--c-htext` / `--c-hmuted` — il testo della barra. Barra scura, testo bianco;
  barra chiara, il testo della pagina. Soglia 0.6 di luminanza percepita
  (pesi BT.601: una media semplice darebbe il testo nero su un blu pieno).
- `--c-hactive` — la pillola della voce attiva. Di norma e' l'accent, ma se
  l'accent e' troppo vicino all'header la pillola sparisce dentro la barra, e
  allora si ripiega sul testo dell'header. Caso reale: BROS header `#e30613` e
  accent `#840008`, distanza 0.15 — due rossi diversi che insieme non si
  leggono.

⚠️ **La stessa funzione la usano il server e il browser.** `cssTema()` stampa le
variabili nel `<head>` prima del primo paint, `AdminNav` le riscrive quando il
tema arriva dall'API: se i due calcoli divergono, si vede un tema per un istante
e un altro subito dopo. Per questo `variabiliTema()` sta in un posto solo, e
`NOMI_VARIABILI` elenca tutto cio' che puo' scrivere — chi applica un tema nuovo
prima azzera quella lista, altrimenti un colore del tema vecchio resta
appiccicato al `<html>` fino al ricaricamento.

**Per i clienti che ci sono gia' non cambia niente**, ed e' stato verificato
eseguendolo sul tema RestoHub: stesse variabili di prima, `--c-hactive` resta
corallo. Le regole CSS chiedono sempre `var(--c-htext, var(--c-text))`, quindi
anche senza il calcolo il comportamento e' quello di sempre.

⚠️ **Secondo giro, stesso schermo: il testo secondario della barra.** Era
`rgba(255,255,255,0.72)` fisso. Su una barra quasi nera e' giusto — serve a dire
"questa voce non e' quella attiva" — ma sul rosso pieno di BROS diventava un
rosa slavato, e le voci del menu non si leggevano. **Non era il colore ad essere
sbagliato, era il contrasto**, e il contrasto dipende da quanto e' scuro il
fondo: sotto 0.2 di luminanza resta 0.72, sopra sale a 0.92. Lezione da
ricordare: un valore di trasparenza non e' mai "il bianco smorzato", e' il
bianco smorzato *su quello sfondo li'*.

## La rete cieca sulla costante (01/10/2026)

`tests/config.test.mjs` esiste per un guasto preciso: una chiave di
`app_config` scritta per sede e riletta per marchio. Trovato tre volte a mano,
mai nei log. Da allora la rete elenca le chiavi lette da ogni file e pretende
che ognuna sia classificata in `CLASSIFICA_CONFIG`.

Il 30/09 sono nate quattro chiavi nuove — `orders_pay_online`,
`orders_pay_onsite`, `orders_coupons`, `orders_coupons_onsite` — e **nessuna e'
finita in `CLASSIFICA_CONFIG`**. La rete non ha detto niente. Il conto e'
arrivato il giorno dopo, su BROS: salvando una qualunque impostazione in
Admin → Général il PUT manda tutto il modulo insieme, `scriviConfig` incontrava
la prima chiave non classificata e si fermava. Schermata di errore al posto del
salvataggio, su un campo che con i pagamenti non c'entrava niente.

⚠️ **Perche' la rete non l'ha vista.** Leggeva solo la forma scritta sul posto:

    leggiConfig(ambito, ["orders_pay_online", ...])   // vista
    leggiConfig(ambito, CHIAVI_ORDINI)                // NON vista

`ordiniOpzioni.ts` passa una costante, perche' lo stesso elenco serve anche
alle regole pure. La cosa fatta meglio — un elenco in un posto solo — e' la
cosa che ha reso la chiave invisibile al controllo.

**La cura non e' allargare la regex**, che domani sarebbe cieca su un'altra
forma: e' `ELENCHI_CHIAVI`, una mappa nel test con gli elenchi importati
davvero. Un `leggiConfig(ambito, COSTANTE)` con una costante che la mappa non
conosce **fa fallire la prova** col nome della costante, invece di essere
saltato in silenzio. Una rete che non sa una cosa deve dirlo, non tacere.

Le quattro chiavi sono di **sede**: due punti vendita della stessa societa'
possono avere scelte diverse, uno incassa online e l'altro alla cassa, e il
carrello le legge con l'ambito del punto scelto.

## L'interruttore stirato, terza volta (01/10/2026)

Un interruttore e' una `<label class="switch">`. Le pagine incolonnano i titoli
dei campi con `.field label { flex: 0 0 220px }`, e quella regola non distingue:
colpisce anche l'interruttore. In riga lo rende largo 220px; **dentro una
colonna quel numero diventa l'ALTEZZA**, e si vede una barra colorata lunga
mezza pagina.

E' successo tre volte: nel tab Prenotazioni, poi in Ordini (29/09), poi di nuovo
in Prenotazioni (01/10). Le prime due volte la cura e' stata una contro-regola —
`.field label.switch { flex: 0 0 auto; … }` — e non ha retto:
`.section[data-tab="reservations"] .field label` e' **piu' specifica** e la
scavalca.

⚠️ **Rincorrere con contro-regole non e' una cura.** Finche' la regola sbagliata
puo' colpire, basta che qualcuno ne scriva una piu' specifica — per un tab, per
una scheda, per un breakpoint — e il componente si rompe di nuovo, in un punto
che nessuno stava guardando. Si vince solo togliendo il bersaglio.

**La cura e' alla fonte:** ogni regola che da' una misura alle label porta
`:not(.switch)`. L'interruttore smette di essere raggiungibile, e le sue misure
restano quelle del componente (`styles/switch.css`, `--sw-*`), ovunque.
`tests/impostazioni.test.mjs` lo verifica su tutte le pagine admin: un selettore
che finisce con l'elemento `label`, senza `:not(.switch)`, e che imposta
`flex`, `width`, `height` o `min-height`, fa fallire la prova.

Preso lo stesso giro anche `.cf-col label`, che non ha interruttori oggi ma
imponeva `min-height: 2.5em` a qualunque label ci finisse dentro domani.

## Una chiave, piu' righe (02/10/2026)

Un ristoratore scrive i suoi servizi cosi':

    soir  18:00-22:30  giorni [0,1,3,4]     feriali
    soir  18:00-23:00  giorni [5,6]         venerdi' e sabato

Due righe, la stessa chiave. E' il modo normale di dire «il weekend si chiude
piu' tardi», e **due clienti su cinque lo usano** — verificato leggendo il loro
`/api/reservation?config=1`.

`verificaCreneau` faceva `cfg.services.find((sv) => sv.key === p.service_key)`.
`find` torna la PRIMA riga. Il venerdi' si finiva a controllare la riga dei
feriali, che il venerdi' non e' attiva, e si rifiutava la prenotazione **a
qualsiasi ora, con la sala vuota, proprio venerdi' e sabato**.

⚠️ **Il widget non aveva il difetto**, perche' le righe le usa tutte: mostrava
gli orari giusti fino alle 23:00. Il cliente sceglieva un orario libero e si
sentiva rispondere «questo orario e' appena stato preso». Nessun errore nei
log, niente in Stripe, niente da nessuna parte: due logiche che rispondono
diverso alla stessa domanda.

**La regola giusta:** il servizio e' quello che il cliente ha scelto, ma le sue
righe sono tante, e **basta che UNA regga il giorno e l'ora**.

La stessa trappola, due piani piu' sotto, in altri due punti dello stesso giro:

- `new Map(services.map((s) => [s.key, s.hold]))` teneva l'ULTIMA riga, quindi
  il lunedi' l'occupazione si calcolava con la durata del sabato (120 minuti
  invece di 90) e si rifiutavano tavoli liberi.
- `caricaResaGiorno` sceglieva la durata con un `find` secco, e il sabato
  chiudeva i tavoli mezz'ora prima del dovuto.

⚠️ **Come l'abbiamo trovato, dopo averlo cercato male.** Dal codice i candidati
erano otto e tutti plausibili. La diagnosi e' arrivata leggendo `?config=1` dei
due siti veri: li' si vedono le due righe `soir` in chiaro. **Il dato del
cliente batte la lettura del codice**, e quell'endpoint e' il primo posto dove
guardare quando una prenotazione viene rifiutata senza motivo apparente.

Nello stesso giro i tredici rifiuti di `verificaCreneau` hanno smesso di
chiamarsi tutti `creneauPris`: ognuno torna il suo motivo, l'API lo mette
accanto all'errore e il widget lo scrive in console. Il cliente continua a
leggere una frase sola.

## Sedici pixel, su un dito (02/10/2026)

Safari su iPhone **ingrandisce la pagina da solo** quando si tocca un campo il
cui testo e' piu' piccolo di 16px. I campi del widget prenotazioni erano a
`0.88rem`, cioe' 14px: toccando «Nom» la pagina saltava avanti, il modulo
diventava piu' largo dello schermo, e si finiva a compilare telefono ed email
trascinando la pagina di lato. Sul modulo che porta le prenotazioni.

Non e' un'impostazione che si puo' spegnere lato pagina. ⚠️ **La scorciatoia
che si trova ovunque — `maximum-scale=1` o `user-scalable=no` nel viewport — e'
peggio del difetto**: toglie l'ingrandimento a chiunque, compreso chi ne ha
bisogno per leggere. Si baratta un'accessibilita' vera per un fastidio di
stile, e nessuno se ne accorge finche' non e' un cliente con la vista stanca a
provarci.

La cura e' non scendere sotto i 16px dove si tocca:

    @media (pointer: coarse) { .rw-in, .rw-datein { font-size: 16px; } }

`pointer: coarse` prende i dispositivi a tocco e lascia il desktop com'era —
ed e' la stessa condizione che il widget usa gia' per ingrandire le celle del
calendario. `tests/pubblico.test.mjs` pretende i 16px e vieta le due
scorciatoie sul viewport.

## Il codice impara un valore, il database no (02/10/2026)

Dal 29/09 un locale puo' spegnere il pagamento con carta e far pagare al
ritiro. Il checkout salva allora `payment_method = 'onsite'`. La colonna pero'
nasce dalla #49 con

    check (payment_method in ('cash', 'card', 'link'))

e PostgreSQL rifiuta la riga. Su BROS il cliente riempiva il carrello, premeva
«Ordina» e leggeva «Impossibile creare l'ordine»: **nessuna riga nel database,
niente in cucina, niente nei log**. Il codice era giusto, la migrazione non
c'era.

⚠️ **E' ESATTAMENTE la #74, due settimane dopo.** Li' era `reservations.source`
allargato a `instagram` e `qr`, con gia' scritto a chiare lettere: «finche' non
si lancia, l'insert fallisce — prenotazione persa, non statistica sbagliata».
La lezione era in casa, e non e' bastata, perche' la rete che la difendeva
(`tests/sorgente.test.mjs`) guardava **una colonna sola**.

**Una nota in un file non protegge niente: protegge un test.** Da oggi
`tests/ordini.test.mjs` fa per `payment_method` quello che `sorgente` fa per
`source` — legge i valori che il codice scrive, li confronta con l'elenco del
`check`, e diventa rosso prima del rilascio invece che in produzione. Controlla
anche che il vincolo letto sia **l'ultimo** di `TUTTO.sql`: una migrazione piu'
recente che restringa la colonna renderebbe la prova cieca.

⚠️ **Il guasto era anche muto.** `checkout.ts` rispondeva 500 senza scrivere
cosa avesse detto il database. Ora l'errore dell'insert finisce in
`console.error`: il messaggio al cliente resta generico — non deve leggere i
nomi delle colonne — ma il motivo vero deve esistere da qualche parte, o il
prossimo guasto si cerca di nuovo a tentoni.

**La domanda da farsi:** ogni volta che il codice impara a scrivere un valore
nuovo in una colonna con un `check`, la migrazione va nello stesso commit.
Sono due file che si guardano, e se ne rilascia uno solo il guasto non si vede
in sviluppo — si vede al primo cliente che prova.

### Un test cerca nel codice, non nei commenti (02–03/10/2026)

Tre volte in due giorni, con tre reti diverse:

- gli interruttori: la prova elencava i selettori `label` con una misura, e
  trovava il commento che spiega quali non vanno bene;
- il viewport: la prova vietava `maximum-scale=1`, e accusava la nota che
  spiega perche' quella scorciatoia non si prende;
- `payment_method`: la prova leggeva il `check` dalla migrazione, e prendeva
  quello VECCHIO, citato nella nota in testa al file per raccontare il guasto.

⚠️ **Non e' una svista, e' un meccanismo.** Un commento che spiega bene un
difetto contiene, per forza, la cosa sbagliata scritta per esteso — ed e'
esattamente la stringa che la rete sta cercando. Piu' la spiegazione e' utile,
piu' e' probabile che faccia fallire la prova.

La regola: **prima di cercare, togliere i commenti** (`--` in SQL, `/* */` nei
fogli di stile), oppure cercare dove la cosa fa danno — il tag `<meta>`, la
regola CSS, l'istruzione `alter table` — e non nel testo del file.

Un test che litiga con la propria spiegazione finisce disattivato, non letto.

## Una MISURA, un posto solo (03/10/2026)

La sezione «Una cosa sola, in un posto solo» parla di logica duplicata. Questa
è la stessa malattia sulle **misure**, ed è costata cinque correzioni in una
sola sessione — sempre lo stesso difetto, ogni volta con una faccia diversa:

| Il numero | Dove viveva | Dove era ricopiato | Cosa si è visto |
|---|---|---|---|
| padding del `main` | `AdminHead` | `clients.astro` (`top: calc(2rem + …)`) | ricerca e selettore colonne scivolati sotto il titolo |
| altezza dell'header | da nessuna parte | `google.astro` (`top: 96px`, `48px + 2rem`) | scheda incollata troppo in basso |
| altezza della riga del titolo | da nessuna parte | `clients.astro` (`0.82rem`, metà del **testo**) | campo due pixel più su del titolo |
| `bottom` della barra | `AdminNav` | `fab.css`, `reservations.astro` | «+ Ordine» disallineato dall'isola |
| taglie dell'interruttore | `switch.css` | google 38, menu 44, impostazioni 44, super 34 | rimpicciolito il componente, non cambiava niente |

**La regola.** Un numero che due regole devono conoscere non si scrive due
volte: si **dichiara una volta** come variabile CSS e si **cita**. Oggi
esistono `--pad-y`/`--pad-x` (padding del main), `--h-header`, `--riga-titolo`,
`--h-campo`, e le taglie in `switch.css`.

⚠️ **Il segnale è sempre lo stesso**: un `calc()` che *ricostruisce* una misura
che vive altrove — `calc(2rem + 0.82rem)`, `calc(48px + 2rem + 1rem)` — oppure
una pagina che ridichiara `--sw-w`. Non è «un piccolo ritocco locale»: è una
copia che si scollerà alla prima modifica dell'originale, e si scollerà in
silenzio, perché nessun test vede due pixel.

**Quando la misura non è dichiarabile** (l'altezza reale di un elemento che
dipende dal contenuto), non si stima: o si dichiara l'altezza (`min-height` su
una variabile, come `--riga-titolo`), oppure la si **misura in JS** — è quello
che fa già `AdminNav` per decidere se sollevare i FAB, ed è il motivo per cui
una regola CSS fissa che sollevava il bottone era sbagliata: vinceva su una
misura vera.

**Un test può presidiarlo.** `tests/tablet.test.mjs` pretende che barra e
bottoni flottanti abbiano lo stesso `bottom` (senza fissare quale);
`tests/impostazioni.test.mjs` vieta di scrivere `--sw-*` a numero fuori da
`switch.css`. Due righe di prova che chiudono una classe intera di difetti.

## Tablet in orizzontale — la scala al dito (03/10/2026)

Un iPad orizzontale è largo 1024–1366 CSS, cioè **quanto un laptop**, e per la
scala del motore è un desktop (il confine è 1023/1024). Ma lo si guarda da più
lontano e lo si tocca col dito: header, pillole e barra, pensati per un
monitor, mangiavano mezzo schermo.

`src/styles/tablet.css` (importato da `AdminHead`) abbassa il **piede di
misura** a 13px in quella fascia. Le pagine admin sono per circa il 60% in
`rem`, quindi testi, spazi, bottoni e pillole scendono **tutti insieme** senza
toccare mille regole.

⚠️ **`pointer: coarse` non è un dettaglio**: senza, la regola prenderebbe anche
i portatili da 1280, che sono tanti. Si attiva solo su uno schermo che si tocca
col dito — e per vederla sul Mac serve il DevTools in modalità dispositivo
(iPad): è l'emulazione del **tocco** che l'accende, non la larghezza.

⚠️ **Il `rem` non tocca i px.** Tutto ciò che è scritto in pixel — logo,
bottoni quadrati, icone, altezze minime dei campi, `left` dei FAB — resta
grande in mezzo a tutto il resto rimpicciolito, e va ritoccato **con la stessa
media query**, dentro il componente che lo possiede. È anche il motivo per cui
due bottoni tondi messi a `1.5rem` e `5.6rem` si sono avvicinati fino a
toccarsi: `left` è sceso, la larghezza no. La distanza fra due elementi si
calcola dal pezzo che li separa (`calc(primo + larghezza + spazio)`), non si
indovina.

⚠️ **Attenzione alle regole `@media (pointer: coarse)` senza larghezza**: ce
n'erano di pensate per il telefono (campi ora a 42px, perché lì tutto il resto
è grande) che su iPad orizzontale restavano alte il doppio delle righe intorno.

## La stampa dei ticket — chi chiama chi (04/10/2026)

Il motore gira su un server, la stampante sta in una cucina a Bruxelles. Fra
i due non c'e' nessuna strada diretta: l'indirizzo di quella stampante esiste
solo dentro il Wi-Fi del locale, e nessun server al mondo lo raggiunge.

**Quindi non siamo noi a parlare alla stampante. E' la stampante che chiama
noi.** Ogni soluzione che funziona — BizPrint con l'app sul tablet, Star
CloudPRNT, Epson Server Direct Print — fa questo e solo questo: qualcosa nel
locale bussa ogni pochi secondi e chiede se c'e' qualcosa da stampare.

Tre regole che ne discendono, e che non vanno riaperte a ogni cliente.

**1. La destinazione e' UN pezzo solo.** «Dove mando il ticket» si decide in
un posto: oggi BizPrint, domani una stampante autonoma, e per un cliente alla
volta. Se la scelta si infilasse nel codice che compone il ticket, cambiare
fornitore vorrebbe dire riaprire sei repository.

**2. Il disegno del ticket vive nel CLIENTE, il meccanismo nel MOTORE.** Il
motore sa quando stampare, tiene la coda, riprova e conferma; il cliente ha un
file che, dato un ordine, restituisce le righe. Il cliente non vede mai un
byte di stampante ne' il nome del fornitore. Vantaggio secondario non piccolo:
un file che esiste solo nel cliente non va MAI in conflitto in un merge — ed
e' esattamente da file presenti in tutti e due i posti che sono nati i quattro
guasti da auto-merge del 03/10.

**3. La station e' della SEDE, l'applicazione e' del CLIENTE.** Stessa forma
dei conti Stripe. Il ticket parte verso la station scritta NELL'ORDINE, mai
verso quella della sede selezionata nell'header: con tre punti, l'aggregato
manderebbe la comanda alla cucina sbagliata. E' la stessa regola che
`ambitoDiRiga()` gia' impone all'annullo.

⚠️ **«Stampato» lo dice la stampante, non noi.** Lo stato passa per `sent`
prima di `printed`, e diventa `printed` solo sulla conferma di ritorno. Senza
quel passaggio non si distingue «uscito» da «la stampante era spenta»: o si
perdono ticket segnati come fatti, o si ristampa e in cucina arrivano due
comande, cioe' due pizze. La protezione dal doppione sta nell'INDICE UNICO del
database (`print_tickets`, solo righe `auto`), non nel codice che inserisce:
due richieste possono arrivare nello stesso istante.

⚠️ **La stampante non riceve un DOCUMENTO, riceve dei COMANDI** (provato il
05/10/2026, su carta). L'API di BizPrint vuole l'indirizzo di una pagina, e
questo fa credere che basti scrivere il ticket in HTML. Non e' cosi': il
servizio **passa il contenuto alla stampante senza toccarlo**, e una termica in
**ESC/POS** stampa come testo tutto quello che le arriva. Mandato l'HTML, e'
uscito il sorgente. Mandato un PDF, sono usciti i byte del PDF — un foglio
intero. Il PNG sarebbe finito uguale.

Quindi il ticket e' un **flusso ESC/POS**: `ESC @` per iniziare, `GS ! 0x11`
per la doppia altezza e larghezza, `ESC E` per il grassetto, `GS B 1` per il
bianco su nero (la fascia «DA INCASSARE» del disegno c'e' lo stesso), `GS V`
per il taglio. Il disegno non si perde, cambia mezzo: non piu' CSS ma righe e
comandi — ed e' la strada piu' leggera delle tre, perche' non serve nessun
Chromium sul server per generare un'immagine o un PDF.

Da qui due conseguenze pratiche:
- **La misura e' la COLONNA, non il pixel.** Carta da 80 mm, font A: 48
  colonne. Un nome di piatto piu' lungo va a capo, e dove va a capo si decide
  contando caratteri. (Le misure in dot servono solo se un giorno si stampa un
  logo, che e' un'immagine raster a parte.)
- **Gli accenti si scrivono in UTF-8, e basta** — e ⚠️ **`ESC t` non va
  mandato.** Provato su carta il 05/10: la riga in UTF-8 senza nessun `ESC t`
  esce perfetta, accenti ed euro compresi. Quelle scritte a mano nelle tabelle
  della stampante (cp437, cp850, cp858, cp1252) escono TUTTE sbagliate, perche'
  quei byte non sono UTF-8 valido e vengono rovinati PRIMA della stampante:
  l'app legge il file come testo, lo decodifica e converte lei verso la
  testina. Avevo scritto il contrario in questa stessa pagina un'ora prima,
  ragionando su come funziona una termica collegata a un cavo: ma qui in mezzo
  c'e' un'app, e il ragionamento valeva per una catena diversa da questa.

### Piu' stampanti: il REPARTO (deciso il 05/10/2026, da costruire)

Un cliente vuole le pizze dal forno, le bibite dal bar, i freddi dai freddi.
Il pezzo da introdurre **non e' «la stampante», e' il reparto**: ha un nome e
una stampante, e le categorie del menu puntano al reparto, mai al numero della
stampante. Il giorno che la stampante del bar si rompe si cambia **un numero
in un posto solo**; se le categorie puntassero alla stampante si
riassegnerebbero quaranta categorie, dimenticandone una — e per settimane le
bibite uscirebbero in pizzeria.

**La scelta vive sulla CATEGORIA**, cioe' dove il ristoratore mette gia' i
piatti, non in una seconda tabella di regole da tenere allineata. Aggiungi
«Dolci» e scegli li' dove esce. Un piatto nuovo eredita dalla sua categoria e
non puo' restare orfano. (`kind` food/drink esiste gia' e non basta: antipasti
e pizze sono tutti e due cibo.)

⚠️ **L'indice unico della #76 va rifatto.** Oggi e' `(order_id, kind) where
origin = 'auto'`: con una stampante sola e' giusto, con tre reparti **vieta
esattamente quello che serve** — il secondo e il terzo ticket dello stesso
ordine li rifiuta il database. Diventa `(order_id, reparto)`. Se lo si scopre
in cucina invece che qui, lo si scopre perche' le bibite non escono mai.

**Ogni ticket porta la testa intera e solo i suoi piatti**: ora di ritiro,
numero e «DA INCASSARE» uguali su tutti, poi le sue righe. In fondo
**`1/3 — altre 2 righe al bar`**: senza quel conteggio chi prepara non sa se
l'ordine e' completo, e un ticket che sembra tutto l'ordine quando e' un terzo
e' peggio di nessun ticket.

**Il ticket «pass» con l'ordine intero** — per chi compone il sacchetto e
incassa — e' un interruttore per sede: lo vuole chi ha un banco, non chi
lavora in due.

**Chi ha una stampante sola non configura niente.** Nessun reparto definito =
un reparto solo, tutto li'. La configurazione si presenta a chi la cerca.

**La stampante si sceglie da un elenco, non si copia a mano**: il pannello
tira le stampanti dall'API, come `scripts/bizprint-lista.mjs`. Un numero
copiato male e' un ticket che non esce, e nessuno che sappia perche'.

⚠️ **Uno script che stampa una risposta di un'API maschera TUTTO, non le
chiavi che conosce.** Il 04/10 `scripts/bizprint-lista.mjs` mascherava le due
chiavi dell'applicazione — le uniche a cui avevo pensato — e ha stampato in
chiaro le chiavi segrete delle due station, che stavano nella risposta. Sono
finite in chat, e le station sono state rifatte da zero. La maschera si scrive
sul NOME del campo (`secretKey`, `publicKey`, `key`, `token`), non sul valore
che ti aspetti.
