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

Fatti: **Home** (tile Tuiles), **SpecialDaysForm** (servizi),
**reservations** (`.sv-switch`) e **clients** (`.afl-sw`, i due permessi).
Da fare: `agenda`, `google`, `marketing`, `menu`, `settings`, `super`,
`orders`.

## Campi — il componente unico (deciso 11/09/2026)

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

