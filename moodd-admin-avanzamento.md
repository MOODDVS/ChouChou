# RestoHub — Motore multi-cliente · Avanzamento & decisioni

Diario del MOTORE (template `MOODDVS/MOODD-Admin`). I clienti hanno i loro progetti Claude (es. «La Molisana»). Aggiornato man mano.

## 📌 07/09/2026 — sessione Cowork (notifiche al ristoratore in lingua admin + tempo di preparazione dal tile + jours spéciaux condivisi)

### 🧩 Home: i layout dentro le tile misuravano la cosa sbagliata
- Stringendo la finestra, nella tile **Cucina** «Fasce / 15 min» si **sovrapponeva** ai chip del tempo di preparazione; Ordini e Statistiche si schiacciavano.
- **La causa non era una soglia sbagliata, era il metro**: `@media (max-width: 700px)` su `.st-grid` misura la **FINESTRA**, ma la tile sta dentro una colonna della griglia. A tre colonne su uno schermo da 1200px la tile è larga ~380px, e la media query diceva ancora «c'è spazio, affianca».
- Risolto **togliendo la soglia** e lasciando che i blocchi vadano a capo da soli: `flex-wrap: wrap` + una base sensata (`flex: 1 1 240px` e simili) su `.st-grid`, `.st-two`, `.st-facts`, `.ord-two`, `.sched-two`; `.cui-prep` con i chip che vanno a capo e «Fasce» che non si accavalla più (`flex: 0 1 auto` sulla prima metà).
- Una deviazione in meno (il 700 di `index.astro`) **e** un layout che non dipende più dalla larghezza della finestra. Nota per il futuro: il tool giusto per questi casi sono le **container query** (`@container`), supportate da tutti i browser dal 2023 — qui è bastato il wrap.

### 📐 Breakpoint: scala decisa, conversione UNA PAGINA ALLA VOLTA
- **Correzione a quanto detto prima**: «definire le soglie in `:root`» NON si può. Le variabili CSS non funzionano dentro `@media` (`@media (max-width: var(--bp))` non è valido); servirebbe un plugin PostCSS, cioè una dipendenza di build su ogni cliente. La scala è una **convenzione applicata a mano**, scritta in `ENGINE.md` e in nessun altro posto.
- **Il conteggio vero è 91 deviazioni, non 230**: la prima misura contava anche i `min-width` dentro le regole normali. Guardando solo `@media` e `matchMedia`, il lavoro è molto più piccolo di come sembrava.
- **Scala: 640 · 900 · 1024 · 1280**, convenzione «il numero è il `max-width`, il `min-width` è +1». Non è inventata: erano già le tre più usate (640 × 40, 900 × 28, 1024 × 16). Nel codice convivevano due grafie della stessa coppia (`max 1023 / min 1024` e `max 1024 / min 1025`).
- **Eccezioni dichiarate** (hanno una ragione): home/tile 760-920-1280 dentro `--cols`, 1366 iPad orizzontale, 834 iPad verticale, 390 telefono stretto.
- ⚠️ **Perché una alla volta**: spostare una regola da 520 a 640 **cambia il comportamento** fra quelle due larghezze. `astro check` ed esbuild non vedono niente — è puramente visivo, su 4 clienti di cui 3 live.
- ✅ **Fatto: `AdminNav.astro`** (5 deviazioni). Aveva 560 per nascondere il bottone super admin e 520 per far scorrere la barra: due modi di dire «mobile» a 40px di distanza.
- 🐛 **E ha fatto emergere un bug vecchio**: su iPad mini verticale (768px) la barra **usciva dallo schermo** da entrambi i lati. Causa: `.admin-nav` è `left: 50%` + `translateX(-50%)` **senza `max-width`**, quindi cresce col contenuto; e `flex: 0 0 auto` sulle voci stava solo nel blocco mobile, per cui sopra la soglia le voci si **schiacciavano** invece di far scorrere. Fra 521px e il desktop la barra sbordava, da sempre.
- **Risolto legandolo al CONTENUTO, non a una soglia**: `max-width: calc(100vw - 2rem)` + `overflow-x: auto` nella regola BASE, `flex: 0 0 auto` sulle voci sempre, e lo scroll della voce attiva ora parte da `scrollWidth > clientWidth` invece che da un `matchMedia`. Il blocco mobile dedicato allo scroll è **sparito**: il punto in cui le voci non ci stanno dipende da quante ne ha attive quel cliente, non da una larghezza scelta a mano.
- Nel file restano due `@media (max-width: 640px)`: nascondere il bottone super admin e la posizione del toast. Entrambe scelte, non larghezze indovinate.
- ✅ **Fatto: `styles/fab.css` e `styles/savebar.css`** (5 deviazioni ciascuno, e sono condivisi da TUTTE le pagine admin). 520 → 640, 521 → 641, e le due grafie della stessa coppia (`max 1023` e `max 1024`, nello stesso file) unificate su 1024.
- In `fab.css` c'erano **due media query con la stessa identica dichiarazione** (`.fab-add` a `0-520` e a `521-1023`): una sola regola scritta due volte, ora `@media (max-width: 1024px)`.
- ✅ **Fatto: tutta la famiglia «FAB + isola nav», in blocco su 8 file** (`AdminNav`, `AdminHead`, `AdminHeader`, `clients`, `index`, `menu`, `orders`, `reservations`). **Non andava spezzata**: è un sistema solo, con tre `matchMedia("min-width: 521px")` nelle pagine che devono combaciare con `fab.css`. Convertendo `fab.css` a 641 e lasciando indietro le pagine, fra 521 e 640 JS e CSS si sarebbero contraddetti — desincronizzazione introdotta da me. Ora i tre `matchMedia` hanno anche il commento che dice con chi fanno coppia.
- ~~Nella stessa passata: `≤1023` → `≤1024` ovunque~~ — ❌ **SBAGLIATO, annullato l'08/09 su tutti e 7 i file** (`fab.css`, `savebar.css`, `menu`, `orders`, `reservations`, `AdminHeader`, `AdminNav` incluso il ramo `innerWidth <= 1023` nel JS).
- 🐛 **L'errore**: la mia convenzione diceva «il numero è il `max-width`, il `min-width` è +1», quindi 1024 → coppia `1024/1025`. Ma **1024 è la larghezza dell'iPad in orizzontale**, e con `max-width: 1024` quel dispositivo passa dalla parte **tablet**: i FAB si sarebbero sollevati sopra l'isola nav esattamente a 1024, su un dispositivo che usi.
- L'ho scoperto leggendo un commento già nel codice, in `google.astro`: «Desktop + iPad orizzontale» su una `min-width: 1000`. Il codice sapeva la risposta, la convenzione no.
- **Il confine desktop è quindi `1023 / 1024`**, unica coppia della scala che non segue l'aritmetica. Riscritta in `ENGINE.md` come tabella esplicita, con l'avviso.
- ℹ️ Restano a `max-width: 1024` le regole che danno la **taglia** ai pill (`fab.css .fab-pill`, `savebar.css .save`): il loro commento diceva già «Tablet (incluso iPad mini landscape 1024)», è una scelta precedente e non l'ho toccata.
- ⚠️ Durante quella conversione ho **rotto un commento CSS** chiudendo `*/` a metà: l'ha preso `esbuild` sul blocco `<style>` estratto. Lezione: sui `.astro` conviene passare all'esbuild anche il CSS, non solo lo script.

- ✅ **Fatto: `google.astro`**. `560` × 2 → `640`; la coppia `999 / 1000` → `1023 / 1024` (le due sezioni «Informazioni» a 3 colonne e «Orari» affiancati restano quindi accese sull'iPad orizzontale); `.g-split` da `max-width: 1000` a `1023`.
- **Non toccate, dichiarate eccezioni**: `1180` (larghezza massima iPad orizzontale, come 1366) e la coppia `1024 / 1025` del tab Post, che è **guardata da `orientation`** — l'iPad orizzontale entra dal ramo `landscape + min-width: 901` e non passa a modale, il `1025` chiude solo il ramo `portrait`.

- ✅ **Fatto: `clients.astro`** (leggibilità + una colonna in meno).
- **Dati in bianco pieno, non in grassetto**: `.cell a` (email e telefono) era `var(--c-muted)`, cioè lo stesso grigio delle etichette. Ora `var(--c-text)` con `font-weight: 400`. Anche la pillola lingua scende da 700 a 400. Il **nome resta a 700**: è l'unico elemento che deve saltare all'occhio in una riga.
- **Colonna «DA» (data di primo contatto) nascosta anche fra 1025 e 1279**: era già via sotto i 1024, ma è nella fascia desktop stretta che email e telefono iniziavano a tagliarsi. I 136px liberati vanno alle due colonne flessibili. Sopra i 1280 la colonna resta. La data è comunque sempre nella scheda cliente.
- Nel blocco nuovo c'è anche la variante `.no-orders`: quella regola ha specificità `0,2,0` e senza il gemello vincerebbe sulla griglia nuova nei clienti senza modulo ordini — stessa trappola già annotata per il mobile.

### 👥 Clienti: la lista si stringeva, e la colpa non era di una soglia
- **Le larghezze delle colonne non stanno piu nei `@media`, stanno nel JS** (`COLONNE` in `clients.astro`, che scrive `--grid-cols` su `.table`). Motivo: da adesso il set visibile dipende anche da una **scelta dell'utente**, e il CSS non la puo conoscere. Sparite quattro `grid-template-columns` duplicate (base, `.no-orders`, tablet, `.no-orders` tablet) e i `display:none` per colonna sparsi nei media query.
- **Selettore colonne** accanto alla ricerca: un bottone che apre un menu con una casella per colonna (email, telefono, lingua, DA, prenotazioni, ordini, totale). La preferenza resta in `localStorage` (`mdd_cli_cols`), dentro `try/catch` perche in navigazione privata l'accesso stesso puo lanciare.
- Le colonne che a quella larghezza sono **nascoste comunque** (email e DA sotto i 1025, DA sotto i 1280) restano nel menu ma disabilitate, con il perche nel `title`: cosi la casella spenta non sembra un bug. La preferenza resta salvata e torna quando la finestra si allarga.
- **Lingua: via la colonna, la bandierina va sul badge** (angolo in basso a destra dell'avatar). Sono 56px + un gap recuperati su ogni riga per un dato che e' una sola informazione. La colonna esiste ancora e si riaccende dal menu, ma parte spenta.
- ⚠️ `.c-avatar` aveva `overflow: hidden` (serviva a ritagliare la foto in tondo): avrebbe **tagliato la bandierina**. Spostato il `border-radius` sull'`img`.
- **Prenotazioni e ordini avvicinati fra loro e al totale**: 86 → 66px, totale 110 → 120px (ci deve stare `1 358,00 €` senza puntini), `gap` 0.75 → 0.65rem. In tutto ~50px che tornano a email e telefono, che erano le due colonne che si troncavano.
- **Totale a zero → `—`**: un cliente senza ordini, o un cliente di un locale che non somma il conto alle prenotazioni, vedeva `0,00 €` su ogni riga. Zero speso non e' un importo, e' un'assenza: stesso trattino delle altre celle vuote, in grigio e col font del corpo.
- 🐛 **Il bottone cancella usciva dalla riga** appena si spegnevano email e telefono dal menu. Causa: la colonna nome era `var(--col-nome)`, una **larghezza fissa** (fino a 440px), ed email/telefono erano le uniche tracce `fr`. Tolte quelle, la griglia era tutta fissa: se la somma supera la riga, il grid **sborda** invece di stringersi, e a sbordare e' l'ultima colonna, cioe' le azioni.
- Risolto con `minmax(120px, var(--col-nome, 220px))`: quando c'e' spazio il nome resta intero come prima (le tracce `fr` si prendono l'avanzo), quando non ce n'e' il nome si stringe fino a 120px invece di spingere fuori i bottoni. **Non era una soglia da spostare: era una griglia che non poteva restringersi.**
- **Colonna lingua tolta anche dal menu**: con la bandierina sul badge era la stessa informazione due volte, e una colonna fissa in piu' che spingeva verso il bordo. Restano i filtri per lingua nella barra. Via anche `langCell()`, `.c-lang-pill`, `.c-lang-none` e la regola mobile che piazzava la pillola in alto a destra nella scheda.
- 🔎 **Trovato per strada, NON toccato**: `.thead { display: none }` nella regola base, e non c'e' nessuna regola che la riaccenda. L'intestazione con i bottoni di ordinamento e' quindi **invisibile a tutte le larghezze** — il codice di sort c'e' ed e' vivo, ma non e' raggiungibile. Da decidere se rimetterla o togliere il codice.

### 📐 `menu` e `agenda`: tre soglie tolte invece che rinominate
- **`menu.astro`**: unica deviazione, il `780` del modale piatto/formula, ripetuto due volte. Portato a **760**, non a 640 ne a 900: e' la stessa domanda del modale Nuova prenotazione (due colonne dentro un modale largo), e li la soglia era gia stata verificata a schermo. Due valori diversi per la stessa decisione sono la deriva che questa scala deve chiudere.
- **`agenda.astro`**: quattro deviazioni, e tre non andavano convertite ma **tolte**.
- `@media (max-width: 1024px)` sui tab (`.mtabs`): sotto quella soglia i tab scorrevano, sopra andavano a capo. Ma **quanti tab ci sono dipende dai moduli attivi del cliente**, non dalla larghezza. Ora scorrono sempre quando non ci stanno (`flex-wrap: nowrap` + `overflow-x: auto` nella regola base, `flex-shrink: 0` sui tab), come la barra di navigazione. Soglia sparita.
- `@media (max-width: 520px)` su `.gs-packs`: quella griglia sta **dentro un modale**, e la larghezza della finestra non dice quanto sia largo il contenitore — stesso errore di metro delle tile della home. Ora `repeat(auto-fit, minmax(130px, 1fr))`: 3 → 2 → 1 da sole.
- `@media (max-width: 720px)` su `.n-stats`: stessa cura, `minmax(200px, 1fr)`. Prima saltava da 3 colonne a 1 senza passare dal 2.
- **`marketing.astro`**: le stesse tre deviazioni di `agenda`, perche le due pagine condividono gli stessi blocchi (`.mtabs`, `.gs-packs`, `.n-stats`) copiati. Stesso trattamento: tab scorrevoli legati al contenuto, `520` e `720` **tolti** passando a `auto-fit`. Resta il solo `640` canonico e i due `innerWidth <= 900`.
- **I bottoni «aggiungi» di marketing diventano FAB.** Erano quattro `.pill` grigie in cima al pannello (`+ Nuovo pop-up`, `+ Nuovo coupon`, `+ Nuovo buono regalo`, `+ Nuova newsletter`), l'unica pagina admin che non usava il bottone corallo in basso a destra. Ora usano `fab.css` come Clienti/Ordini/Prenotazioni: `class="fab-add fab-pill"`, `<span class="fab-plus">+</span>` e l'etichetta corta (`+ Pop-up`, `+ Coupon`…), col testo lungo nel `title`.
- Ne servivano quattro, uno per tab. **La visibilita e' legata al PANNELLO, non al nome del tab**: `.mk-fab` compare se il suo `#tab-<x>` non e' a `display:none`. Cosi un tab spento dal super admin non lascia in giro un bottone che apre un modale irraggiungibile — sarebbe successo con un controllo sul solo nome del tab.
- Le tre `.actionsbar` rimaste vuote sono sparite (avevano `margin-bottom: 1.5rem`: un buco al posto del bottone). Quella dei buoni regalo resta, ma con il solo «Acquista buoni», che non e' un'azione «aggiungi».
- Un `dispatchEvent(new Event("resize"))` alla fine di `mostraTab`: il FAB compare o sparisce cambiando tab, e AdminNav rimisura sul resize se va sollevato sopra l'isola.
- **Stessa cosa in `assets`**: `+ Immagine` e `+ Documento` erano due pillole corallo dentro la `.topbar`, accanto al titolo. Ora sono FAB (`fab.css`, etichetta corta + testo lungo nel `title`), e la `.topbar` torna a contenere solo il titolo — via anche lo `<span class="spacer">` che serviva a spingerle a destra.
- Il JS mostrava/nascondeva i due bottoni per tab con `style.display`, e continua a funzionare identico: `display: ""` ricade su `inline-flex` di `.fab-pill`. Aggiunto solo il `dispatchEvent("resize")` per far rimisurare AdminNav.
- `.add-btn` e `.pill` **eliminate** da `assets`: dopo la conversione non le usava piu nessun elemento. Resta una regola per lo stato disabilitato del FAB durante il caricamento, che `fab.css` non prevede (altrove i FAB non si disabilitano).
- **`assets.astro`**, breakpoint: una sola deviazione, `@media (max-width: 1024px)` sui tab — **tolta**, non convertita, come in `agenda` e `marketing`. Qui la ragione e' ancora piu netta: i tab della riga sotto sono **le pagine del sito di quel cliente**, quindi da tre a dieci a seconda del progetto. Nessuna larghezza fissa puo sapere quando non ci stanno. Resta il solo `640` che infittisce la griglia delle miniature.
- Le griglie di `assets` (`.grid`, `.site-slots`) usano gia `auto-fill` ed e' **giusto**: sono miniature, con due immagini devono restare piccole. Stessa lettura di `.foto-grid` in `google`.
- ⚠️ Nota per il futuro: `.mtabs`, `.gs-packs` e `.n-stats` esistono **identici** in `agenda` e `marketing`. Sono candidati a un componente condiviso — finche restano copiati, ogni correzione va fatta due volte.
- Il `780` del modale evento → **760**, come `menu`. Resta il solo `640` canonico e i due `innerWidth <= 900` del posizionamento popover.
- 🐛 **E a una colonna le due meta del modale evento si accavallavano.** Non era la soglia: era che a una colonna il contenitore restava un `grid`. Ha un'altezza definita dal flex (`flex: 1 1 auto` dentro un modale `max-height: 90vh`), e in quel caso le righe implicite non si comportano come ci si aspetta. **`display: block`**, cioe flusso normale, dove la sovrapposizione e' impossibile per costruzione — la stessa soluzione che `menu.astro` aveva gia adottato, con il suo commento accanto. Aggiunto `margin-top` fra i due blocchi perche in block il `gap` del grid non vale piu.
- E' la terza volta in questa sessione che il colpevole e' lo **stesso**: una griglia a due colonne che a una colonna resta una griglia (`reservations` con `grid-template-rows: minmax(0,1fr)`, ora `agenda`). Da qui in avanti: modale a due colonne che collassa → `display: block`, non `grid-template-columns: 1fr`.

### 🔵 Google: soglie gia a posto, ma i KPI erano `auto-fill`
- I breakpoint di `google.astro` erano gia stati convertiti prima. Ripassata la pagina cercando le classi di problema viste altrove, ed e' saltato fuori un bug che non ha niente a che vedere con le soglie.
- `.dt-kpis` (fascia KPI del tab Dati) era `repeat(**auto-fill**, minmax(150px, 1fr))`. I KPI sono da 5 a 8 — tre compaiono solo se quel cliente ha prenotazioni, ordini o messaggi. Con `auto-fill` le **tracce vuote restano**: su uno schermo largo ci stanno 7 colonne, 5 carte da 150px e mezza fascia vuota a destra. Con `auto-fit` le tracce vuote collassano e le carte si allargano a riempire.
- 🐛 **Spazi disuguali fra i campi della scheda**: fra «Nome attività» e «Stato attività» ci sono 2rem, fra «Stato» e «Descrizione» 1rem. Causa: `.fi-field` ha `margin-bottom: 1rem` **e** `.fi-row2`/`.fi-row3` hanno `gap: 1rem`. I campi dentro una riga pagavano due volte. Non si vedeva finche le righe erano davvero a due o tre colonne (il gap era orizzontale); si vede su desktop, dove la sezione Informazioni riduce ogni riga a **una colonna sola** e quel gap diventa verticale.
- Risolto togliendo il doppione: `margin-bottom: 0` sui `.fi-field` dentro una riga, e `margin-bottom: 1rem` sulla riga stessa. Ora lo spazio fra due campi lo decide una cosa sola, ovunque.
- **Tab Recensioni, larghezze strette.** Il masonry misura gia la cosa giusta (`listEl.clientWidth`, non la finestra) e ricalcola al resize: il problema era **dentro la card**. A tre colonne una card e' larga ~290px, e di quei 290 l'avatar ne prende 44 e le stelle ~85: al nome dell'autore restano ~110px. Il nome non aveva ne `overflow: hidden` ne ellissi, quindi invece di accorciarsi **spingeva fuori le stelle**.
- Aggiunta l'ellissi su `.rev-name` e `.rev-date`, `flex: 1 1 auto` su `.rev-who` e `flex: 0 0 auto` sulle stelle (che ora non si muovono piu). Stessa cura di `.c-name` nella pagina clienti.
- 🐛 **E quando la scheda business e le recensioni si impilano, le card uscivano dallo schermo.** Causa: `.g-split` ha `align-items: flex-start`. In `flex-direction: row` agisce sull'asse verticale (le due colonne partono in alto, giusto), ma quando diventa `column` **agisce sull'asse orizzontale**: i figli si dimensionano sul contenuto invece di riempire la larghezza. `.g-fiche` aveva gia `width: 100%` nel media query, `.g-reviews` no — e una lista flex di tre colonne larga quanto il suo contenuto esce dallo schermo. Aggiunto `width: 100%`.
- **Impilato = una colonna sola.** Il masonry misurava `listEl.clientWidth`, che una volta impilata torna larga quanto la pagina: ricalcolava 3 colonne proprio dove la pagina ha appena deciso di essere a colonna singola. Ora sotto i 1024 `colCount()` ritorna 1 senza misurare niente.
- Alzata anche la larghezza minima di colonna da **300 a 340px**: sotto i 340 una card (avatar 44 + nome + stelle 85) sta stretta. Cosi le tre colonne arrivano solo su schermi davvero larghi.
- Nella stessa passata, tre punti che sarebbero usciti allo stesso modo: `.rev-edit .row` (i due bottoni della risposta) ora va a capo; `.g-locbar` (barra della sede collegata) va a capo invece di far uscire il bottone «cambia»; `.pick-name` / `.pick-addr` del selettore sede si accorciano con l'ellissi.
- **Tab Post su tablet e mobile: impilato, niente piu modale.** Sotto i 901 (o in verticale sotto i 1025) il riquadro «pubblica» spariva dentro un modale che si apriva da un FAB. Ora sta semplicemente in cima alla pagina, con la lista sotto: e' quello che il layout a blocchi fa gia da solo.
- Tolti di conseguenza il FAB `#p-fab`, il bottone di chiusura `#p-close`, i tre listener, `apri()`/`chiudi()`, la classe `body.tab-posts` (usata solo per mostrare quel FAB) e il `dispatchEvent(new Event("resize"))` che serviva a riposizionare il FAB sopra l'isola. **~15 righe di CSS e ~8 di JS in meno per fare una cosa piu semplice.**
- `.p-overlay` rinominato **`.p-side`**: e' la colonna sinistra sticky del desktop, non un overlay. Il nome vecchio raccontava un comportamento che non esiste piu.
- `.foto-grid` resta `auto-fill` **apposta**, e ora ha il commento che lo dice: con due foto sole le miniature devono restare miniature, non allargarsi a mezzo schermo. E' la stessa differenza fra le due parole, letta al contrario.

### 📷 Google, tab Foto: il logo PNG non si caricava — colpa nostra
- Segnalato su Educazione Napoletana: il logo PNG viene rifiutato. La causa non e' Google, e' il nostro passaggio intermedio.
- `comprimiFoto()` **converte tutto in WebP** (e' quello che deve fare: una foto da 4 Mo scende a 200 KB). Ma **Google Business Profile accetta solo JPG e PNG**: il file arrivava a Google in un formato che non prende, e l'errore tornava dall'API come un messaggio generico.
- Aggiunta `preparaFotoGoogle()` in `imageCompress.ts`: **non cambia mai formato**, ridimensiona soltanto, e solo se il lato lungo supera 1600px. Il PNG resta PNG — trasparenza compresa, che per un logo e' il punto.
- Controlli fatti **prima** del giro di rete, con messaggi veri invece dell'errore di Google: formato diverso da JPG/PNG → «Google accetta solo JPG e PNG»; lato minore di 250px → «Google richiede almeno 250 × 250 px» (e' il minimo documentato da Google).
- Vale per **tutte e tre** le strade che portano un'immagine a Google: il tab Foto (logo, copertina, galleria), la foto dei post, e la scelta dalla **Libreria** — da li poteva arrivare un `.webp` gia caricato per il sito, che Google avrebbe rifiutato allo stesso modo.
- `accept="image/*"` sui due input file diventa `accept="image/jpeg,image/png"`: il problema si vede nel selettore del sistema, non dopo l'upload. E sotto la nota del tab c'e' ora la riga con i requisiti.

### 📐 `stats`: due conversioni e una griglia che saltava un passaggio
- `@media (min-width: 641px) and (max-width: **1024**px)` (numeri piu piccoli su tablet) → **1023**. Era la grafia sbagliata della coppia: cosi l'iPad in orizzontale prendeva la taglia tablet invece di quella desktop.
- `@media (max-width: **560**px)` su `.src-nom` (nome della sorgente nelle barre) → **640**. Era l'ennesimo modo di dire «telefono» a 80px di distanza dagli altri tre `640` dello stesso file.
- `.rkpi-grid` (le tre card KPI delle prenotazioni) era `repeat(3, 1fr)` con un salto a **1 colonna** a 640: fra 641 e 730 le tre colonne stavano strette, e sotto passava da 3 a 1 senza mai vedere il 2. Ora `repeat(auto-fit, minmax(230px, 1fr))`. Il layout mobile dedicato (una card per riga, corpo a due colonne) resta com'era.
- Il resto era gia canonico: due `900`, tre `640`, e `.tabs2` che scorre gia legato al contenuto.

### 📐 `print` e `super` (Admin)
- **`print.astro` non aveva NESSUN `@media`**: era gia interamente legata al contenuto (`.pgrid` in `auto-fill minmax(320px)`). Zero conversioni.
- 🐛 Ma proprio quel `minmax(320px, 1fr)` aveva un difetto classico: **sotto i 320px di contenitore la traccia non si stringe**, resta 320 e la griglia esce dallo schermo. Su un telefono da 360px con i margini della pagina il contenitore e' ~312px. Risolto con `minmax(min(320px, 100%), 1fr)`.
- Nella stessa passata, i punti che a card stretta o su telefono uscivano: `.pmodal-title` (nome del prodotto, ora con ellissi, e PDF/Chiudi con `flex: 0 0 auto` cosi non si spostano), `.pcard-foot` e `.omodal-foot` che ora vanno a capo, `.pcard-specs dd` e `.omodal-title` con `overflow-wrap`.
- **`login` e `reset-password`**: una deviazione a testa, lo **stesso** `860` — sono lo stesso layout (immagine a sinistra, form a destra) in due file. Portato a **900**.
- Verificato che non fosse un peggioramento: `.pane-form` e' `flex: .9` con dentro un blocco da 360px piu 1.6rem di padding per lato, cioe' ~411px per stare comodo. A 900 di finestra gliene toccano ~405, a 860 solo ~387. **Impilare a 900 e' meglio di impilare a 860**, non peggio: la conversione qui aggiusta anche il comportamento.
- **`super.astro`**: tre deviazioni, tutte conversioni secche. `min-width: 1080` (le due colonne di Design) → **1024**; i due `max-width: 560` (`.tema-rows`, `.pr-meta-grid`) → **640**. Il `900` della tabella utenti era gia canonico.

### 📐 `SpecialDaysForm` e `TileGoogle`: un 560 a testa, due storie diverse
- **`SpecialDaysForm`**: `@media (max-width: 560px)` faceva stringere i due campi orario invece di mandarli a capo. Ma questo form vive **dentro un modale**: la larghezza della finestra non dice quanto sia largo il contenitore. Soglia **tolta**, la regola vale sempre — con `max-width: 8rem` sui campi, cosi quando lo spazio c'e' restano della loro taglia naturale invece di allargarsi a tutta la riga.
- **`TileGoogle`**: `@media (max-width: 560px)` con il commento «tile impilate ad altezza automatica». Ma le tile si impilano a **759** (`--cols: 1` in `index.astro`), non a 560: **fra 561 e 759 le tile erano gia in colonna singola e la regola non partiva**, quindi la tile Google restava in modalita desktop (`min-height: 320`, commento con scroll interno) dove avrebbe dovuto seguire il flusso naturale.
- Portata a **759** e annotata come **coppia obbligatoria** con `--cols: 1`: non e' una soglia scelta qui, e' la stessa dell'altro file. Se un giorno cambia il `--cols`, va cambiata anche questa.

### 📐 `settings`: l'ultima, e la piu grossa — conversione CHIUSA
- Cinque deviazioni, la pagina piu lunga dell'admin.
- `@media (max-width: 1024px)` sui tab → **tolto**, non convertito: quarta pagina con lo stesso identico blocco (agenda, marketing, assets, settings). I tab scorrono quando non ci stanno, e basta.
- `@media (max-width: 1100px)` sul tab Prenotazioni a due colonne → **1279**. Non a 1024: le righe di quel tab hanno un `label` fisso da **300px**, quindi due colonne stanno comode solo su schermi larghi. Portarlo a 1024 avrebbe dato due colonne da ~480px con 300 di label e 180 di campo. Fra i due valori canonici possibili ho scelto quello che sbaglia verso la leggibilita.
- I due blocchi `@media (max-width: 700px)` → **640**. Verificato che la fascia 641-700 regga: la colonna e' larga ~650px, label 300 + campo ~320. Sotto i 640 i label si impilano sopra i campi come prima.
- `620` (riga a due campi del modale team) e `560` (riga giorno degli orari) → **640**. Erano due modi in piu di dire «telefono», in un file che aveva gia due `640`.
- **Decisa anche l'ultima domanda aperta, quella di `clients`**: la coppia `1024 / 1025` resta com'e', ed e' ora un'eccezione **dichiarata** in `ENGINE.md`. Fatti i conti invece di andare a intuito: la riga ha 348px di colonne fisse (pren, ord, totale, azioni) che con i gap diventano 410; su una finestra da 1024, tolti i margini, restano 938px, e con il nome a ~380 avanzano **~148px per email E telefono insieme**. Il layout desktop a 1024 darebbe due monconi illeggibili.
- Quindi su Clienti — e solo li — **l'iPad in orizzontale sta con i tablet**: ricerca in alto a destra, niente colonna email, font piu piccoli. La regola lo diceva gia nel suo commento; mancava solo la riga in `ENGINE.md` che la protegge da una futura «uniformata». La stessa coppia e' usata da `MQ_TABLET` nel JS delle colonne: CSS e JS devono restare d'accordo.
- ✅ **Con questa la conversione dei breakpoint e' chiusa.** In tutto il motore restano solo i quattro valori della scala, le eccezioni dichiarate in `ENGINE.md` e i `@media (pointer: coarse)`, che non sono soglie di larghezza ma di dispositivo.
- Bilancio: molte soglie non sono state convertite ma **tolte** (i tab scorrevoli in 4 pagine, `.gs-packs` e `.n-stats` in 2, `SpecialDaysForm`). Ogni volta la domanda vera non era «a che larghezza», era «quando il contenuto non ci sta» — e quella il CSS la sa rispondere da solo.

## 📌 08/09/2026 — Icona della PWA scegliibile per cliente

### 📱 L'app installata può portare il marchio del cliente
- **Non era una dimenticanza**: in `AdminHead.astro` c'era scritto «Installazione PWA: nome e icona **SEMPRE** RestoHub», e lo script anti-flash riscrive i `rel="icon"` col favicon del cliente ma lascia stare l'`apple-touch-icon` **apposta**. Qui non si riempie un vuoto, si rende configurabile una decisione presa.
- ⚠️ **Il favicon NON può fare da icona PWA.** Android vuole un PNG **quadrato** di almeno 192px (512 e' la misura buona): con un favicon da 32px o un SVG l'icona esce sgranata o l'installazione viene rifiutata. Percio' c'e' una casella **dedicata** in Réglages → Général → «Icona dell'app», e non un riuso del favicon.
- Nuova `generaIconaPWA()` in `imageCompress.ts`: mette l'immagine dentro un quadrato 512 in modalita **contain** su fondo trasparente. Un logo largo resta intero con aria sopra e sotto — meglio centrato che decapitato. Se la sorgente e' sotto i 512 avvisa ma lascia passare.
- **Il manifest non e' piu' un file statico.** Nuova rotta `src/pages/manifest.webmanifest.ts` che legge `app_config`. Due trappole evitate:
  - il percorso e' `.webmanifest`, **non** `/manifest.json`: i file in `public/` **oscurano** le rotte con lo stesso percorso, e `public/**` ha policy `merge=ours`, quindi il vecchio `public/manifest.json` sopravvive nei repo dei clienti e avrebbe vinto per sempre. Il file vecchio resta dov'e' (innocuo, non piu' referenziato).
  - `id: "/admin"` **non si tocca mai**: e' l'identita' dell'app per il sistema operativo. Cambiarlo darebbe due icone a chi l'ha gia' installata.
- **iOS ignora il manifest** per icona e nome dell'app: servono `apple-touch-icon` e `apple-mobile-web-app-title`, che ora sono condizionali in `AdminHead`.
- Il `<link rel="manifest">` era **ripetuto identico in 14 pagine**: spostato in `AdminHead` (12 pagine), tranne `login` e `reset-password` che non usano quel componente e hanno solo cambiato percorso.
- **Interruttore nel super admin** (Réglages), chiave `pwa_brand`. Spento e con la spiegazione se il cliente non ha ancora caricato l'icona — stessa cura dello switch push. E il ripiego «niente icona → RestoHub» sta in `caricaBootAdmin()`, **non** nell'interruttore: cosi vale anche se l'icona viene cancellata dopo averlo acceso.
- ⚠️ **Chi ha gia' installato l'app non vede il cambio**: il sistema fissa l'icona al momento dell'installazione. Serve disinstallare e reinstallare — scritto nell'interfaccia, altrimenti la prima segnalazione e' «l'ho attivato e non cambia niente».
- **Nessuna migrazione**: `app_config` e' chiave/valore.

### 🧹 Pulizia degli hint di `astro check`
- Motivo per farla: gli hint non rompono niente, ma **nascondono gli errori veri** — i 20 errori di L'Huile erano annegati in quella colonna.
- **Codice morto tolto** (verificato uno per uno che non fosse usato altrove): `avvolgiScuro` in `notifications.ts` (sostituito da `avvolgiTema`), `gGet` in `googleBusiness.ts` (si usa `gGetErr`), l'import `inviaPush` in `api/admin/push.ts`, `apriModale` in `clients.astro` (il commento accanto diceva già «ex apriModale»), il rilevamento iOS/Safari in `AdminHeader.astro` (la logica del bottone «Installa» è cambiata e non lo consulta più).
- **`is:inline`** aggiunto ai 4 blocchi `<script type="application/json">` di `print.astro` e `super.astro`: è quello che Astro chiede, e sono blocchi di soli dati che non vanno processati.
- **`scrolling="no"`** (attributo deprecato) tolto dall'iframe delle anteprime di stampa: stesso effetto con `overflow: hidden` nel CSS.
- ⚠️ **Lasciati apposta**: i 7 `document.execCommand` dell'editor rich-text in `agenda.astro`. È un'API davvero deprecata, ma riscrivere l'editor è un progetto, non una pulizia — e zittirli con un `ts-ignore` nasconderebbe una rottura futura vera.
- Non toccati gli hint nei file **per-cliente** (`Header.astro`, `contact.astro`, `feedback.astro`, `ContactForm.tsx`, `Layout.astro`): il merge non li porterebbe comunque.

### 🖨️ Email «Commande Print»: guscio come le altre
- Era l'unica email del motore in HTML nudo (un `<h2>` e due paragrafi). Ora ha lo stesso guscio delle email prenotazione: banda accento, nome del cliente in evidenza, riepilogo prodotto/quantità/importo in righe etichetta-valore, il richiamo sull'indirizzo di spedizione su fondo ambra e il wordmark RestoHub in fondo.
- Oggetto più utile in casella: `Nouvelle commande Print — <cliente> · 2× Cartes de visite`.
- Aggiunto l'escape sui valori (mancava del tutto: un nome prodotto con `<` avrebbe rotto il markup).
- Resta in **francese** di proposito: va a MOODD, non al ristoratore.

### ✉️ Disdetta contratto: la lettera va nella lingua del FORNITORE
- La richiesta di résiliation (Réglages → Documents → contratto) partiva **sempre in francese**. È l'unica email del motore che non va né al cliente né al ristoratore ma a un **terzo**: il fornitore. Quindi non segue `admin_lang` — segue la lingua del destinatario, che finora non chiedevamo da nessuna parte.
- **Migrazione #72** `admin_docs_lang.sql`: colonna `lang` su `admin_docs_meta`. NULL = lingua dell'admin, cioè il comportamento di prima.
- **UI**: selettore lingua (bandiera + nome nativo, da `LINGUE_WIDGET`) accanto all'email di riferimento nel modale del documento, con una riga che spiega *perché* è lì («la disdetta parte verso il fornitore: è la sua lingua, non la tua»). Si preseleziona sulla lingua admin.
- **Lettera tradotta in 5 lingue**, non solo il corpo: apertura, formula di disdetta, richiesta di conferma, procedura alternativa, saluti, **oggetto dell'email** e anche l'**unità del preavviso** («3 mesi» / «30 days»), che era salvata in francese e finiva dentro il testo tradotto.
- ⚠️ **Due ripieghi per la #72 non ancora lanciata**, perché senza si perdevano dati in silenzio: `salvaMeta` riprova l'upsert senza `lang` (altrimenti smettevano di salvarsi TUTTI i metadati del documento) e il GET rilegge senza (altrimenti la lista perdeva ogni metadato). Nota: supabase-js **ritorna** l'errore invece di lanciarlo, quindi il `try/catch` che c'era non bastava.

### 🧱 Home: scala delle colonne 4 / 3 / 2 / 1
- Prima la scala era **1 → 2 → 4** con le soglie a 560 e 1100: fra 561 e 1100 due colonne larghissime (a 1000px due tile da ~490px), poi di colpo quattro da ~260px. **La terza colonna non esisteva.**
- Nuova scala (scelta Enzo 08/09): **≥1280 → 4 · 920-1279 → 3 · 760-919 → 2 · <760 → 1**.
- La soglia mobile passa da 560 a **760**, e con essa TUTTO il blocco: impilamento, niente masonry, niente drag & drop, niente maniglie, FAB ridotto alla sola scelta delle tile. Sotto i 760 non c'è niente da riorganizzare, quindi i comandi spariscono. Un iPad mini in verticale (768px) resta appena sopra, a due colonne.
- ✅ **Duplicazione risolta** (08/09, secondo giro): le colonne sono la variabile CSS **`--cols`**, impostata dalle media query di `.cards` e usata sia da `grid-template-columns: repeat(var(--cols), …)` sia dallo script, che la rilegge con `getComputedStyle`. Le soglie compaiono **una volta sola**, nel CSS: cambiarle basta e avanza, drag & drop e ridimensionamento seguono da soli.
- La home ha **due blocchi `<script>` separati** (tile e organiser), quindi il lettore di `--cols` è scritto in entrambi: tre righe ciascuno, ma le soglie restano in un posto solo — che era il punto.
- Tolte anche le due eccezioni `@media (max-width: 759px)` di Statistiche e Foto: ridondanti, dentro il blocco stretto c'è già `.cards .tile { grid-column: 1/-1 !important }` che vale per tutte.
- Allineate anche le eccezioni `span 2` di Statistiche e Foto, che erano ferme a 560.
- **Nessuna migrazione**: la larghezza salvata di ogni tile (1-4) viene già tagliata alle colonne disponibili e torna al valore pieno su schermo largo.

### 🪑 Nuova prenotazione: colonne scrollabili e tavoli proposti sensati
- **Le due colonne del modale non scrollavano.** Le regole c'erano (`.nm-col { overflow-y: auto }` su desktop), ma `.nm-grid` è una **griglia** e le sue righe si dimensionano sul CONTENUTO: le colonne restavano alte quanto il contenuto, `overflow-y` non entrava mai in gioco e il fondo veniva tagliato da `overflow: hidden` del modale. Fix: `grid-template-rows: minmax(0, 1fr)` — dà alla riga un'altezza definita, e le colonne tornano a scorrere.
- 🐛 **Correzione del giorno dopo**: quel `minmax(0,1fr)` era stato messo sulla regola BASE, quindi valeva anche **a una colonna** — dove le due parti stanno in due righe. Bloccare l'altezza della prima riga faceva **accavallare** la seconda sopra la prima (il form cliente disegnato sopra gli slot orari). Ora il vincolo sta solo dentro `@media (min-width: 761px)`, e a una colonna le righe tornano `auto` con lo scroll sull'intera griglia. Lezione: un vincolo di altezza pensato per il layout a due colonne non va messo sulla regola condivisa.
- **Scelta manuale del tavolo**: il default mostrava solo la capienza ESATTA, e il «+N» apriva TUTTE le combinazioni — con tavoli da 8 proposti per 4 coperti. Ora il default è la finestra **[persone − 1, persone + 2]**: per 4 coperti si vedono le opzioni da 3, 4, 5 e 6 posti.
- Invariato quello che funzionava: il piano continua a **proporre** i tavoli con il bottone «Cambia» accanto, e dentro la vista Cambia resta il «+N» che apre comunque l'elenco completo, per i casi strani.
- Ripiego: se nella finestra non cade niente (4 persone e in sala solo tavoli da 8) si torna alla più piccola che basta — meglio una proposta larga di una lista vuota.

### 🛒 Checkout pubblico: due buchi chiusi (telefono + lingua del cliente)
- **Telefono e cognome non erano verificati dal server.** `OrderApp` non lascia inviare senza (nome, cognome, telefono, email valida, consenso), ma `api/checkout.ts` controllava solo `slot`, `email` e `name`: chi chiamava l'API fuori dal form creava ordini senza modo di richiamare il cliente. Ora il server ricontrolla quello che il form già esige.
- **La lingua del cliente veniva schiacciata su due valori.** `OrderApp` manda la lingua della pagina, ma il checkout faceva `body.lang === "en" ? "en" : "fr"`: un cliente italiano su Educazione Napoletana veniva **salvato come francese** e riceveva la conferma in francese. Stessa famiglia di bug dei ternari tolti da `OrderApp` il 06/09, un piano più sotto.
- Ora la lingua vera (5 lingue) finisce **sull'ordine**, che è quello che conta: le email al cliente passano da `pick5` e le 5 lingue le hanno già. Anche `etichettaVariante` segue la lingua vera.
- **Coupon**: `src/lib/coupons.ts` aveva `type Lang = "fr" | "en"` e un helper `msg(lang, fr, en)` — 9 messaggi con l'inglese come unico ramo alternativo. Sostituito da `TXT_COUPON` (11 chiavi × 5 lingue, con `minSpesa` parametrica) e `testiCoupon(lang)`, che accetta qualunque stringa e ripiega sul francese. Le firme prendono `string`, così chi chiama non deve restringere prima. Aggiornati anche i 4 messaggi scritti a mano in `api/coupon.ts`.
- **Prefisso Stripe**: era `lang === "en" ? "/en" : ""`, cioè il motore dava per scontato che il sito fosse francese con l'inglese sotto `/en`. Ora `stripe.ts` importa **`defaultLang` dal `src/i18n/ui.ts` del cliente** (file per-cliente, che tutti e 4 già espongono) e applica la stessa regola di `getLocalizedUrl`: lingua di default alla radice, le altre sotto `/<lingua>`. Il motore smette di indovinare il routing del sito pubblico e lo chiede al cliente — coerente col confine scritto in `ENGINE.md`.
- Tradotti anche gli ultimi due messaggi rimasti a due rami: «ordini momentaneamente chiusi» (`api/checkout.ts`) e l'etichetta del supplemento sulla pagina Stripe (`stripe.ts`).
- **Verifica**: `grep '=== "en" ?'` su checkout, coupon, coupons e stripe → **nessun residuo**.

### 🧾 Nuovo ordine: obbligatori NOME e TELEFONO (non più il cognome)
- Prima l'unico campo obbligatorio era il **cognome** (`Cognome *`), e il telefono era facoltativo. Al banco è il contrario: il cognome spesso non lo si chiede, il numero serve se il ritiro va storto.
- Ora: **Nome \*** e **Telefono \***, cognome facoltativo. L'email resta facoltativa e obbligatoria **solo** col link di pagamento — che via email va spedito.
- Un solo punto di verità lato client: `ncErroreCliente(payment)` restituisce il messaggio o stringa vuota, ed è usato sia dal passaggio di step sia dall'invio. Prima le due validazioni erano scritte due volte e potevano divergere.
- Messaggi separati invece dell'unico «Nome ed email validi richiesti»: `ord.namePhoneReq`, `ord.emailInvalid`, `ord.emailForLink` (5 lingue). Prima tre errori diversi davano la stessa frase.
- **Anche lato server** (`POST /api/admin/orders`): `first_name` e `phone` obbligatori, altrimenti la regola si aggira chiamando l'API.
- ⚠️ **La MODIFICA non li impone**, di proposito: gli ordini presi dal sito pubblico possono non avere il telefono (`api/checkout.ts` chiede solo nome ed email), e non si blocca una modifica per un dato mai raccolto. In modifica i placeholder perdono l'asterisco — stessa convenzione già usata per l'email (`emailReq`/`emailOpt`).

### 📅 Ordini: il datepicker apre anche sul futuro
- Nella pagina Ordini il calendario di consultazione bloccava tutto ciò che veniva dopo oggi: giorni disabilitati e freccia «mese successivo» spenta. Ma gli ordini si prendono **con ritiro programmato**, anche fra giorni: il ristoratore deve poter vedere in anticipo cosa lo aspetta.
- Tolti `futuro` sulle celle e `nextOff` sulla freccia. Resta il grigio sui **giorni di chiusura** (che erano e restano cliccabili) e il pallino verde sui giorni con ordini.
- Lato server non serviva niente: `/api/admin/orders?date=` e `?month=` filtrano per **intervallo** su `pickup_time`, senza sapere da che parte sta oggi.
- ⚠️ **Non toccato** il datepicker del modale «Nuovo ordine»: quello blocca il passato, ed è giusto così — un ordine non si crea per ieri.

### 🔕 Push: l'interruttore spento ora dice PERCHÉ
- Su ChouChou il toggle «Notifications sur cet appareil» non faceva **niente** al click; su L'Huile dava `applicationServerKey must contain a valid P-256 public key`. Due sintomi diversi, stessa causa: **chiavi VAPID mancanti nel `.env` del cliente** (ChouChou non aveva proprio le righe, L'Huile le aveva vuote).
- Il codice disabilitava il bottone e metteva la ragione **solo nel `title`**: un tooltip, che su touch non esiste e col mouse è facile non vederlo. Da fuori sembra rotto — è costato una diagnosi su due clienti.
- Ora le due cause sono **distinte e scritte sotto lo switch** (nel `.nf-msg` che c'era già): `set.nf.noKeys` (problema di installazione: env + rebuild) contro `set.nf.unavailable` (browser senza push, o pagina non in HTTPS). Più `.nf-sw:disabled { opacity: .45 }`, così si vede che è inerte.
- ⚠️ **Trappola da ricordare**: `PUBLIC_VAPID_KEY` è una variabile `PUBLIC_*`, quindi Astro la **incolla nel bundle al build**. Metterla su Hostinger e riavviare NON basta: senza rebuild il browser riceve ancora il valore vecchio.
- Stato chiavi al 07/09: La Molisana, L'Huile ed EN a posto (87/43 caratteri); **ChouChou da generare**.

### 📧 Notifiche al ristoratore: tutte nella lingua dell'admin (+ logo RestoHub)
- **Segnalato da EN**: admin in italiano, ma la mail «Nouvelle réservation» arrivava in francese. Le tre email prenotazione **verso il ristorante** avevano i testi scritti a mano in FR — non era un ripiego, era proprio l'unica lingua.
- Nuovo dizionario **`R_TXT`** in `notifications.ts` (5 lingue, stessa forma di `K_TXT` del ticket ordine) + helper `contestoRisto()` che restituisce lingua ed etichette in una lettura sola. Coperte: `emailNotificaResa` (nuova prenotazione E nuova demande), `emailNotificaAnnulloResa`, `emailNotificaModificaResa`.
- Tradotto **tutto** il guscio, non solo il titolo: oggetto della mail, banner, «Appeler le client», «couverts», Date / Heure / Service, Section, Options (comprese le cinque opzioni: seggiolone, posto tranquillo, pranzo di lavoro, compleanno, evento speciale), «Note :» e il piè di pagina. Anche la **data lunga**, la **data compatta** e il **nome del servizio** ora seguono il locale admin (`compattaData` prende la lingua, `labelService` pure).
- **Récap quotidiano «Votre journée»** (`dailyBrief.ts`): stesso trattamento, dizionario `B_TXT` con ~28 voci e i plurali per lingua, `LOC_BRIEF` per le date Luxon, nome dei servizi via `nomeServizio(key, LANG)` invece di `SERVIZI_WIDGET[...].fr`.
- **Slack cucina**: le etichette del messaggio (Client, Téléphone, Retrait, Commande, Total…) prese da `K_TXT`, che si è allargato con `client/phone/email/order/payment`.
- **Logo RestoHub** aggiunto in fondo alle email prenotazione al ristorante (il wordmark chiaro, come già nelle altre email; il brief ce l'aveva già).
- ⚠️ Restano volutamente in francese le mail che vanno a **MOODD**, non al ristoratore: `api/admin/docs.ts` (résiliation) e `api/admin/print-order.ts`. Il modulo contatto e le push erano già tradotti.

### ⏱️ Tempo di preparazione modificabile dal tile Cuisine
- Il tile «Cuisine» in home mostrava il tempo di preparazione come **valore statico**: per cambiarlo bisognava andare in Réglages. Ora ci sono tre **pillole 15 / 30 / 45** con «min» accanto, allineate a destra sulla stessa riga delle fasce.
- Il tile è un `<a>`: i click sulle pillole fanno `preventDefault` + `stopPropagation`, altrimenti si navigava via invece di salvare.
- Aggiornamento **ottimista** con `PATCH /api/admin/settings { prep_time_minutes }`; se il server rifiuta si torna al valore precedente. Un valore fuori dai tre preset (es. 20) genera una **quarta pillola** al volo, così non si perde mai il valore reale.

### 🗓️ Jours spéciaux: un solo form, due posti
- Richiesta: dal «+» del tile Jours spéciaux poter anche **chiudere/aprire** il ristorante, non solo aggiungere un evento locale. Scelta: **form completo ma CONDIVISO**, non una copia ridotta.
- Nuovo componente **`src/components/admin/SpecialDaysForm.astro`**: markup + CSS + script, tutto per **classe** (niente `id`), così due istanze possono convivere sulla stessa pagina. Lo script è unico (Astro deduplica) e inizializza ogni radice `.spf` che trova; la lista è **una sola sorgente** e tutte le istanze si riallineano insieme dopo un aggiunta o una cancellazione.
- Porta con sé tutto quello che c'era in Réglages: tipo Fermé/Ouvert, intervallo di date col datepicker brand, giornata continua o spezzata, **servizi attivi** a switch, nota, e soprattutto il **controllo d'impatto** (se ci sono prenotazioni nei giorni che sto per chiudere → modale con la lista e tre scelte: annullare + email, lasciare, o annullare l'azione).
- **Réglages → Horaire** ora monta il componente: via ~250 righe di script e ~40 di CSS dalla pagina. Restano due ganci, perché la pagina ha informazioni che il componente non può avere:
  - `spf:servizi` → la pagina risponde con i servizi **LIVE dell'editor** (anche non ancora salvati); fuori da Réglages il componente li legge da `/api/admin/settings`.
  - `spf:loaded` → la pagina aggiorna `spCache`, che serve al datepicker del widget per bloccare i giorni di chiusura. Siccome i due script sono moduli separati e l'ordine non è garantito, il componente lascia anche `window.__spfDays`: chi arriva dopo lo legge invece di perdere l'evento.
- **Home**: il modale del «+» ora ha due tab (pillole `.m-tab`, stesse del menu) — «Événement local» (il form di prima) e «Fermeture / ouverture» (il componente). Titolo del modale diventato «Jours spéciaux».
- Un solo datepicker aperto per volta: `dpApri` chiude gli altri `.dp-panel` della pagina (in home ce ne sono due, in Réglages pure).
- **Verifica**: esbuild OK su tutti gli script e i blocchi CSS toccati (il CSS orfano dopo l'estrazione si vede solo così).

## 📌 06/09/2026 — sessione Cowork (liaisons piano sala + lettura i18n dei piatti)

### 🔗 Liaisons: limite alzato e SILENZIO eliminato
- **Segnalato da EN**: una combinazione da 22 posti (11 tavoli da 2) non si salvava. Causa: in `api/admin/tables.ts` il vincolo era sul NUMERO DI TAVOLI (`ids.length <= 8`) e le combinazioni fuori limite venivano **scartate senza avviso** — l'API rispondeva `ok: true` con la lista già ripulita. Con tavoli da 2 il tetto reale era 16 posti, con tavoli da 4 diventava 32: il limite percepito cambiava da ristorante a ristorante.
- **Fix**: `MAX_TAVOLI_LIAISON = 16` (era 8) e `MAX_LIAISONS = 40`, entrambi in costanti nominate. Una combinazione fuori limite ora è **400 con messaggio esplicito** («Une liaison dépasse le maximum de 16 tables», «Maximum 40 liaisons par section», «Une liaison doit contenir au moins 2 tables») invece di sparire. Niente più salvataggi parziali.
- **Admin** (`settings.astro`, piano sala): mostra il messaggio del server al posto dell'errore generico, e soprattutto **ripristina lo stato precedente** se il salvataggio è rifiutato — prima la combinazione restava disegnata a schermo come se fosse stata salvata (stesso inganno, solo spostato più in là). Nuovo `slLinksOk` = ultimo stato accettato dal server.
- **Effetto a valle**: `maxInsiemePerZona()` (planSalle) calcola `max_ins` dalle catene; con le combinazioni lunghe che ora si salvano, il widget arriva davvero al numero di coperti dichiarato invece di fermarsi prima.
- Entrambi i file (`src/pages/api/**`, `src/pages/admin/**`) prendono la versione del motore al merge: i clienti lo ereditano senza toccare nulla.

### 🛡️ Due file per-cliente che il `.gitattributes` non proteggeva
- **Segnalato da EN**: `src/config/siteImageSlots.ts` si dichiara «FILE PER-CLIENTE» nella propria intestazione, ma `git check-attr merge` rispondeva **`unspecified`**: al primo `git merge engine/main` la mappa delle immagini del cliente sarebbe tornata quella del template.
- Cercando file con la stessa firma ne è saltato fuori un **secondo**: `src/config/sitePages.ts` («pagine del sito pubblico di QUESTO cliente»), anch'esso scoperto.
- Aggiunte due righe `merge=ours` in `.gitattributes` + riga nella tabella di `ENGINE.md`. Il `.gitattributes` non è protetto, quindi la correzione arriva a tutti col merge.
- **Verificato che NON vanno protetti**: `src/config/printCatalog.ts` (catalogo prodotti MOODD, seed uguale per tutti, valori reali in `app_config`) e `src/middleware.ts` (motore; «per-cliente» era solo un commento sugli script inline del sito pubblico).
- ⚠️ Da controllare sui clienti già mergiati: se avevano personalizzato quei due file **prima** di questa correzione, un merge passato può averli già sovrascritti.

### 🈯 `OrderApp`: via i ternari a due rami sulla lingua
- **Segnalato da EN** (sito trilingue): su `/it/order` il tag diceva «Épuisé» mentre la carta `/it/menu` accanto diceva «Esaurito». Causa: etichette scritte a mano come `lang === "en" ? "Sold out" : "Épuisé"` — il ramo `else` è il francese, quindi **qualunque lingua diversa da `en` finiva in francese**. Sette occorrenze: esaurito (x2), vegano, piccante, stagionale, «Suggestion», conferma rimozione, più la **descrizione del piatto**.
- Nuovo modulo **`src/lib/i18nMenu.ts`**, senza dipendenze come `pricing.ts`: `ETICHETTE_MENU` (5 lingue x 6 chiavi), `etichettaMenu(chiave, lang, dizionario)` con ordine **dizionario del cliente → lingua richiesta → ripiego esplicito su `fr`**, più `i18nPulito` e `testoPiatto` spostati qui.
- ⚠️ **Perché non in `db.ts`**: `OrderApp` è un'isola React, e `db.ts` crea il client Supabase con la **service key** — importarlo lato client la porterebbe nel bundle del browser. `db.ts` ora ri-esporta `testoPiatto` per il server, ma le isole devono importare da `i18nMenu`.
- `OrderApp`: `lang` passa da `"fr" | "en"` a `string` (il motore ha 5 lingue pubbliche); le nuove chiavi di `OrderStrings` (`soldOut`, `vegan`, `spicy`, `seasonal`, `suggestion`, `confirm`) sono **opzionali**, così le `order.astro` dei clienti — file per-cliente, che il merge NON aggiorna — continuano a compilare. Se il cliente non le passa, valgono quelle del motore nella lingua giusta; se le passa, vincono le sue.
- Nome e descrizione del piatto ora da `testoPiatto(item, lang)`, anche nella riga di carrello e nel titolo del modale. Restano **solo per mostrare**: il server ricostruisce le righe d'ordine leggendo `name` dal DB.
- **Verifica**: esbuild OK, `i18nMenu.ts` senza alcun riferimento a supabase, **19 test unitari** sul modulo reale transpilato (le 5 lingue, lingua ignota, sovrascrittura del cliente, traduzione vuota che non copre lo storico).

### 🌍 Piatti multilingue: il sito ora può leggere `name_i18n`/`desc_i18n`
- **Il buco**: le colonne esistono dalla migrazione #56 e l'admin le scrive da mesi, ma `MENU_SELECT` in `db.ts` si fermava a `description_fr`/`description_en`. Un cliente con una terza lingua attiva non poteva mostrare i piatti in quella lingua.
- `name_i18n` e `desc_i18n` aggiunte a **`MENU_COLONNE_NUOVE`** (non alla select fissa): chi non ha lanciato la #56 ripiega senza quelle colonne e non si rompe.
- Nuovo helper esportato **`testoPiatto(item, lang, langDefault)`** con la stessa cascata di `etichettaVariante`: lingua richiesta → lingua predefinita → colonne storiche → valore di base. **Un testo vuoto conta come MANCANTE** (`||`, non `??`): chi ha `desc_i18n` compilato a metà continua a vedere la descrizione storica invece di un buco.
- `i18nPulito()` scarta testi vuoti o di soli spazi, applicato sia alla mappatura sia dentro `testoPiatto` (la funzione è esportata e potrebbe ricevere una riga grezza).
- ⚠️ **Solo per MOSTRARE**: `name` resta il nome canonico per cucina, stampa ed email. Le righe d'ordine il server le ricostruisce leggendo `name` dal DB, mai dal browser.
- **Nessun cliente cambia comportamento**: l'helper è solo esportato, e le pagine che decidono cosa mostrare (`menu.astro`, `order.astro`, componenti) sono per-cliente. Chi vuole le lingue lo chiama nella sua pagina dopo il merge.
- Le **sezioni** erano già a posto: `menu_categories.name_i18n` è letto da `mappaCategorie()` ed esposto come `name_i18n`/`root_i18n` sulla categoria.
- **Verifica**: esbuild OK, **11 test unitari** sulle due funzioni estratte dal file reale e transpilate (cliente storico, traduzione a metà, terza lingua mancante, dati sporchi).

## 📌 05/09/2026 — sessione Cowork (Educazione Napoletana v2 + FORMATI/varianti nel motore)

### 🍕 NUOVA FEATURE MOTORE — Formati (varianti) di un piatto · migrazione #71
- **Perché**: EN vende le pizze in più formati (30/40 cm) con prezzo proprio; il vecchio progetto EN aveva `variants` su `menu_items`, il motore no. Serve a tutti (formati pizza, calice/bottiglia, porzione piccola/grande), quindi costruita **nel motore** e non appiattita in piatti separati.
- **Migrazione #71** `supabase/menu_variants.sql`: `variants jsonb not null default '[]'` + check `jsonb_typeof = 'array'`. Forma: `[{ key, label_i18n:{fr,en,…}, price_cents, orderable }]`. **Vuoto = comportamento invariato** (prezzo unico): nessun cliente esistente cambia.
- **Punto di verità unico** in `src/lib/pricing.ts`: `leggiVariantiDb` (parsing tollerante: righe senza chiave/prezzo scartate, chiavi duplicate = vince la prima, dati sporchi non fanno cadere il menu), `haVarianti`, `trovaVariante(raw, key, soloOrdinabili)`, `etichettaVariante(v, lang, def)`. Usato da sito pubblico, checkout e ordini admin: **una sola logica**.
- **Prezzo mai dal browser**: dal client viaggia solo la *chiave* del formato; `api/checkout.ts` e `api/admin/orders.ts` (creazione + modifica ordine staff) risolvono il prezzo dal DB e applicano lo sconto del piatto AL PREZZO DEL FORMATO. Formato inesistente o non ordinabile → **409**. La riga d'ordine porta `variant` e il nome diventa «Piatto — Formato», quindi **email, ticket di stampa e viste cucina mostrano il formato senza altre modifiche**.
- **Menu pubblico** (`menu.astro` + `en/menu.astro`): con i formati il prezzo unico lascia il posto a una riga per formato (etichetta a sinistra, prezzo a destra, prezzo pieno barrato se scontato). `price_cents` dell'item diventa il **minimo** («à partir de»).
- **`OrderApp.tsx`**: un bottone per formato al posto del «+»; **la riga di carrello è identificata da `id + variante`** (`chiaveLinea`), quindi 30 cm e 40 cm sono due righe indipendenti per quantità e rimozione. I carrelli salvati senza `variant` restano validi.
- **Admin** (`admin/menu.astro` + `api/admin/menu.ts`): blocco «Formats» nel modale piatto — etichetta per ogni lingua pubblica, prezzo, toggle *commandable*, aggiungi/elimina. Chiave generata dall'etichetta alla creazione e poi **stabile** (è ciò che sta negli ordini). Validazione server: max 12 formati, chiave slug unica, prezzo intero ≥ 0, almeno un'etichetta. i18n admin in **5 lingue** (10 chiavi `menu.variant*`).
- **Ripiego se #71 non è ancora lanciata**: `db.ts`, `checkout.ts`, `admin/orders.ts` riprovano la select senza `variants`; `api/admin/menu.ts` ha ora un ripiego **generico** (`conRipiego`) che toglie UNA alla volta le colonne che il DB non conosce (`sold_out`, `name_i18n`, `desc_i18n`, `variants`) invece di scartarle tutte insieme come faceva `mancaI18n`. Un cliente che merge senza migrare non si rompe.
- ⚠️ **Attenzione al merge**: la metà pubblica della feature vive in file **per-cliente** (`src/pages/**`, `src/components/**` sono `merge=ours`). Il merge del motore porta `pricing.ts`, `db.ts`, le API e l'admin; `menu.astro`, `order.astro` e `OrderApp.tsx` vanno riportati a mano sui clienti che vogliono i formati.
- **«Esaurito» — bug trovato e sistemato**: `menu_items.sold_out` (#55) si salvava e si modificava nell'admin ma il **sito pubblico lo ignorava del tutto** (non era nemmeno in `MENU_SELECT`): il ristoratore lo attivava e non succedeva niente. Ora `sold_out` arriva sul sito (`is_sold_out` su `MenuItem`) → badge «Épuisé» nel menu vetrina, bottone «+» disattivato nella pagina ordini, e **rifiuto 409** in `checkout.ts` e negli ordini staff (come già faceva `available`). Aggiunto lo stesso flag ANCHE sulla singola variante (`sold_out` dentro il jsonb, **nessuna migrazione**): stasera è finito l'impasto del 40 cm ma il 30 cm c'è. Il formato esaurito resta visibile col badge, il bottone è disabilitato, `trovaVariante(..., soloOrdinabili)` lo rifiuta, e il prezzo «à partir de» si calcola sui formati ancora disponibili (se sono tutti esauriti si ripiega su tutti, così un prezzo si vede comunque). Nel modale admin la variante ha ora due interruttori, *Ordinabile* ed *Esaurito*, entrambi `.m-toggle` standard. Il ripiego per le colonne mancanti è diventato un helper condiviso `conRipiegoColonne` in `db.ts` (`sold_out` + `variants`), usato da sito, checkout e ordini staff. **+11 test unitari** (totale 46).
- **Interruttore per cliente (nuovo meccanismo: FUNZIONI OPZIONALI)**: non tutti i ristoranti usano le varianti (ChouChou, L'Huile no), e chi non le usa non deve nemmeno vederle. Nuova chiave `app_config.admin_features` (array JSON) + `FUNZIONI_OPZIONALI`/`FUNZIONI_VALIDE` in `superAdmin.ts`, `features` dentro `caricaBootAdmin` (**stessa query**, nessuna lettura in più) e in GET/PUT di `/api/admin/pages`. Interruttore nel **super admin → Réglages → Fonctions optionnelles**, sopra la visibilità delle pagine, con lo stesso `.row`/`.switch`; salvataggio immediato e rollback dello switch se la PUT fallisce. **Spente di default**: un cliente esistente che fa il merge non vede comparire nulla. Con la funzione spenta il tab «Varianti» non viene proprio renderizzato (`boot.features.includes("variants")` in SSR), il JS è tutto protetto (`fVars` può essere null) e il payload di salvataggio **non contiene** la chiave `variants`, così i dati eventualmente già presenti non vengono azzerati. i18n `sup.features.*` in 5 lingue. Il meccanismo è generico: le prossime funzioni opzionali si aggiungono a `FUNZIONI_OPZIONALI` e basta.
- **Riflessione archiviata (varianti generiche per categoria)**: valutata l'idea di definire la variante una volta e applicarla a una categoria. Scartata per ora: con prezzi assoluti funziona solo se tutti i piatti costano uguale, con differenze (+4€) serve comunque l'eccezione sul singolo piatto, e soprattutto il prezzo incassato dipenderebbe da un record condiviso (ritoccare un supplemento cambierebbe in silenzio 30 prezzi). Direzione preferita quando servirà: un bottone «applica queste varianti a tutta la sezione» che SCRIVE le varianti su ogni piatto calcolandone il prezzo dal suo base — esplicito, senza indirezione a runtime. Il modello pieno sarebbero i «gruppi di opzioni» (che assorbirebbero anche i supplementi cablati oggi nel checkout), da fare solo se un cliente lo chiede.
- **Verifica**: esbuild OK su tutti i file toccati (+ script estratti dalle `.astro`); **35 test unitari** eseguiti sul codice REALE (`pricing.ts` transpilato, non una replica): parsing tollerante, scelta formato, non-ordinabili rifiutati dal checkout ma visibili in vetrina, sconto applicato al formato, «à partir de», identità delle righe di carrello. `astro check` da lanciare sul Mac.

### 🏗️ Educazione Napoletana v2 — ricostruzione sul motore
- EN era un fork **pre-motore** (niente `client.ts`/middleware/`lib/admin`, DB fatto a mano): **ricostruzione**, non merge. Repo NUOVO `MOODDVS/educazione-napoletana` (clone del motore + `origin` cambiato + `engine` aggiunto) — distinto dal vecchio repo live, così un push non può mai deployare sopra il sito attuale. Vecchio progetto rinominato `EducazioneNapoletana-old`.
- **Supabase nuovo** (Frankfurt, auto-expose OFF): tutte le **70 migrazioni in un unico file** generato dal motore nell'ordine di `MIGRATIONS.md` → 30 tabelle, 4 bucket pubblici, `pg_cron` + `pg_net` attive.
- **Brand**: `client.ts` (nome, claim, contatti reali, privacy fr/en, social), `site` = `educazionenapoletana.be`, `robots.txt`, asset dal vecchio progetto (favicon, icone, font Burford, foto).
- **Sito pubblico**: scoperto che le componenti del motore **discendono dal codice EN** (stessa struttura, evolute). Quindi il design vecchio è stato portato DENTRO il motore, non copiato sopra: palette (`#12a0d7` blu, `#001024` navy, `#f173ac` rosa), font Burford + Edu AU, SEO fr/en, hreflang, JSON-LD Restaurant, **GA4 `G-54DNTG35C7` con Consent Mode v2**, cookie banner sulla chiave storica `p77-cookie-consent` (chi aveva già scelto non rivede il banner dopo lo switch). Componenti EN riportate: Hero, Strip, Story, LaPizzeria, PhotoStrip, Strip2, Sinfonia, InstagramStrip, MobileNav, Footer + pagine events/contact/privacy/cookies. Hook prenotazione `data-open-booking` → `data-reserver` (modale del motore). i18n unito: 208 chiavi (121 motore + 87 solo EN, 2 sovrascritte).
- **Piano**: dominio invariato con **switch finale** (sviluppo su dominio temporaneo Hostinger). Al momento dello switch vanno rifatti: `PUBLIC_SITE_URL` + **rebuild** (è cotta nel bundle), i 5 job pg_cron (contengono il dominio), il webhook Stripe.
- **Script di migrazione menu** `scripts/migra-menu.mjs` (nel repo EN): legge i due `.env`, analisi a secco o `--import`, porta `description_fr/en` in `desc_i18n`, crea le sezioni. Rifiuta di scrivere se il nuovo `menu_items` non è vuoto.

## 📌 04/09/2026 — sessione Cowork (merge clienti + Prenotazioni Fase 3: alert conflitto in estensione)

### 🔁 Merge del motore su TUTTI i clienti (feature PRINT + estensioni + fix prenotazioni)
- Motore pushato; merge fatto su **ChouChou, La Molisana, L'Huile** (tutti puliti, 0 conflitti; `Layout.astro`/`feedback.astro` protetti da `merge=ours`, salvo L'Huile/La Molisana dove `feedback.astro` non era personalizzato → eredita il motore, nessuna perdita). `npm run build` OK su tutti. Migrazioni **#68 print_orders** + **#69 reservations_extra_minutes** (+ **#46 gift_card_orders** dove mancava) lanciate come unico blocco SQL idempotente sul Supabase di ciascun cliente. EducazioneNapoletana fuori dal motore (EN v2 da ricostruire).

### 📅 PRENOTAZIONI — Fase 3: alert conflitto quando si estende (avvisa, NON blocca, con Annulla)
- **Tutto lato client** (`src/pages/admin/reservations.astro`) + i18n (`src/i18n/admin.ts`). Nessuna modifica server, nessuna migrazione: il modale ha già in memoria le prenotazioni del giorno (`tables/heure/service_key/extra_minutes`), l'helper `holdR` e la capienza (`nmCfg.capacity`/`nmCfg.zone_seats`).
- Al click su +15/+30/+45, helper `conflittoEstensione(r, addMin)` guarda la finestra AGGIUNTA `[ini+holdR(r) → +addMin]`:
  - **Con tavoli assegnati**: un'altra confirmed/seated che condivide un tavolo e inizia nei minuti aggiunti → collisione (nome + ora).
  - **Senza tavoli (capienza)**: sala = `r.zone` (o capienza totale se «Indifférent»); se in un momento della finestra aggiunta `coperti altri (occ>0) + r.people > cap` → alert (tot/cap).
- **Non blocca**: se c'è conflitto i 3 bottoni lasciano il posto a una conferma INLINE (`#dt-ext-confirm`): avviso rosso (#d24d55) + **Annuler** / **Prolonger quand même**. Annuler ripristina; Prolonger applica via `applicaEstensione`. Reset a ogni apertura del modale.
- i18n nuove (5 lingue): `res.extConflictTable` / `res.extConflictTableSuf` / `res.extConflictCap` / `res.extConfirmGo`. Handler spostato su `#dt-ext-btns`. Dettagli in `prenotazioni_lifecycle.md`.
- **Verifica**: esbuild sul container OK (sintassi/type-strip) per `admin.ts` e per gli `<script>` estratti dalla `.astro`. Il type-check vero (`astro check`) va lanciato da Enzo sul Mac. **Nessuna migrazione**, nessun cron.

### 🔔 Nuova notifica push: messaggio dal form di contatto
- Richiesta Enzo: notificare il ristoratore quando qualcuno scrive dal **form di contatto** del sito. Aggiunto `inviaPushContatto` in `src/lib/push.ts` (title "Nouveau message"; body = `nome · oggetto` con fallback su anteprima messaggio, taglio 80 char; url `/admin`, tag `contact`). Agganciato in `src/pages/api/contact.ts` **dopo l'invio riuscito dell'email al ristoratore** (`void inviaPushContatto({ nome, oggetto, messaggio })`, best-effort, non blocca). **Nessuna migrazione** (riusa `push_subscriptions`). esbuild OK + 5 test unitari sul body (oggetto/solo messaggio/solo nome/nome vuoto/taglio 80). Le notifiche push totali diventano **6**: nuovo ordine, nuova prenotazione, modifica prenotazione (cliente), annullo prenotazione (cliente), nuova recensione Google, **nuovo messaggio contatto**.

### 🌍 Notifiche push tradotte nella lingua dell'admin (5 lingue)
- Prima **tutte le push erano in francese fisso**. Ora vanno al ristoratore nella **lingua dell'admin** (`app_config admin_lang`, fallback FR). In `src/lib/push.ts`: dizionario `TRAD_PUSH` (fr/en/it/nl/es) + helper `tradPush()` che legge `adminLang()` (già in cache, mai lancia). Resi **async** e localizzati: `inviaPushResa` (new/demande/modif/annul, incl. unità "pers." e fallback "Client"), `inviaPushOrdine`, `inviaPushRecensione` (singola/multipla), `inviaPushContatto`. Anche la **notifica di test** (`/api/admin/push`) usa la lingua admin (`TEST_BODY`).
- I punti che invocano le push le chiamano già con `void`/await → **nessun cambiamento ai chiamanti**. **Nessuna migrazione.** Verifica: esbuild OK + **13 test unitari** (titolo/corpo per ogni tipo × lingua, fallback nome mancante, fallback lingua sconosciuta→FR). Le date restano `gg/mm`, importi e stelle invariati.

### 🎁 Buoni regalo multilingua (email offrant/destinataire + PDF) + email al ristoratore
- **Richiesta Enzo**: PDF e email dei buoni in tutte le lingue possibili del cliente; lingua di **mittente** e **destinatario** definite alla creazione; nuova **email al ristoratore** alla creazione.
- **Lingue** = le 5 pubbliche (fr/en/it/nl/es), tutte latine → **il PDF (pdf-lib Helvetica) le gestisce tutte**, nessun problema di font.
- **Migrazione #70** `gift_cards_langs.sql`: colonne `sender_lang` + `recipient_lang` su gift_cards (NULL = default sito pubblico). Serve perché il **PDF è on-demand** e deve conoscere la lingua a posteriori. Colonne aggiunte anche in coda a `gift_cards.sql` (fresh install). API tollerante: se la #70 non è ancora lanciata, insert/update ritentano SENZA le colonne lingua (nessun 500).
- **notifications.ts**: `emailBonCadeau` (offrant/destinataire) tradotta nelle 5 lingue (dizionario `TXT_BON`), lingua = `sender_lang`/`recipient_lang` del buono, fallback = `publicLangDefault`. Nuova **`emailBonRistoratore`** (dizionario `TXT_BON_ADMIN`, lingua **admin**): "Nouveau bon cadeau" con recap (codice, valore, beneficiario/offerente + email, metodo pagamento, stato, scadenza, spedizione, messaggio); destinatario = `reservation_notify_email` → contact_emails → public_email → CLIENT.email.
- **bon-pdf.ts**: etichette del PDF tradotte nelle 5 lingue (`PDF_TXT`), lingua da `recipient_lang` (fallback default pubblico). `pulisci()` invariato (accenti latini OK).
- **marketing.astro**: due selettori lingua (pills `#gc-slang` offrant / `#gc-rlang` destinataire) negli step 2/3 del modale, opzioni = lingue pubbliche attive, opzionali (ri-clic = deseleziona = default sito). Inclusi `sender_lang`/`recipient_lang` nel payload; prefill in modifica; tipo GiftCard esteso. i18n `mk.emailLangOpt`/`mk.emailLangHint`.
- **gift-cards.ts**: `lang5()` valida i codici; salvati in meta (POST creazione + PUT modifica); passati alle email; `emailBonRistoratore(bon)` chiamata SEMPRE alla creazione; `sender_lang` aggiunto alla select del `resend_link` (email offrant localizzata anche al rinvio).
- **Verifica**: esbuild OK su tutti i file (+ estrazione `<script>` di marketing.astro) + **17 test unitari** (validazione lingua, fallback default pubblico, indipendenza mittente/destinatario, toggle del selettore). **1 migrazione (#70)** da lanciare su ogni cliente; nessun cron.

### 🔐 CSP `script-src` sull'admin (Report-Only, nonce)
- Completata la CSP: aggiunta la direttiva **`script-src`** (la vera protezione anti-XSS), **solo su `/admin`** e per ora in **`Content-Security-Policy-Report-Only`** (non blocca nulla, segnala in console). Il pubblico (script inline per-cliente) resta invariato.
- **Nonce per-richiesta**: il middleware genera `crypto.randomUUID()` → `context.locals.cspNonce` (prima di `next()`), messo nell'header e sugli `<script>` inline eseguibili dell'admin (tutti del motore): `AdminHead` (anti-flash SERVER-rendered dinamico → per questo serve il nonce, non l'hash), `AdminNav`, `login`, `reset-password`. Tipo in nuovo `src/env.d.ts` (`App.Locals.cspNonce`).
- **Nessuno script esterno** nel progetto (solo `'self'` + inline) → `script-src 'self' 'nonce-…'` copre tutto: i `<script>` semplici li bundla Astro (serviti da `'self'`), i `type="application/json"` sono dati non eseguiti. Unico handler inline dell'admin (`assets.astro` `onerror`) **rifattorizzato** in `addEventListener` (niente `unsafe-hashes`).
- **Da fare da Enzo per attivarla davvero**: dopo il deploy, aprire l'admin (login, dashboard, réservations, assets, marketing) con la console DevTools aperta e controllare che NON compaiano violazioni «[Report Only] Refused to execute … script-src». Se pulito, **promuovere a enforcing** cambiando in `src/middleware.ts` il nome header da `Content-Security-Policy-Report-Only` a `Content-Security-Policy` (restano due header CSP, entrambi enforced: OK). **Nessuna migrazione.**
- Verifica: esbuild OK (middleware + script assets estratto). `npx astro check` sul Mac per il type-check (nonce tipizzato via env.d.ts).
- **Fix (report-only pulito)**: l'anti-flash di `AdminHead` era l'UNICO a violare perché reso con `set:html` su `<script/>` self-closing → Astro NON applicava il nonce. Riscritto come `AdminNav`: dati in un blocco `type="application/json"` (`#mdd-flash`, non eseguito → fuori CSP) + script **statico** con JS scritto letteralmente nel tag e `nonce={Astro.locals.cspNonce}`. **Lezione**: col nonce, gli inline vanno scritti come figli del `<script nonce>` (come AdminNav), MAI via `set:html` (il nonce non passa).
- **✅ PROMOSSA A ENFORCING (04/09)**: verificato in dev (report-only pulito) → `script-src 'self' 'nonce-…'` ora in `Content-Security-Policy` (enforced) SOLO su `/admin`; il pubblico resta senza script-src. `AdminHead` refactorato (JSON `#mdd-flash` + script statico nonce'd). **Dev toolbar disattivata** in `astro.config.mjs` (`devToolbar:{enabled:false}`) perché in dev iniettava uno `<script>` inline suo (hash `/2Aym2…`, uguale su ogni pagina, login incluso) che sporcava la console — è roba SOLO dev, in build non esiste. **Lezione**: la CSP va verificata in dev con la dev toolbar OFF (o su build), altrimenti gli inline iniettati da Astro/Vite danno violazioni fantasma. Verificare su un cliente in produzione dopo il primo merge prima di propagare a tutti.

### 🔎 Revisione di sicurezza del codice di oggi + rinforzi (94 test)
- **Revisionato** tutto il codice della sessione (Fase 3 prenotazioni, push contatti + i18n, buoni multilingua, CSP). Nessuna falla grave; applicati rinforzi difensivi:
  - **`esc()` ora escapa anche `"` e `'`** (era solo `& < >`) nei 4 helper del motore (`notifications.ts`, `contact.ts`, `newsletterSend.ts`, `dailyBrief.ts`): prima una `"` in un valore dentro un attributo HTML (es. `href="mailto:${esc(email)}"`) rompeva l'attributo. Verificato che `esc` non è mai usata su subject/plain-text.
  - **`Cache-Control: no-store` su `/admin` e `/api/admin`** (prima solo sulla 429): contenuto autenticato mai in cache + niente riuso del nonce CSP da HTML cachato.
  - **JSON dentro `<script type=json>` uniformato** con `.replace(/</g,"\\u003c")` (anti `</script>` breakout) anche nei blocchi di configurazione (`AdminHead #mdd-flash`, `print.astro` ×2, `marketing pubLangsJson/sitePagesJson`); quelli con dati cliente (`ssr-*`) lo avevano già.
  - **`esc()` sugli href Stripe/PDF** nell'email buono (attribute-safe).
  - **Limiti di lunghezza sul form contatti** (endpoint pubblico): nome ≤120, email ≤200, oggetto ≤200, messaggio ≤5000 → 400 «Message trop long».
  - **Push contatti**: nome tagliato a 60 (estratto già a 80) → payload push bounded.
  - **Validatori lingua stretti** (`lang5`/`norm5`/`norm5Pdf`): solo `typeof === "string"`, niente coercizione di array/oggetti (era innocua ma sciatta).
- **Test**: suite sicurezza 44/44 (escape testo/attributi, breakout JSON, nonce 32-hex univoco su 2000, header CSP/no-store per rotta admin/pubblico/api, whitelist lingue vs injection, `pulisci()` WinAnsi, bound `extra_add` 0<add≤600, limiti contatti, payload push) + suite logica 20+13+17. esbuild OK su tutti i file toccati; `npx astro check` sul Mac.
- Confermato per lettura: tutti gli endpoint admin toccati passano da `verificaStaff`; `bon-pdf` pubblico ma gated da `pay_token` UUID + 402 se non pagato; `contact` rate-limited dal middleware.

### 🚪 Guard /admin lato server (niente più «lampo» della nav prima del login)
- **Causa**: le pagine /admin venivano renderizzate intere (nav compresa) per chiunque; solo il JS del browser rimandava al login. **Fix**: middleware `authGuardAdmin` (GET/HEAD su `/admin` e `/admin/*`, escluse `/admin/login` e `/admin/reset-password`): cookie `mdd_at` assente o firma non valida → **302 al login prima del render**. Verifica firma locale (JWKS in cache) con **scadenza ignorata** (`sessioneRiconosciuta` in adminAuth.ts): un token scaduto ma autentico = «questo browser si è già loggato» → render, il client rinfresca; i DATI restano sempre gated da Bearer vivo. **Fail-open** se il JWKS è irraggiungibile e controllo della SOLA firma (non staffAutorizzato) → nessun loop login↔admin possibile.
- Cookie `mdd_at` portato da 1h a **30 giorni** (`supabaseBrowser.ts`, `scriviCookieToken` ora esportata); cancellato al logout come prima. `login.astro` scrive il cookie **esplicitamente prima** di ogni redirect a /admin (auto-redirect e post-submit) → niente race al primo GET. Hostinger (Olanda) ↔ Supabase (Francoforte) ≈ 10–20 ms/query.

### ⚡ Velocità: cache `app_config` (30s) + `/api/admin/pages` dalla cache boot
- **Diagnosi**: 105 letture dirette di `app_config` nel motore; quasi ogni richiesta rifaceva 1–6 round-trip per le stesse poche righe di config. I loader SSR erano già in `Promise.all`; 6 pagine principali già SSR; boot in cache 60s.
- **Nuovo `src/lib/appConfigCache.ts`**: intera tabella in cache 30s (`cfg:all`), con **drop-in** `appConfigIn(chiavi)` / `appConfigEq(chiave)` che restituiscono la stessa forma `{data,error}` delle query Supabase (i chiamanti non cambiano) e **fallback alla query diretta** se la cache fallisce. Innestata nei 4 percorsi caldi: `api/reservation.ts` (widget pubblico, 3 letture), `planSalle.ts` (3), `api/admin/reservations.ts` (3), `caricaResaGiorno.ts` (1) → **0 letture dirette residue**. **Invalidazione** (`invalidaAppConfig()`) negli scrittori delle chiavi prenotazioni: `settings.ts` (fine PUT), `tables.ts` (2 upsert), `zone-closures.ts`. Le altre chiavi restano su query dirette (nessuna staleness).
- **`/api/admin/pages`** (chiamata a OGNI navigazione dalla nav): da **6 query** a **1 lettura cachata**: `caricaBootAdmin()` esteso con `hiddenPages`/`hiddenTabs` (2 chiavi in più nella stessa query); rimossi 5 helper di lettura morti; `PUT` invalida il boot anche su hidden/hiddenTabs.
- **Test**: 32/32 (forma drop-in, filtro chiavi, TTL, invalidazione, fallback su errore DB, errore non cachato; guard su rotte/metodi/cookie incl. slash finale, `/administrator`, `/api/admin`, POST; sessioneRiconosciuta firma/scadenza/fail-open; parsing liste boot; cookie). esbuild OK su 14 file. `npx astro check` sul Mac. **Nessuna migrazione.**
- **Prossimi passi possibili (non fatti)**: SSR anche per marketing/settings/agenda (oggi HTML poi fetch API); `temaEmail()` in cache (2 query per email inviata); polling nav ogni 20s (ok).

### 🔁 Propagazione ai 3 clienti + lezione sul deploy Hostinger (05/09)
- Merge del motore `1f9c983` su **ChouChou** (conflitto su `middleware.ts`, risolto `--theirs`), **La Molisana** e **L'Huile** (entrambi puliti). Build OK, push, migrazione **#70** lanciata su tutti e 3. **Nessuna migrazione pendente.**
- **⚠️ Lezione**: il guard sembrava non funzionare (in incognito `/admin` rispondeva **200 con 18,8 kB** = pagina admin completa, poi il JS rimandava al login → l'isola compariva lo stesso). Causa: **il deploy Hostinger non era ancora concluso** — il middleware è codice SERVER, quindi finché il processo Node non serve il nuovo `entry.mjs` il guard non esiste. Dopo il deploy `Completed + Current`: `/admin` → **302, 0,5 kB**. Il service worker era stato sospettato ma è innocente (non fa cache: `respondWith(fetch(...))` pass-through; il fetch di rete da 18,8 kB lo dimostra).
- **Metodo di verifica** (da riusare): DevTools → Network → spuntare **Keep log** (altrimenti la richiesta a `/admin` sparisce al redirect) → incognito su `/admin` → la riga `admin/` deve essere **302**. Se è 200, il deploy non è ancora attivo.
- **Pulizia**: la cartella `Claude outputs/` (mockup email/PDF buoni mostrati in chat) era finita nel repo e si stava propagando ai clienti → rimossa dal tracking (`git rm --cached`, file lasciati su disco) + regola in `.gitignore`. Sparirà dai clienti al prossimo merge.
- **Residuo noto (non un bug)**: l'isola può ancora comparire un istante nel caso «cookie presente ma sessione del browser scaduta» (il server renderizza legittimamente, poi il client rimanda al login). Non capita in incognito. Si eliminerebbe nascondendo nav+contenuto finché il client non conferma la sessione — proposto a Enzo, non ancora fatto.

## 📌 03/09/2026 — sessione Cowork (Feature PRINT on-demand + ciclo di vita prenotazioni)

### 🖨️ PRINT — prodotti stampabili ordinabili a MOODD (nuova feature, 3 step)
- **Architettura**: catalogo/prezzi/meta in `app_config` chiave `print_catalog` (JSON, ZERO migration; seed nel codice `src/config/printCatalog.ts` = `PRINT_DEFAULTS`, un cliente eredita il seed o ha il suo listino). Prezzi in centesimi, per LOTTO, senza IVA (MOODD fattura da Dubai). Ogni prodotto ha `meta` a campi fissi tradotti (format/pages/paper/color) + fasce quantità.
- **Step 1 — super admin**: onglet «Print» in `/admin/super` (solo super admin): card prodotto con switch Visibile/Nascosto, fasce quantità/prezzo-lotto (add/remove), 4 campi Caractéristiques (precompilati dal seed se vuoti), «Réinitialiser» + «Enregistrer». API `src/pages/api/admin/print-catalog.ts` (GET staff / PUT super admin → upsert app_config).
- **Step 2 — pagina cliente `/admin/print`** (nuova pagina MOTORE, in `PAGINE_ADMIN`, voce nav `data-page="print"`, nascondibile dal super admin): griglia SSR dei prodotti VISIBILI, card stile Agenda (cover = anteprima iframe della route di stampa, scalata; caratteristiche; footer). Anteprima/Download = **stampa dell'iframe** (`iframe.contentWindow.print()`, «Salva come PDF»): niente Chromium/PDF server. Download = icona doc + «PDF».
- **Step 3 — ordine**: bottone «Ordina» → modale (armonizzato coi buoni: box scuro, opzioni chiare squadrate, header + footer Annulla/Paga; **seleziona pack → Paga → Stripe**). Pagamento sullo **Stripe di MOODD** (`MOODD_STRIPE_SECRET_KEY`, come crediti/buoni; nessun webhook, verifica al ritorno + guarigione GET). Tabella **`print_orders`** (migration **#68**) con snapshot prodotto/qty/prezzo/meta + `stripe_session_id` unique. Email best-effort a enquiries@moodd.online alla conferma. API `src/pages/api/admin/print-order.ts`.
- i18n `sup.tab.print`, `nav.print`, `nav.s.print`, `print.*` (5 lingue). Le pagine `/print/*` restano PER-CLIENTE (merge=ours) → sul MOTORE l'anteprima va 404 (atteso), si prova su un cliente con `/print/menu`. Dettagli in `print_catalog.md`.

### 📅 PRENOTAZIONI — bug fix + ciclo di vita tavolo
- **Bug modale** (visto su ChouChou): una confermata a orario passato mostrava «CONFIRMÉE» + timer 0:00 mentre la lista diceva «FINI ?». `apriDettagli` guardava solo `fase==="encours"`. Aggiunta `statoVisuale(r)` (stato derivato dall'orologio) usata da modale + **menu stati** (prima una walk-in «In corso» sulla card aveva «Confermata» selezionata nel menu).
- **Auto-Fini**: esisteva già (LAZY in `caricaResaGiorno.ts`, gira a ogni caricamento del giorno — NON è un cron). Portata da **+15 a +20 min**; registra `table_minutes = durée NOMINALE` (non hold+15). Modale in finestra passata: badge «Fini» + timer **fermo a X**.
- **Estensione tempo (+15/+30/+45 min)**: colonna `reservations.extra_minutes` (migration **#69**). Bottoni nel modale (`dt-extend`, sempre visibili quando c'è il timer, bg scuro del modale = `var(--c-bg)`) → PATCH `{extra_add}`; se `done` la **riapre** (status→confirmed/seated, table_minutes=null). `extra_minutes` incluso OVUNQUE via helper client `holdR(r)=holdDi+extra`: fase, timer/list bar, auto-Fini (trigger+durata), verifica conflitti admin, **disponibilità pubblica** (`api/reservation.ts` overlap) e **piano sala** (`planSalle.ts`) → tavolo esteso bloccato anche per il widget. No-show manuale vince sempre (già). Alert conflitti in estensione = **Fase 3 (TODO)**. Dettagli in `prenotazioni_lifecycle.md`.

### 🎁 Buoni regalo
- Bug «Enregistrement impossible» = **tabella `gift_card_orders` mancante** sul DB in uso (non codice/Stripe: Stripe creava la sessione, falliva l'insert). Aggiunto `console.error` col vero errore Postgres in `gift-cards-shop.ts` e `print-order.ts` (prima 500 muto). → lanciare `gift_card_orders.sql` dove manca.
- Modale buoni: design invariato ma **stessa logica del print** (footer Annulla/Paga, seleziona pack → Paga → Stripe).

### ⚠️ MIGRAZIONI DA LANCIARE SU OGNI CLIENTE (al prossimo merge)
- **#68 `print_orders.sql`** (ordini Print) — senza, l'ordine dà «Enregistrement impossible».
- **#69 `reservations_extra_minutes.sql`** (estensione tavolo) — senza, l'estensione dà «Enregistrement impossible».
Entrambe idempotenti. **Nessun cron nuovo.** Env: `MOODD_STRIPE_SECRET_KEY` (già presente per crediti/buoni) serve anche agli ordini Print.

### Verifica
- File toccati sintatticamente OK (esbuild sul container per i `.ts` + estrazione `<script>` delle `.astro`). Build/tsc completo solo dal Mac (VM = rollup arm64 KO).

## 📌 01/09/2026 — sessione Cowork (Statistiche: nuovo tab «Prenotazioni» + rifiniture mobile/CSS)

- **Nuovo tab «Prenotazioni»** nella pagina Statistiche (3° tab dopo Google/Finanze). Analitiche aggregate del ristorante sulle `reservations`. Filtri periodo **7g / 15g / 1 mese / 3 mesi / 6 mesi / 1 anno** (pillole `.rh-filter`). Backend: `src/lib/admin/statsResa.ts` (`calcolaStatsResa(giorni)`) + endpoint `GET /api/admin/stats-reservations?giorni=N` (auth staff). **Nessuna migrazione** (usa colonne esistenti: status confirmed/cancelled/noshow/seated/done, people, table_minutes, spent_cents, tables, created_at, source, service_key, birthday/special_event).
  - **KPI** in 3 sezioni: *Panoramica* (prenotazioni, coperti totali + media/pren, giorno più forte con media, fascia di punta + %), *Medie* (media tavoli/giorno, tempo medio al tavolo, spesa media + €/coperto, anticipo medio prenotazione), *Affidabilità* (cancellazioni + %, no-show + %, tasso di presenza, eventi speciali compleanni/eventi).
  - **Grafici** (SVG puro, a tutta larghezza): andamento prenotazioni con **cancellazioni e no-show sovrapposti** (multi-linea + legenda); barre per **giorno della settimana** (nomi localizzati via Intl); barre **fasce orarie di punta**; barre orizzontali **per fonte** (web/telefono/walk-in/google) e **coperti per servizio** (pranzo/cena).
  - i18n `st.r*` in 5 lingue. Switch tab generalizzato a 3 pannelli; redraw su resize. `tsc` + syntax-check OK; render reale verificato con mock (funzioni rMulti/rBars/rHbars/rTile).
- **Rifiniture Statistiche mobile/CSS** (stessa sessione): filtri periodo migrati alla classe condivisa `.rh-filter` con **scroll orizzontale** su mobile (Finanze+Google); su **iPad mini verticale/tablet** le card in **3 colonne** con numeri più piccoli (telefono 3 colonne compatte); titoli tile e padding ridotti su mobile (fix ordine CSS: override spostati in fondo per vincere sulle regole base); **grafici Clic/Impressioni Google a tutta larghezza** (padL/padR=0, valori Y sopra le griglie); 4 tile Google (grid4) con font/padding ridotti su mobile.


## 📌 31/08/2026 — sessione Cowork (Notifiche push: verifica + nuova notifica recensioni Google)

- **Verifica notifiche push PWA admin — tutte OK**: nuovo ordine (`stripe-webhook.ts` → `inviaPushOrdine`, dati numero/nome/totale corretti), nuova prenotazione + demande (`reservation.ts` → `inviaPushResa "new"/"demande"`), prenotazione **modificata** e **annullata** dal cliente (`inviaPushResa "modif"/"annul"`). `push.ts` robusto: VAPID lazy (nessun throw se assente), invio a tutte le subscription con **pulizia automatica** di quelle morte (404/410), best-effort. Service worker (`public/sw.js`) generico: mostra title/body/tag e al click naviga su `data.url`.
- **NUOVA notifica: recensione Google** (richiesta Enzo). Aggiunto `inviaPushRecensione` in `push.ts` (1 nuova → «Nouvel avis Google · ★★★★☆ · <autore>»; più di una → «N nouveaux avis»; link a `/admin/google`, tag `google-review`). Agganciata in `sincronizzaRecensioni` (cron orario `google-reviews`): rileva le recensioni **non ancora in DB** confrontando i `review_id` esistenti e notifica solo le nuove; **salta il primissimo sync** (DB vuoto) per non notificare tutto lo storico all'attivazione. `tsc` OK. NB: richiede che il cron `google-reviews-hourly` sia attivo sul cliente (già nella lista dei 5 job).

## 📌 31/08/2026 — sessione Cowork (Audit di sicurezza + hardening: rate limiting, header, cron)

- **Audit di sicurezza completo** del motore (report consegnato a Enzo). Esito: basi solide (firma webhook Stripe verificata + idempotenza, integrità prezzi checkout ricalcolati server-side, service key solo server, escaping anti-XSS nell'admin, JWT verificato in locale via JWKS, Places API in cache, upload con limiti/auth, login su Supabase con rate limiting integrato, nessun CORS wildcard, isolamento multi-tenant per-DB). Problemi trovati e stato:
- **🟠 RATE LIMITING (era ASSENTE) → FATTO**. Nuovo `src/lib/rateLimit.ts` (finestra fissa in memoria; l'app è singola istanza Node standalone → sufficiente) + `ipClient()` (X-Forwarded-For→X-Real-IP→clientAddress). Applicato nel **middleware** su `/api/*`: email (`contact`/`feedback`) 5/min, `reservation` 8/min, `checkout` 10/min, `coupon` 20/min, `order-cancel`/`newsletter-unsubscribe` 15/min, `track` 40/min, admin 1200/min (anti-runaway, generoso per NAT), fallback pubblico 60/min. Esclusi `stripe-webhook` (firma) e `cron/*` (segreto). Risposta `429` + `Retry-After`.
- **🟡 HEADER DI SICUREZZA (erano ASSENTI) → FATTO** nel middleware, su ogni risposta: `X-Content-Type-Options:nosniff`, `Referrer-Policy:strict-origin-when-cross-origin`, `X-Frame-Options` (DENY su `/admin`, SAMEORIGIN altrove), `Permissions-Policy`, `X-XSS-Protection:0`, `HSTS` (solo prod https, mai localhost), e **CSP** sottoinsieme sicuro APPLICATO (`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` sull'admin / `'self'` sul pubblico) — non limita script/img/connect quindi non rompe nulla. CSP completa su script-src = TODO separato (richiede test sull'inline anti-flash).
- **🟡 SEGRETO CRON: confronto a tempo-costante → FATTO**. Nuovo `src/lib/cronAuth.ts` (`segretoUguale` = SHA-256 + `timingSafeEqual`). I 5 cron ora usano quello invece di `!==`. (Query-param `?key=` mantenuto per non rompere i cron esistenti; header `x-cron-key` resta il preferito.)
- **🟢 Sanificazione ricerca prenotazioni (#5): GIÀ a posto** — `q.replace(/[%,()*]/g,"")` neutralizza già l'injection nel filtro PostgREST.
- **🔴 AUTH multi-tenant (#1) → FATTO (difesa in profondità)**. `verificaStaff` (e il render SSR `verificaTokenLocale`) ora richiedono uno STAFF PROVISIONATO: super MOODD (email fissa) **oppure** ruolo esplicito in `app_metadata` (lo assegna sempre il pannello Users) **oppure** email nella allowlist env `ADMIN_BOOTSTRAP_EMAILS` (valvola per account legacy). Un auto-registrato (senza ruolo) viene **rifiutato** anche se le registrazioni Supabase fossero aperte per errore. Il super (`admin@moodd.online`) non si blocca mai → può sempre sistemare i ruoli. ⚠️ Dopo il deploy: se un membro staff LEGACY (creato a mano, senza ruolo) non entra più, assegnargli un ruolo in Réglages → Users **o** aggiungere la sua email a `ADMIN_BOOTSTRAP_EMAILS`. Resta comunque buona norma tenere le registrazioni Supabase CHIUSE.
- **🟡 Upload SVG (#6)**: lasciato — serve alla feature brand (favicon/logo SVG). Documentato.
- Verifica: `tsc --noEmit` OK (build completo non eseguibile sulla VM per un mismatch del binario nativo rollup arm64 nei node_modules locali — problema d'ambiente, non del codice; su Hostinger x64 builda).

## 📌 31/08/2026 — sessione Cowork (Google Business Profile: scheda completa modificabile dall'admin — Informazioni, Orari, Attributi, Menu, Foto, Data/statistiche)

- **Nuova pagina operativa `admin/google.astro` — 5 tab principali** (`.mtabs`, scrollabili in orizzontale su mobile: `flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none`, `.mtab{flex-shrink:0}`): **Scheda · Recensioni · Post · Menu · Foto**. Il tab **Scheda** ha 4 sotto-filtri a pillole: **Informations · Horaires · Liens/Actions · Attributs**. Tolto il vecchio banner «fiche-head».
- **CLASSI CSS CONDIVISE (niente più CSS riscritto per ogni pagina)**: creato **`src/styles/filters.css`** (`.rh-filters`/`.rh-filter` = le pillole piccole `.tab` della pagina menu: `font-size 0.82rem`, `padding .4rem 1rem`, `border-radius 999px`, `.is-on` accent) e **`src/styles/savebar.css`** (`.save-bar`/`.save` estratti dalla pagina Réglages = fonte di verità; barra fissa in basso a destra che appare alla modifica, bottone che diventa **verde `#2e9e6b` «Scheda aggiornata»** al salvataggio poi si nasconde dopo 1.6s). Chiarito col disegno della pagina menu: **sopra la linea = TAB** (grandi), **sotto la linea = FILTRI** (pillole piccole). `settings.astro` ora importa `savebar.css` (rimosse le regole locali duplicate). Save-bar **responsive**: si solleva sopra la dock su iPad verticale/mobile (`calc(1.25rem + 72px)`), label breve «Salva» dove serve; `AdminNav.adattaFab` esteso per non farla coprire dall'isola nav.
- **INFORMATIONS — lettura E scrittura della scheda Google** (Business Information API **v1** `mybusinessbusinessinformation.googleapis.com/v1`, path `locations/{id}`): titolo, **telefono principale + secondario**, **stato apertura** (openInfo.status), **indirizzo** (storefrontAddress), descrizione. `leggiScheda`/`aggiornaScheda` in `googleBusiness.ts` + `PUT /api/admin/google/profile.ts` (maschere di campo corrette). Layout desktop a **larghezza piena** (non 3 colonne strette).
- **HORAIRES — 2 colonne 50/50** (orari normali | orari speciali) su desktop e iPad orizzontale (`≥1000px`). **Orari speciali multi-fascia** (2+ servizi per giorno, come i giorni normali). Bottone **«↻ Riprendi da RestoHub»** (scelta: solo bottone manuale, no sync automatico): rilegge `settings` + `special_days` di RestoHub e riempie **sia** gli orari normali **sia** gli speciali. `GET /api/admin/google/rh-hours.ts` (mapping giorno `dowDaEditor(d)=(d===6?0:d+1)`). **Google NON gestisce intervalli multi-giorno** negli SpecialHourPeriod (endDate max +1g) → le chiusure vacanza a intervallo vengono **espanse in date singole** ≥ oggi (cap 250). Bottone «+ Aggiungi una data» ridisegnato in stile brand RH (`.fi-add`).
- **ATTRIBUTS — editor completo** (v1): lista attributi disponibili via `attributes.list?categoryName=X&regionCode=Y&languageCode=Z` (⚠️ NON `parent`+languageCode insieme: Google rifiuta), valori correnti via `GET locations/{id}/attributes` (getAttributes, NON `?readMask=attributes`), scrittura `PATCH locations/{id}/attributes?attributeMask=…`. Gestiti **BOOL** (values:[bool]), **ENUM** (values:[id]), **REPEATED_ENUM** (repeatedEnumValue{setValues,unsetValues}), **URL** (uriValues). Split in due sotto-filtri: **Liens/Actions** (attributi URL: FB/IG/reservation/menu/order…) e **Attributs** (tutti gli altri). Verifica post-scrittura (`notApplied`) che rilegge e conferma cosa Google ha davvero applicato.
- **MENU — sync da RestoHub → Google** (Food Menus API **v4** `PATCH .../foodMenus?updateMask=menus`): `GET /api/admin/google/menu.ts` mostra l'anteprima del menu RestoHub (`menu_items` per categoria) + lo stato su Google; POST costruisce il payload (lingua predefinita, EUR, prezzi>0 dei piatti disponibili; money nanos = (cent%100)*10M) e lo spinge. Richiede `canHaveFoodMenus` sulla scheda.
- **FOTO — logo, sfondo, galleria** (Media API v4): logo + cover **nella stessa tile**; galleria a griglia. Il logo Google è memorizzato come categoria **PROFILE** (non LOGO) → `logo = find(LOGO) ?? find(PROFILE)`. Le immagini googleusercontent danno 403 senza **`referrerpolicy="no-referrer"`** sugli `<img>` (fix applicato). Upload galleria via **file** O via **Bibliothèque** (ImagePicker): il bottone «+» è **all'inizio** della gallery e apre un modale per scegliere «libreria o carica». Cancellazione a 2 tap. `media.ts` GET (`{logo,cover,gallery}`) / POST (`{url,category}`) / DELETE (X-Method-Override).
- **ImagePicker (modale condiviso) — rifiniture mobile**: filtri **scrollabili in orizzontale** (`flex-wrap:nowrap; overflow-x:auto`), **header sticky** (h2+bottone+tab fissi, solo la griglia scorre: `.imgpick-head` + `.imgpick-body` in flex-column con `overflow` proprio), **titolo più piccolo su mobile** (1.6→1.3rem, padding ridotto ≤640px come gli altri modali), **griglia immagini a 3 colonne** fisse.
- **AUTENTICAZIONE (modello multi-cliente, invariato)**: credenziali app **UNICHE di MOODD** via env **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`**; ogni ristoratore autorizza la SUA scheda (scope `business.manage`, `access_type=offline`) e il **refresh token finisce in `app_config`** del suo Supabase (`google_oauth_refresh`); la scheda scelta in `google_location`/`google_location_title`. Redirect = `{PUBLIC_SITE_URL}/api/google/callback` (da registrare su Google Cloud). **`state` anti-CSRF** firmato con la service key.
- **DATA — nuovo tab «Données» con le statistiche della scheda** (Business Profile Performance API v1 `businessprofileperformance.googleapis.com`, scope `business.manage` già in uso): filtro periodo **7 / 30 / 90 giorni** (pillole `.rh-filter` sotto la linea a sinistra, come nel tab Scheda). **Card KPI** del periodo (somma impressions Maps+Search × desktop+mobile = «Visualizzazioni», più Click sito, Chiamate, Indicazioni, Click menu; Prenotazioni/Ordini/Messaggi solo se >0). **Grafico andamento** (SVG puro, nessuna libreria) con selettore metrica: valori Y **fuori a sinistra** in HTML (colonna allineata coi numeri di rango; su mobile allineati col titolo), plot **allineato con l'inizio delle barre**, date X in HTML (così il grafico si allunga su mobile — altezza 200px — senza deformare il testo), scala «nice» con più livelli. **Parole chiave di ricerca** (mensili, `searchkeywords/impressions/monthly`): barre accent piene ordinate, valori `<15` per le soglie privacy di Google. `leggiPerformance`/`leggiKeywords` in `googleBusiness.ts` + `GET /api/admin/google/data?giorni=N`. i18n `gg.tabData`/`gg.data*` (5 lingue). ⚠️ **Va abilitata la «Business Profile Performance API» nel progetto Google Cloud MOODD** (come le altre My Business API), altrimenti il tab dà errore. NB: i dati Google hanno qualche giorno di latenza.
- **MIGRAZIONI — nessuna nuova necessaria**: tutta la feature Google usa tabelle **già esistenti** (`app_config` #2 per token+location, `settings`/`special_days`/`menu_items` letti per la sync, `google_reviews` #67 per le recensioni). Aggiunte a `MIGRATIONS.md` le due variabili d'ambiente OAuth **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** (prima mancavano: senza, il collegamento Google non parte per i nuovi clienti).
- **Verifica**: `npx tsc --noEmit` = 0 errori; syntax-check degli `<script>` inline (ts.transpileModule); mock renderizzati (desktop/iPad/mobile) per filtri, save-bar, colonne orari, tab scrollabili e modale ImagePicker. Doc Google confermate: SpecialHourPeriod senza range multi-giorno, endpoint read/write attributi, disponibilità Media/FoodMenus API 2026.

## 📌 29/08/2026 — sessione Cowork (Menu: piatti dal/fuori menu + nascondi per portata · Agenda: editor rich text · cron ChouChou)

- **Menu — modale Piatti (lunch e menù fissi): due tab «Dal menu / Fuori menu»**. La scelta cambia SOLO il controllo d'inserimento (selettore piatti del menu ↔ campi lingua + Aggiungi); i due tipi **convivono** e le pillole sotto mostrano SEMPRE tutti i piatti (menu + fuori menu), ognuna con la × per rimuoverla. «Fuori menu» = campi lingua dinamici (lingue pubbliche) + bottone Aggiungi → pillola (menù fissi: salva in `customs` multilingua; lunch: `free:{json}`). Il tab iniziale è dedotto dai dati esistenti.
- **Nascondi i piatti dal menu PER PORTATA** (prima era un flag globale). LUNCH: nuova colonna `hide_by_course` jsonb (**migrazione #51 `lunch_hide_by_course.sql`**, la lancia Enzo su ogni DB). MENÙ FISSI: flag `hide` dentro il JSON `courses` (NESSUNA migrazione). Lo switch «nascondi» appare solo se la portata ha almeno un piatto DEL MENU (i fuori menu non contano). `db.ts` (`piattiNascostiDaLunch`): nasconde per-portata, con **fallback automatico** al vecchio `hide_items` globale se `hbc` assente → degrada senza errori. `api/admin/lunch.ts` e `api/admin/set-menus.ts` adeguate (select con fallback, sanitizzazione, `hide` per corso).
- **Fix scheda lunch**: i piatti «fuori menu» non comparivano (venivano cercati per id tra i piatti del menu → non trovati → filtrati). Ora usano `labelLibero()` come nella scheda cliente.
- **Rifiniture modali menu**: nome portata personalizzata → etichette per-campo tolte, lingua nel placeholder + unica label «Nome portata»; sezione «Piatti» con label; **cestino portata spostato in basso a destra**; bottone «+Altro/Aggiungi» dentro il tab Fuori menu, sotto i 3 campi lingua, a larghezza piena. Foto su **mobile**: «Carica una foto» → «Carica» (`tl-full/tl-short`, chiave breve `cli.uploadPhotoShort`). Footer menù fisso: **Salva bozza raggruppato** con Annulla/Salva in `.m-btns` (gap 0.6rem).
- **Switch «ordinabile» nascosto quando il modulo Ordini è OFF** (super admin). La pagina menu legge `/api/admin/pages`; se `hidden` include `orders` mette `body.no-orders` → CSS nasconde lo switch nella lista piatti (classe `sw-cmd`) e nel modale piatto (`m-toggle-cmd`). Restano «Menu» ed «Esaurito».
- **Agenda — editor RICH TEXT per la descrizione lunga evento** (nuova feature). Toolbar per lingua: **grassetto, corsivo, H2, H3, link, rimuovi-link**; editor WYSIWYG `contenteditable` (execCommand, `defaultParagraphSeparator=p`, mousedown+preventDefault per non perdere la selezione, URL link via prompt). Salvataggio come **HTML sanitizzato lato server** (`pulisciHtml` in `agenda.ts`): whitelist stretta `b/strong,i/em,u,h2,h3,p,br,ul,ol,li,a`; ogni altro tag rimosso (testo resta), TUTTI gli attributi eliminati tranne `href` sui link (solo schemi `http/https/mailto/tel`, protocol-relative→https, path interni; scarta `javascript:`/`data:`), link con `target=_blank rel=noopener noreferrer nofollow`; `script/style/iframe/object/embed` rimossi CON contenuto. Limite 6000→8000. i18n `ag.rte*`. Sanitizer testato (onclick/style/img/onerror/js-scheme neutralizzati). ⚠️ **Il sito pubblico deve renderizzare `body_long_i18n` con `set:html`** (non testo escapato), altrimenti mostra i tag — la pagina pubblica eventi NON è nel repo motore.
- **Cron ChouChou — TUTTI mancanti**: scoperto (via `/api/cron/daily-brief?force=1` = invio OK ma nessuno scheduler) che su ChouChou `cron.job` era **vuoto** → non partivano recap, promemoria prenotazioni, completamento ordini, newsletter, google-reviews. Ricreati i **5 job pg_cron** sul Supabase di ChouChou (dominio `comptoirchouchou.be` + suo `CRON_SECRET`, header `x-cron-key`), estensioni `pg_cron`+`pg_net` già attive, run `succeeded`. **Lezione + doc**: `SETUP.md` §6 aggiornato da 3 a **5 job** (mancavano `auto-complete-orders` e `google-reviews`); creato **`NUOVO_PROGETTO.md`** (checklist passo-passo nuovo cliente). Hosting = **Hostinger** (annotato in memoria: NON Vercel; `CRON_SECRET` sta nelle env Hostinger). NB (aggiornato 04/09): il blocco cron `google-reviews-hourly` è già presente e COERENTE con gli altri 4 job in `SETUP.md` §6 e `NUOVO_PROGETTO.md` (segnaposto `IL-DOMINIO`/`IL_CRON_SECRET` come tutti gli altri) — niente da sistemare, si compilano dominio+secret al setup di ogni cliente come per gli altri job.
- **Rifiniture clienti/menu earlier (stessa sessione)**: scheda cliente mobile (email/nome troncati con «…», lingua in alto a destra, icona cash sul totale, bottoni impilati, numeri su una riga), fix overflow ChouChou (`no-orders`), modale cliente nome sticky, lingua a pillole nel modale aggiungi cliente, `sw.js` difensivo (solo navigate), FAB unificati (`fab.css` `.fab-pill`, dropshadow, label ridotti tablet/mobile), **normalizzazione nomi** (`normalizzaNome.ts`, prima maiuscola + accenti Unicode, applicata a prenotazioni/checkout), tab/filtri menu scrollabili in orizzontale, nome piatto troncato «…», card piatto mobile (edit a sx del delete, handle più piccola, switch allineati a foto/prezzo), sezioni pre-inserite, modale piatto (prezzo accanto a categoria, checkbox allergeni brand, switch nel footer, classi mobile), `modal.css` condiviso (titolo/padding/bottoni piccoli su mobile per tutti i modali).

## 📌 26/08/2026 — sessione Cowork (Ordini: card, header responsive, modale Nuovo ordine + autocompletamento cliente)

- **Card ordine — footer terminato/annullato**: il tag «COMPLETATO» è stato spostato dall'alto (vicino al totale) a un **footer in fondo alla card** sulla stessa riga del bottone rollback; icona rollback cambiata (freccia curva `ICON_ROLLBACK`, viewBox 0 0 512 512). Aggiunto tag rosso **«ANNULLATO»** per gli ordini annullati (stessa forma di COMPLETATO ma bordo+testo rossi). Tag ora **pillole** (border-radius 999px, padding maggiore). Footer unificato `.card-foot` (assoluto, `bottom:0.9rem`, **altezza fissa 40px** con `align-items:center`): tag a sinistra + bottone a destra (rollback o Rimborsa) **centrati** e allineati tra tutte le card. Card ordine con **border-radius 2px** (angoli appena smussati). Drop shadow leggero sui tag e sul FAB «+ Ordine» (a **opacità fissa** `rgba(0,0,0,.4)`, NON legata a `--sh` che sul tema scuro è ~0 → prima invisibile).
- **Header Ordini — responsive tablet**: la testata (titolo + Oggi/data/ricerca + bottoni preparazione) andava a capo male su tablet. Regole dedicate SENZA toccare desktop/mobile: **landscape ≥1024px** `@media(1024–1366)` → `.head-row{flex-wrap:nowrap}` (controlli in linea col titolo come desktop), etichetta PREPARAZIONE nascosta, ricerca elastica, bottoni preparazione compatti (solo icona+numero). **Portrait 641–1023px** → ricerca in **alto a destra** in linea col titolo (assoluta), Oggi/data + bottoni preparazione (con label min/Chiudi ripristinate) **allineati a destra** sulla riga sotto.
- **FAB «+ Ordine» — sollevato sopra la navbar quando serve**: su tablet/telefono l'isola nav larga copriva il FAB. JS in `AdminNav` misura lo spazio reale a lato dell'isola e imposta il `bottom` del FAB **inline** (si adatta all'altezza vera della barra); più media query di sicurezza (`≤520` e `521–1023`). Ricontrolli multipli (150ms→2.5s + ad ogni click) per l'allargamento asincrono dell'isola.
- **Header globale — tablet portrait**: data nascosta (come su mobile) per non sovrapporsi all'orologio; **orologio spostato accanto al logo** (al posto della data) via `position:static; margin-right:auto` in `@media(641–1023)`.
- **Navbar — ingranaggio super admin integrato**: il bottone Réglages super admin (`admin-super`) non è più un'isola staccata a sinistra ma il **primo item DENTRO l'isola nav**, seguito da un **separatore verticale `|`** (`.nav-sep`), poi il resto. Solo per super admin (logica `isSuperUser` invariata). Rimossi CSS «isola flottante» + funzione JS `posizionaSuper()` + superficie glass separata.
- **Modale «Nuovo ordine» — desktop più grande + scroll interno**: dimensione **fissa 80vw × 80vh** (`@media ≥761px`), flex column: titolo/step/footer fissi, **pannello centrale con scroll interno** (carrello lungo scorre, il modale non si ingrandisce). Colonna **menu a sinistra sticky** (`position:sticky; align-self:start`) mentre il carrello scorre.
- **Modale — step 3 pagamento**: i tre bottoni Contanti/Carta/Link di pagamento ora sulla **stessa riga** (`flex:1 1 140px; flex-wrap`) con **icone delle card ordini** (coins/card/stripe, iniettate via JS). Bottone **«Conferma l'ordine» spostato nel footer** del modale (`.nc-nav`, a destra, fisso) invece che a tutta larghezza nel pannello; nascosto correttamente fuori dallo step 3.
- **Modale — autocompletamento cliente + piatti preferiti** (nuova feature): digitando nome/cognome (`#nc-prenom`/`#nc-nom`) compare un **dropdown dei clienti che hanno già ordinato** (stesso pattern delle prenotazioni: debounce 250ms, min 2 char, frecce/Invio/Esc, seq-guard). Al click **precompila** nome, cognome, email, telefono (prefisso separato) e **seleziona la lingua email** (dall'ultimo ordine). Sotto i dettagli, i **5 piatti più ordinati** dal cliente come **chip cliccabili** (aggiungono al carrello; disabilitati se non più a menu). Backend: due branch in `GET /api/admin/orders` — `?client_search=` (cerca in `orders.customer_name` + tabella `clients`, ritorna name/first/last/email/phone/lang) e `?client_top=1&email=&phone=` (aggrega gli `items` JSON degli ordini paid/done, top-5 per qty escludendo la riga «note», + lingua ultimo ordine). i18n `ord.favItems/favAdd/favAdded` (5 lingue). `npx tsc --noEmit` = 0 errori.

## 📌 21/08/2026 — sessione Cowork (Marketing: pop-up, newsletter, coupon, buoni, tab Promozioni)

- **Pop-up (modale marketing) — multilingua + immagine + posizione + pulsanti raggruppati**: (1) i tab lingua del modale ora sono generati dalle **lingue pubbliche** (super admin, `boot.publicLangs`/`LINGUE_PUBBLICHE`), ordine con default per primo, iniettate via `<script id="pub-langs">`; salvataggio su `title_i18n/body_i18n/btn1_label_i18n/btn2_label_i18n` (pattern Agenda). (2) Image-picker **identico al piatto** (anteprima + Carica una foto + Libreria + Rimuovi, `renderFotoPop`/`ICO_IMG_POP`). (3) **Selettore posizione** (grafica 4 schermi: center/bottom-left/bottom-center/bottom-right) → colonna `popups.position` (default center); il pubblico applica via `data-pos` in `SitePopup.astro`. (4) **Etichetta+link di ogni pulsante raggruppati** dentro il pannello lingua (label i18n + url condiviso sincronizzato tra le lingue, delega `.asset-pop`/input su `#f-panels`). Migrazioni: `popups_i18n.sql`, `popups_position.sql` (idempotenti, le lancia Enzo).
- **Newsletter — quota mensile configurabile per cliente (super admin → Integrazioni)**: card «Newsletter» con campo «Invii inclusi al mese» → chiave `app_config` `newsletter_monthly_quota` (nessuna migrazione, default 1000). `newsletterQuota.ts` legge il valore (helper `quotaMensile()`, ritorna `monthly_quota` in `StatoQuota`) invece del `QUOTA_MESE=1000` fisso; `integrations.ts` GET/PUT (validazione 0–1 000 000). Marketing/Newsletter mostra il nuovo totale in automatico; i crediti acquistati si sommano sopra.
- **Newsletter (modale) — immagine + footer**: immagine spostata **sotto i destinatari** (prima dell'oggetto) con lo stesso image-picker dish-style (`renderFotoNews`, sync su upload/libreria/reset/riprendi-bozza/rilancio). Footer: frase disiscrizione spostata **piccola sopra i pulsanti** (Invia/Test/Salva) dentro `.m-foot--news` (colonna); tolto il `<p>` che stava sotto il footer → footer ora **sticky in fondo** senza sollevarsi a fine scroll.
- **Coupon (modale) — footer**: switch **Nuovi clienti / Attivo a sinistra**, pulsante **Salva a destra** (`margin-left:auto`).
- **Buono regalo (modale) — riepilogo**: Valore/Scadenza/Codice/Pagamento in **griglia 2×2 di riquadri** (bordo, icona accent + label sulla stessa riga, valore sotto in grassetto); icone euro/calendario/hash/carta. Offerto da/Destinatario/Messaggio ora **label in cima e valore sotto** (righe impilate, `.r-row` a colonna, allineate a sinistra). Più spazio (1.6rem) tra l'ultima riga e «Invia il buono via email» (`#gc-send-box`).
- **Marketing — nuovo tab «Promozioni»**: quinto tab (`data-tab="promos"`, icona %), pane `tab-promos` placeholder «Prossimamente», collegato a `mostraTab`. Contenuto da definire con Enzo (offerte a tempo / sconti / happy hour / bundle). i18n `tab.marketing.promos`, `mk.promoSoon`.
- **Backlog (memoria)**: annotato **REPORT NEWSLETTER** (aperture/click/bounce/spam per campagna via webhook Resend + tabella `newsletter_recipients` + pagina report). Opt-out già tracciato (`newsletter_optout`); aperture/click da costruire. Da fare più avanti.
- **Agenda — date picker eventi senza blocco sul passato**: rimossi i 3 blocchi (giorni passati `dp-off`+`disabled`, freccia ‹ bloccata sui mesi precedenti) in `agenda.astro`; ora la scelta data è libera anche nel passato (oggi resta evidenziato).
- **Email footer — wordmark RestoHub adattivo al tema**: le email usavano SEMPRE `wordmark-negative.png` (bianco) → invisibile su tema chiaro. Generato `public/restohub/wordmark.png` (positivo teal+rosso dal SVG, 880×117 trasparente) e cambiati gli 8 punti (`notifications.ts` ×6, `contact.ts` ×2) in `wordmark${tema.isDark ? "-negative" : ""}.png`. **Ricetta merge aggiornata**: dopo il `checkout HEAD -- public/` di protezione serve `git checkout engine/main -- public/restohub/` (branding motore, non foto cliente), altrimenti ai clienti a tema chiaro manca il file → footer email rotto.
- **MERGE ChouChou (2026-08-21)**: ChouChou (tema chiaro, dominio temp Hostinger `blanchedalmond-pheasant-795745.hostingersite.com`) aggiornato al motore. Era molto indietro → merge con ~11 conflitti + molte aggiunte (template demo01, pagine legali, feedback, feature recensioni Google). Risolti sulla VM scrivendo in-place (`git show :3:`=motore, `:2:`=cliente) perché `git checkout` fallisce sulla VM (unlink negato); ReservationWidget tenuto coi colori ChouChou (rosa #ed2289). `astro check` 0 errori. Migrazioni ChouChou allineate: mancavano solo `google_reviews.sql`, `popups_i18n.sql`, `popups_position.sql` (lanciate). Cron: pg_cron (5 job) da configurare col dominio vero. Env minima per ora: Supabase + `MOODD_STRIPE_SECRET_KEY` (crediti+gift card via retrieve, NO webhook/Resend necessari per comprare). NB: ChouChou mergiato PRIMA del fix wordmark → non ha ancora `wordmark.png` (applicare passo 5 al prossimo merge).
- **Backlog (memoria)**: aggiunti **SYNC AUTOMATICO Assets>Sito** (mappa immagini auto-generata dalle pagine, convenzione `siteImg({page,group,key,label,fallback})` + scanner) e **OAUTH GOOGLE callback centralizzato** (un solo redirect URI MOODD con `state` firmato che rimanda al dominio cliente, per non aggiungere a mano ogni dominio su Google Cloud). Chiarito: template email VIVONO NEL MOTORE (dati/tema/lingua sono i soli per-cliente).

## 📌 20/08/2026 — sessione Cowork (Mac mini)

- **Passata di qualità « senior » prima del push**: `astro check` + `astro build` sull'INTERO motore = **0 errori / 0 warning** (200 file). Corretti 8 errori TS latenti: il pattern retry-tollerante di Supabase (`{data,error}` ri-assegnati con SELECT diverso) ora è tipizzato in modo esplicito in `api/admin/lunch.ts`, `api/admin/set-menus.ts` e `api/set-menus.ts` (public); `session?.access_token` null-safe in `agenda.astro`; Map lingue clienti tipizzata `<string, …>`. **Performance**: eliminata una query `app_config` **non in cache** che *menu* e *agenda* facevano a OGNI render SSR per leggere le lingue pubbliche — quei valori sono già dentro `caricaBootAdmin()` (una sola query, cache 60s, condivisa con lingua/tema) → da 2 round-trip a 1 su entrambe le pagine. **Sicurezza (verificata, nessuna regressione)**: tutte le route `/api/admin/*` passano da `verificaStaff` (firma JWT verificata in locale ES256/RS256 + `exp` + fallback `getUser`), service key solo lato server (il browser usa la anon `PUBLIC_`), upload con allowlist bucket+estensione, limiti di dimensione e slug cartella sanitizzato (no path traversal), `esc()` su tutti gli innerHTML. *Advisory* (non modificati, da decidere con Enzo): `verificaStaff` autorizza qualunque JWT valido a prescindere dal ruolo — sicuro solo se la registrazione pubblica su Supabase è disattivata; gli SVG caricati potrebbero contenere script (rischio basso: storage cross-origin, upload solo staff).
- **Agenda / Eventi — card ridisegnata + fix salvataggio**: la card evento ora ha la **foto a tutta larghezza in alto** (16:9) e le info sotto (titolo, data, descrizione, tag, riga azioni con switch Attivo a sinistra e modifica/elimina a destra), in griglia responsive, sul modello delle card menu/set-menu. Risolto il « Non autorisé » al salvataggio: **non era un GRANT** (la tabella `agenda_events` è già autorizzata e `verificaStaff` non interroga tabelle) ma l'access token **catturato una sola volta al load e poi scaduto** → nuovo helper `authFresh()` che prende un token fresco (`getSession`, auto-rinnovato) prima di OGNI scrittura (carica, upload, salva, elimina, toggle attivo). Migrazione `agenda_events_i18n.sql` (`title_i18n`, `body_i18n`, `body_long_i18n`, `rsvp_max`) lanciata.
- **Modale prenotazione manuale — messaggi + lingua cliente**: (1) i messaggi di validazione/errore (`m-msg`, es. «Scegli un orario», nome/telefono mancante) ora sono una **pillola rossa con testo bianco** ben visibile (nascosta quando vuota via `:empty`; i successi restano toast). (2) Aggiunto il **selettore lingua del cliente** nel modale (opzioni dal widget: bandiera + nome, default fr): la lingua viene salvata sulla prenotazione (`lang`) e usata per la mail di conferma, così parte nella lingua giusta. Backend: `normLang()` valida contro le 10 lingue del widget; POST usa `body.lang` (non più `"fr"` fisso) e PATCH aggiorna `upd.lang` in modifica.
- **Menu — toggle Esaurito sulla riga**: terzo interruttore ⛔ Esaurito accanto a MENU/ORD. su ogni riga piatto (con più spazio tra i toggle, raggruppati in `.i-switches`); l'etichetta rossa «Esaurito» accanto al nome si aggiorna al volo. Griglia mobile adattata (tre toggle in riga). PUT `sold_out` come per available/orderable.
- **Menu — stato «Esaurito»**: nuovo toggle ⛔ Esaurito nel modale piatto (sotto Visibile/Ordinabile) + indicatore rosso «Esaurito» nella lista piatti. Colonna `menu_items.sold_out` (migrazione `supabase/menu_sold_out.sql`); API/SSR con SELECT tollerante se la colonna non è migrata. Distinto da available (visibile) e orderable (ordinabile): il piatto resta in carta ma segnalato non disponibile.
- **Fix sotto-categoria che finiva in fondo**: creando una sotto-sotto-categoria (es. «test 2» sotto «test»), al reload/riapertura finiva in coda invece che annidata. Causa: il caricamento **SSR** (`caricaMenu.ts`) ordina le sezioni per `sort_order` piatto, non ad albero. Fix: ordinamento **depth-first lato client** (`ordinaAlbero` in `menu.astro`) applicato sia ai dati SSR sia a quelli API, così l'annidamento è sempre corretto.
- **Menu pubblico — anche demo01**: il fix vale sia per `OrderApp` (/order) sia per il template **demo01** (`_page.html`, menu inline che consuma `/api/menu`). In demo01 i chip filtro ora sono le sole categorie **root**; le sotto-categorie compaiono come titolo (`.menu-subtitle`, accent, full-width nella griglia) sopra i loro piatti. `DISHES` porta `root`/`sub`/`depth`/`co`; `renderMenu` filtra per `root` e inserisce i titoli per depth>0.
- **Menu pubblico — sotto-categorie come titoli, non filtri**: nel menu d'ordine (`OrderApp`) i filtri restano solo le **categorie principali**; le sotto-categorie compaiono come **titolo** dentro il gruppo della loro categoria radice, sopra i piatti. `db.ts` (`getMenu`/`getMenuOrderable`) arricchisce ogni categoria con `parent`/`depth`/`root` (da `menu_categories`, tollerante); OrderApp raggruppa per `root` se c'è gerarchia, altrimenti mantiene il raggruppamento legacy (La Molisana). Titolo sotto-categoria mostrato solo per depth>0.
- **Menu — pillola sotto-categoria (verde scura) trascinabile**: l'intestazione della sotto-categoria è ora una **pillola verde scura** con maniglia di trascinamento. Trascinandola si **riordina la sotto-categoria** (tra sorelle dello stesso livello; sposta anche il suo blocco di piatti) → PATCH categorie (nodes). Trascinando un **piatto** sopra/sotto la pillola, il piatto **entra nella sotto-categoria** (evidenziazione drop-target, cambio categoria + ordine). Item-drop usa `.item, .sub-head` come confini (si può cadere anche in un gruppo vuoto).
- **Menu — sotto-categorie nella lista (non come tab)**: i tab sezione ora mostrano solo le categorie di primo livello. Aprendo una categoria, le sue **sotto-categorie appaiono come intestazioni dentro la lista** (bordo/accento a sinistra, ↳, indentate) con i loro piatti raggruppati sotto. I piatti si riordinano dentro ogni gruppo e si **spostano tra gruppi** trascinandoli (drag group-aware: PUT category sul piatto spostato + PATCH ordine per gruppo). Assegnando un piatto a una sotto-categoria dal modale, il tab attivo resta la categoria radice (`radiceDi`).
- **Menu — sotto-categorie (fino a 3 livelli)**: gerarchia sulle sezioni. **Backend** (`menu_subcategories.sql`: `parent_id`+`depth` su menu_categories, nomi ancora unici → link piatti per nome invariato): API `categories.ts` tree-aware (POST con parent_id, PUT reparent+ricalcolo depth sotto-albero, PATCH `nodes:[{id,parent_id}]`, DELETE bloccata se ha figli). GET/SSR ordinano depth-first. **Modale «Gestisci sezioni»**: righe indentate con trattini per livello; «＋» crea una sotto-sezione (form con pill «Sotto-sezione di X»); ⇥ rientra sotto la sorella precedente, ⇤ risale di un livello; drag sposta l'intero sotto-albero. Il select sezione del modale piatto mostra la gerarchia indentata (↳). Prossimi step: lingue delle sezioni + resa nel menu pubblico.
- **Menu — modale piatto a 2 colonne + tab**: il modale ora è largo (940px) e diviso in due. **Sinistra**: foto, sezione, nome(i)+prezzo, badge. **Destra**: tab **Descrizioni / Allergeni / Sconto** con i campi corrispondenti che appaiono per tab (sottolineatura sul tab attivo; si riparte sempre da «Descrizioni» all'apertura). Solo layout: ID invariati, nessun impatto su dati/API.
- **Menu — traduzioni piatto nelle lingue del sito pubblico**: il modale piatto ora legge le **lingue pubbliche** (`public_languages`/`public_lang_default` via `normalizzaLinguePubbliche`) e propone dinamicamente i campi: **Nome** nella lingua predefinita + un campo Nome per ogni altra lingua, e una **Descrizione per ogni lingua** (es. sito IT/FR/EN → Nome IT/FR/EN + Descrizione IT/FR/EN). Storage: nuove colonne `menu_items.name_i18n` / `desc_i18n` (jsonb, migrazione `supabase/menu_i18n.sql`); `name` resta il nome canonico (ordini/cucina) = lingua predefinita; `description_fr/en` restano allineate da `desc_i18n` (retro-compat menu pubblico legacy). API menu + SSR `caricaMenu` tolleranti se le colonne non sono ancora migrate (fallback SELECT_BASE).
- **Fix lingua che spariva al refresh + filtro con 1 lingua**: (1) la lingua manuale spariva al reload perché il caricamento iniziale usa i dati **SSR** di `caricaClienti.ts` (copia dell'aggregazione) che NON leggeva `clients.lang` → allineato (interfacce + `clientiManuali` con `lang` e fallback tollerante + override manuale nella fusione). Ora refresh e save mostrano lo stesso valore. (2) Il chip filtro lingua ora compare già con **≥1** lingua assegnata (prima serviva ≥2).
- **Clienti — colonna + filtri Lingua, e lingua nel modale**: aggiunta la colonna **Lingua** nella lista (bandiera + codice, sortabile), i **filtri per lingua** in coda alla riga dei filtri (chip inline accanto a Opted-out, con conteggio, toggle indipendente, mostrati solo se ≥2 lingue) e il **selettore lingua nel modale di modifica cliente**. La lingua viene ora salvata sulla tabella `clients` (colonna `lang`, migrazione `supabase/clients_lang.sql`): **la lingua NON si deriva più al volo** dalle prenotazioni (era instabile: si ricalcolava a ogni load, e sui dati demo tutte le prenotazioni hanno lang='fr'/source='web' di default → sembrava attribuita a tutti e cambiava al refresh). Ora `clients.lang` è l'UNICA fonte: impostata (a) a mano nel modale cliente, (b) **catturata automaticamente dal widget web** (`registraCliente` in `api/reservation.ts` scrive la lingua della prenotazione web SOLO se il cliente non ne ha già una — `update(...).is('lang', null)`, best-effort, tollerante se la colonna manca). Walk-in/telefono NON catturano lingua (default fr non è una scelta). Risultato: cambiare un cliente tocca solo quello, e il refresh è stabile. Lettura clienti tollerante se `clients.lang` non è migrata (foto/blocco preservati). Backend: `normLangCli()` valida contro le 10 lingue widget; GET arricchisce ogni cliente con `lang`; PATCH salva `lang` (con fallback se la colonna non è ancora migrata).
- **Clienti — storico a tab (Prenotazioni / Ordini)**: sopra lo storico due tab con contatore per non avere una lista unica enorme. I dati (`activity`) si caricano una volta e si filtrano lato client (`renderAtti`); i tab sono sticky in alto nella colonna. Default: Prenotazioni (Ordini solo se il cliente non ha prenotazioni).
- **Clienti — modale attività più largo, storico su una riga**: il modale storico cliente passa da `max-width` 900px a 1080px e le righe (`.act-row`) da `flex-wrap: wrap` a `nowrap`: data e importo/badge non vanno più a capo, la label (« Réservation · 5 pers. · Terrazzo ») si tronca con ellissi se serve. Così ogni voce dello storico sta su una sola riga.
- **Prenotazione manuale → email di conferma al cliente**: aggiungendo una prenotazione dall'admin (walk-in/telefono), se lo staff inserisce l'email parte ora la mail di conferma al cliente (`inviaConfermaResa`), come per le prenotazioni web. Senza email (walk-in anonimo) non si invia nulla. Aggiunto in entrambi i rami del POST (principale + fallback #21). La recensione J+1 era già programmata.
- **Modale «Nuova prenotazione» — fix autofill + typeahead clienti**: (1) l'autofill email del browser finiva nella barra di ricerca dietro il modale → ora, con il modale aperto, la barra `d-search` viene disabilitata e il campo email ha `name="email"` + `autocomplete="email"`, così l'autofill può mirare solo al campo giusto. (2) Digitando nome o cognome compare un dropdown coi clienti già in DB (nuovo endpoint `GET /api/admin/reservations?client_search=` che cerca in `clients` + prenotazioni passate, dedup, max 8; mostra badge «bloccato»). Click/frecce+Invio precompilano nome, cognome, prefisso+telefono ed email — niente più riscrittura per i clienti abituali.
- **Pagine prenotazione demo01** (`/demo01/reservation` e `/demo01/reservation/cancel`): i bottoni *Modifier*/*Annuler* delle email ora puntano al sito del cliente, ma quelle pagine esistevano solo alla root (`/reservation`, `/reservation/cancel`) → 404 sotto `/demo01`. Create le due versioni demo01 dentro `Demo01Layout` (header/footer del sito, palette nero/rosso), come già fatto per `order-confirm`/`order-cancel`. `reservation.astro` = `ReservationWidget` (legge `?token=` per la modifica); `reservation/cancel.astro` = stessa logica del cancel root (fetch `/api/reservation?token=`, conferma, DELETE) ristilizzata. Nota: i clienti veri (sito alla radice) usano già le pagine root, questo serve solo al caso demo01 in sottocartella.
- **Fix link email prenotazione → sito giusto**: i bottoni *Modifier* e *Annuler* nelle email al cliente (conferma, demande, annullata, chiusura) puntavano alla root del dominio invece che al sito del cliente (`/reservation/cancel...` invece di `/demo01/reservation/cancel...`). `siteBase()` non conosceva il prefisso: aggiunto `basePubblicaResa()` (legge `app_config.public_site_base`) + `siteBaseResa()` async, usato per i 6 link `/reservation` cliente. Stessa logica del fix payment link. Gli asset RestoHub (logo/wordmark) restano su `SITE_URL` (root).
- **Prenotazioni — modale NO-SHOW**: scegliendo lo stato *no-show* dal menu non si cambia più stato al volo: si apre un modale che (1) mostra lo **storico no-show** del cliente (via `client_stats`, per email/telefono; «Premier no-show» se 0), (2) ha uno **switch per bloccare il cliente** per le prossime prenotazioni (riusa `PATCH /api/admin/clients` con `blocked:true`), e (3) due bottoni: **Prévenir le client** (no-show + email) e **Sans prévenir** (no-show, nessuna email). L'email al cliente ora è **condizionale**: il backend invia `emailNoShowResa` solo se il PATCH riceve `notify:true` (prima partiva sempre in automatico). Il blocco è best-effort: anche se fallisce, il no-show resta salvato.
- **Prenotazioni — email NO-SHOW al cliente**: mettendo una prenotazione in stato *no-show* parte ora un'email formale nella lingua del cliente (`emailNoShowResa`, 10 lingue). Tono rispettoso ma fermo: non si è presentato, un avviso avrebbe permesso di offrire il tavolo, il ristorante dà priorità a chi rispetta la prenotazione o avvisa, ci farebbe piacere accogliervi in futuro. Stesso guscio a tema `guscioResa` (nessun bottone «Réserver à nouveau», tolto su richiesta). Wiring nel PATCH `reservations.ts`: invio solo alla transizione verso no-show (`statoPrima !== "noshow"`), come per l'annullo.
- **Prenotazioni — modale cestino a due scelte**: cliccando il cestino su una prenotazione ora esce un modale che distingue **Annuler et prévenir le client** (PATCH status=cancelled → email `emailAnnullataResa` al cliente) da **Supprimer sans prévenir** (DELETE silenzioso, nessuna email). Prima il cestino faceva solo il delete silenzioso e i ristoratori lo confondevano con l'annullo. Se la prenotazione è già annullata/no-show resta solo "Elimina".
- **Mappa Google nella conferma cliente**: fix lettura chiave via `import.meta.env` (process.env vuoto a runtime). Richiede Maps Static API abilitata.

- **Email prenotazione al RISTORATORE ridisegnate** e rese distinte dagli ordini: guscio condiviso `guscioResaRisto` (card chiara, nome + coperti in alto, bottone "Appeler le client", 3 riquadri **Date · Heure · Service** allineati, dettagli + note, footer). **Codice colore per tipo**: verde=nuova, ambra=modifica, rosso=annullo. Colori fissi (non a tema) per non confonderle con gli ordini. Niente SVG inline (Gmail li rimuove).
- **Email transazionali unificate** (design come le conferme ordine): ridisegnate email **link di pagamento** e tutte le **email prenotazione lato cliente** (conferma, promemoria, richiesta, annullata, chiusura). Il guscio condiviso `guscioResa` + `rigaRecap` ora sono **theme-aware** (colori da `admin_theme`), con logo ristorante in alto, box/recap a tema, bottoni a pillola e footer con indirizzo + wordmark RestoHub; inviate via `avvolgiTema`. Le email al ristorante (notifiche interne) restano invariate.
- **Card ordini**: icona metodo pagamento accanto a PAGATO (contanti/carta/Stripe wordmark bianca 28px); barre stato in fondo (differenza da pagare / rimborso).
- **Fix link pagamento** post-checkout → sito giusto via `public_site_base` (app_config).
- **Config applicate su Supabase (19/08)**: `app_config.public_site_base = /demo01` impostato (redirect payment link → `/demo01/order-confirm`); migrazione `supabase/agenda_events.sql` già lanciata. Resta solo il `git push` dal Mac di Enzo.

## 📌 19/08/2026 — sessione Cowork (Mac mini)

- ✅ **Google Business Profile API approvata** (progetto "MOODD Admin" su Google Cloud). Sblocca lettura recensioni/rating e — in prospettiva — le risposte, direttamente nell'admin invece del solo link Google. Quota vista: **300 req/min** (adjustable). **Integrazione da fare più avanti** (cache lato motore come `/api/reviews`, alert quota >90%). Enzo: "la facciamo dopo".
- **Ordini**: rifiniture email/recensioni chiuse (vedi 18/08). Enzo in fase di test; se ok si passa alle **prenotazioni**.
- **Email "ordine modificato" ridisegnata** (fatto): stesso header/footer delle altre (logo ristorante in alto, RestoHub nel footer, wrapper `avvolgiTema`). Il blocco "cosa è cambiato" ora mostra **l'ordine iniziale intero**: righe tolte **barrate** (tag "Retiré"), aggiunte in verde con `+`, quantità cambiate `old× → new×`, totale prima→dopo, e sotto il box orario un "auparavant HH:MM" barrato. **Bug fix**: il PUT rileggeva l'ordine vecchio senza il campo `items` (SEL_FULL/SEL_BASE) → il diff vedeva tutto come "aggiunto"; ora legge gli `items` e costruisce la lista unione vecchio/nuovo (`OrdineChanges.lines`).
- **Fix redirect dopo pagamento link**: il link di pagamento generato dall'admin riportava al `/order-confirm` della root (chrome sbagliato, es. La Molisana) invece del sito reale. Aggiunto `returnBase` configurabile via app_config **`public_site_base`** (es. `/demo01`), passato a `creaCheckoutSession`/`creaCheckoutSupplemento`. ⚠️ **Da impostare su Supabase**: `public_site_base = /demo01` (o la base del sito del cliente).
- **Fix falsa notifica "nuovo ordine"** all'annullamento: `recent_paid` alzato da 20 a 200 (la finestra piena faceva "risalire" un vecchio pagato scambiato per nuovo).
- **Barra stato in fondo alla card** (differenza da pagare e rimborso): tolti i tag in alto che si accavallavano col totale. `diff-bar` (ambra in attesa / verde ✓ pagata) e `diff-bar-refunded` (rimborso parziale con importo / totale ✓), a tutta larghezza sotto gli articoli, escluse dall'attenuazione delle card spente.
- **Auto-completamento ordini** (fatto, serve cron): nuovo endpoint `GET /api/cron/auto-complete-orders` (protetto da `CRON_SECRET`). Alle 02:00 del giorno dopo, gli ordini `paid` non completati passano a `done` (grazia notturna: soglia = inizio giornata odierna dopo le 02:00, altrimenti giorno prima). Idempotente, nessuna email. ⚠️ **Schedulazione via Supabase pg_cron + pg_net** (Enzo NON usa cron-job.org): `cron.schedule` con `net.http_get` verso l'endpoint `?key=CRON_SECRET`, ogni ora (come newsletter/daily-brief).
- **Recap modifiche nel modale ordine** (fatto): nello step "Cliente e pagamento" del modale di modifica compare un box "Modifiche" che confronta col l'ordine originale (orario prima→dopo, piatti aggiunti/tolti, totale prima→dopo); si aggiorna quando si apre lo step 3. L'email al cliente con le stesse modifiche era già attiva (18/08).
- **Email annullamento ordine** (fatta): il PATCH di annullamento (`orders.ts`) ora manda al cliente `inviaAnnullaOrdine` (`notifications.ts`, 5 lingue, stesso stile/tema delle altre). 3 casi automatici dal metodo di pagamento: **online/payment link** → box "Rimborso in arrivo" + importo (residuo = totale − già rimborsato) + nota 5-10 giorni; **cassa (cash/card)** → nota "rimborso al ristorante"; **link non pagato** → "nessun importo addebitato". Il rimborso reale su Stripe resta separato (refund.ts).
- **Nuova pagina admin Agenda/Eventi** (fatta, 1ª iterazione): voce di nav dedicata `/admin/agenda`, CRUD completo con modale nello stile delle altre pagine (titolo, immagine principale + bibliothèque, descrizione, **galleria** multi-upload, **data singola o intervallo** col datepicker brand, **link esterni** dinamici, **RSVP** sì/no, toggle pubblicato/bozza).
  - Nuova tabella **`agenda_events`** (`supabase/agenda_events.sql`) — ⚠️ **da lanciare su Supabase** prima dell'uso. Immagini nel bucket `popups` esistente.
  - API `src/pages/api/admin/agenda.ts` (GET/POST/PUT/DELETE, verificaStaff, X-Method-Override per il DELETE). Registrata in `PAGINE_ADMIN` (superAdmin.ts), voce in `AdminNav.astro`, chiavi i18n `nav.agenda`/`nav.s.agenda`/`ag.*` (5 lingue) in `i18n/admin.ts`.
  - **Solo gestione admin**: nessun rendering pubblico lato sito ancora (prossimo step)."

## 📌 18/08/2026 — sessione Cowork (Mac mini)

Rifinitura delle **email transazionali** e nuova **gestione recensioni con gating**. Tutto in `notifications.ts` + `api/admin/orders.ts`, più una pagina/endpoint nuovi. Commit `39979ea` su `main` (push da fare a mano dal Mac: il ponte Cowork→Mac non ha rete, `git push` va lanciato dal terminale).

### ✉️ Email "Ordine modificato" → blocco «cosa è cambiato»
Nella mail di modifica cliente (`emailModificaCliente`) ora c'è un riepilogo di **cosa è cambiato** rispetto all'ordine originale: **orario** prima→dopo (con data se cambia il giorno), **piatti aggiunti / tolti** (diff per quantità), **totale** prima→dopo. Il diff è calcolato in `api/admin/orders.ts` (mappa vecchi `ord.items` vs nuovi `itemsOrdine`, netting per nome) e passato a `inviaModificaOrdine(..., { changes })` in entrambi i rami (supplemento/rimborso e cassa). `TXT_MOD` esteso con le etichette (5 lingue).

### 🍽️ Ticket cucina → badge «Pagato» + «Chiama il cliente»
`emailCucina` (il ticket che arriva in cucina) ora mostra un **badge/pill «Pagato»** quando l'ordine è saldato online e un **bottone «Chiama il cliente»** (`tel:` verso il numero cliente). Etichette nella **lingua dell'admin** (non del cliente), coerente col resto del ticket.

### ⭐ Recensioni → stelle cliccabili con gating (1-3 privato, 4-5 Google)
La mail recensione (`emailReview`) non manda più a un solo link generico: le **5 stelle sono link** e fanno gating.
- **1-3 stelle** → pagina **feedback privata** `/feedback` (il messaggio arriva **solo al ristorante**, non a Google).
- **4-5 stelle** → link **Google** (`reviewUrl`).
- Se il link Google **non è configurato**, **tutte** le stelle vanno al feedback privato (nessun vicolo cieco).
- Tolto il bottone grosso, aggiunto testo «tocca le stelle» (`tapToRate`, 5 lingue). La mail ora **parte sempre** (prima usciva solo con `reviewUrl` presente).

### 🆕 Pagina `/feedback` + endpoint `/api/feedback`
- **`src/pages/feedback.astro`**: pagina pubblica **a tema** (usa `temaEmail()` → CSS vars, logo/dati da `datiRistorante()`), **5 lingue** (fr/en/it/nl/es via `?lang=`). Stelle interattive pre-selezionate dalla mail (`?r=`), textarea messaggio, campo contatto **pre-compilato** (email/telefono passati in query), invio via `fetch` → schermata di ringraziamento. `noindex`.
- **`src/pages/api/feedback.ts`** (`POST`, `prerender=false`): valida rating 1-5 + messaggio obbligatorio, chiama `inviaFeedbackCliente`.
- **`inviaFeedbackCliente`** (nuovo, esportato in `notifications.ts`): compone una mail a tema (lingua admin, `FB_TXT` 5 lingue) con stelle, messaggio, contatti (mailto/tel), CTA «Rispondi al cliente» (`replyTo` = email cliente), e la manda alla **lista email ordini** (`kitchenEmail()`), from `ordineFromEmail()`, bcc `BCC`.

### 📱 Email responsive
`avvolgiTema` ora inietta una **media query** (`max-width:600px`) e classi hook **`em-card` / `em-pad` / `em-big`** applicate alle celle chiave di tutte le mail a tema (cliente, modifica, cucina, recensione, feedback): su mobile la card va full-width, i padding laterali si riducono, i numeri grandi rimpiccioliscono. Aggiunti anche selettori d'attributo di riserva sui padding inline (40px/44px) per le celle senza classe.

### Note / verifica
- `tsc --noEmit` **pulito** (0 errori) su tutti i file toccati. `astro check` non gira in questo ambiente (i binari nativi di `node_modules`/rollup sono per macOS, non per la VM Linux del ponte) → verificare la pagina in dev locale.
- Preview locale: `http://localhost:4321/feedback?r=2&o=TEST123&name=Enzo&lang=it` (riavviare il dev server: file nuovi).
- Env recensioni Google (invariata): `reviewUrl`/link Google configurato lato `app_config`; senza, il gating manda tutto al feedback privato.

## 📌 17/08/2026 — sessione Cowork (Mac mini)

Due grandi filoni: **modifica ordine con differenza d'importo** (link supplemento / rimborso) e la **trasformazione di demo01 in un vero sito one-page** collegato al motore.

### 💶 Modifica ordine → differenza d'importo (mail + link/rimborso)
Quando si modifica un ordine **pagato online** (sito o payment link) e il totale cambia, il motore gestisce la differenza. Se il totale **aumenta**: mail di modifica con **link di pagamento del supplemento**; l'ordine **resta confermato** e si **traccia** l'incasso del supplemento via webhook + colonna DB. Se **diminuisce** (articolo tolto): niente mail-con-link ma un **bottone «Rembourser la différence»** sulla card (1 clic + conferma). Ordini pagati **in cassa** (cash/card): **solo mail di modifica**, nessun link/rimborso.
- **Migrazione #50** (`orders_modifica_diff.sql`): `supplement_due_cents` / `supplement_paid_at` / `refund_due_cents` su `orders` (idempotente). ⚠️ **Da lanciare sul Supabase** prima che la feature funzioni; il PUT ha una **guardia** (`migMancante`) che rifiuta con errore chiaro se la #50 non c'è e la differenza ≠ 0. Il GET ha un **fallback** che rilegge senza le colonne #50 se non esistono ancora (nessun crash sulla pagina Commandes).
- **Netting multi-modifica** (`api/admin/orders.ts` PUT): saldo firmato `balance = suppDue − refDue + delta` → `newSupp = max(0,balance)`, `newRef = max(0,−balance)`. Così più modifiche successive si compensano invece di accumulare link/rimborsi doppi. `paidOnline = status==="paid" && !inPersona` (dove `inPersona` = `payment_method` cash/card): scelto sul **metodo di pagamento**, non sulla presenza di una sessione `cs_` (una demo pagata senza vera sessione Stripe non mostrava il bottone rimborso → corretto). Accetta lo **slot invariato** anche se ora è passato (`slotInvariato` salta il check disponibilità).
- **Nuova mail di modifica** (`notifications.ts`): `inviaModificaOrdine` → `emailModificaCliente` (nuovo `TXT_MOD`, 5 lingue), **distinta** dalla conferma. Blocco ambra col **bottone paga-supplemento** se aumenta, nota verde «rimborso in arrivo» se diminuisce. + email cucina + Slack.
- **Stripe**: `creaCheckoutSupplemento({orderId,diffCents,…})` con `metadata.supplement:"1"`; nel **webhook** `checkout.session.completed`, se `metadata.supplement==="1"` → `supplement_due_cents:0` + `supplement_paid_at:now` (traccia l'incasso, non ricrea l'ordine).
- **Rimborso differenza** (`api/admin/refund.ts`): modo `difference` — usa `refund_due_cents` come tetto (non il residuo totale) e lo scala dopo il rimborso parziale.
- **Card Commandes** (`orders.astro`): bottone **Terminée pieno** + **matita** (edit) + **cestino** con conferma 2 tap («Annuler ?»). Modale edit (`apriNcEdit`/`salvaModifiche`/`ncCaricaMenu`) con **slot originale pre-selezionato e modificabile** (anche se passato). Tag `tag-suppdue` (Diff. à payer) / `tag-supppaid` (Diff. payée ✓); bottone `diffRefundBtn` (1 clic + conferma). i18n admin (FR) esteso.
- **Aura ritardo**: glow pulsante dietro la card se l'orario di ritiro è passato — **bianco a +5 min, arancione a +10, rosso a +15** (keyframes `ncAura1/2/3`, opacità poi ridotta su richiesta «leggermente meno forti»); ticker `aggiornaAure` ogni 30s, `ncLivelloRitardo` calcola il livello.
- **Nav island** (`AdminNav.astro`): sfondo isola = **sfondo header** (`var(--c-header, var(--c-bg))`) invece di `var(--c-card)`.

### 🌐 demo01 → vero sito one-page collegato al motore
demo01 trasformato da vetrina RestoHub a **sito reale del ristorante**, mantenendo il **design Bella Napoli** (scuro/rosso) ma con **testi neutri** (nessun riferimento a luogo o tipo di cucina). Modello: **tanti siti demo** su una sola installazione condividono **gli stessi dati del motore**; quello che si cambia nel motore impatta tutte le demo. Ordine **tutto dentro il demo** (menu/coupon/checkout reali, niente redirect).
- **3 endpoint pubblici nuovi**: `/api/menu` (`getMenuOrderable`), `/api/hours` (aperto/chiuso + prossima apertura + settimana Lun-Dom da `configGiornoEffettiva`), `/api/reviews` (Google Places API New, filtra 5★, ultime 3, cache 30min; usa `GOOGLE_PLACES_API_KEY` + `google_place_id`).
- **Immagini dal motore**: nuovi slot in `siteImageSlots.ts` (hero_1/2/3, story, gallery_1..10, ambiance_hero, menu_hero) editabili da Assets → Site; `demo01/index.ts` inietta i token nell'HTML raw + info ristorante (`datiRistorante`) + embed Google Maps dall'indirizzo.
- **Header** 1440px, **6 link** (Accueil, Le restaurant, La carte, Les menus, L'ambiance, Réserver) in **3 lingue**, più alto, con **carrello** a sinistra di Réserver; **scroll-spy** (link attivo sulla sezione visibile).
- **Hero**: carousel di 3 immagini (cambiabili nel motore), centrato, neutro; nel blocco meta **solo l'info Google**; **isoletta orari** al posto di «DÉCOUVRIR» (aperto/chiuso + prossima apertura) con **linea rossa animata** che invita a scrollare.
- **Sezioni**: padding verticale **doppio**. **Accueil** = testo + foto dal motore + **4 punti forti con icone, senza riquadri**, testi più lunghi. **Le restaurant** = testo rapido + **gallery 10 immagini** (lightbox) + **banner sfumato** sotto (mask-image, cover). **La carte** = testo generale, **niente riquadri** sugli articoli, emoji/immagine piatto nascosta se assente. **Les menus** (al posto del mock dashboard RestoHub) = **immagine di sfondo** + **2 riquadri vuoti** placeholder per i menu futuri. **Infos & réservation** = info pratiche (indirizzo, pagamenti, orari, terrazza), **ultime 3 recensioni Google 5★**, widget prenotazione, e **Google Maps a tutta larghezza** sotto.

### 🔔 Pop-up demo01 → collegato al motore (Marketing → Pop-up)
Il **pop-up finto** hardcoded (cartellino d'angolo con codice `BIENVENUE10` di prova) sostituito col **vero pop-up** gestito in admin. Grafica del cartellino d'angolo **invariata** (scelta di Enzo), contenuto reale.
- **Nuovo endpoint pubblico** `/api/popup?page=home&lang=fr|en` → `popupPerPagina(slug,lang)` (stessa logica di `SitePopup.astro`: pop-up attivo ADESSO per la pagina, scheduling always/dates/weekly, più recente vince, appare solo se la lingua esiste). Cache 60s.
- **`_page.html`**: cartellino riempito da `fillPopup()` (titolo, testo, CTA `btn1`); la CTA `#reserver` apre il modale prenotazioni, altrimenti è un link. `maybeShowPopup()` applica **`max_shows` via localStorage** (`rh-pop-<id>`), come il motore. `caricaPopup()` è richiamato in `applyLang()` → si aggiorna al cambio lingua (FR/IT→fr, EN→en). Tolti il `setTimeout` finto e la copia-codice; badge neutro «À la une / In evidenza / Featured».
- Aprendo la prenotazione il cartellino si chiude. Nessun pop-up attivo (o lingua non configurata) → resta nascosto.
- Nota: il cartellino **non mostra l'immagine** del pop-up (spazio ridotto, attivabile); la sezione coupon cita ancora `BIENVENUE10`, ma è il **coupon**, non il pop-up.

### Da fare / aperti
- ✅ **Migrazione #50** lanciata sul Supabase (fatto) → modifica-con-differenza operativa.
- **Env** consigliata per le recensioni: `GOOGLE_PLACES_API_KEY` + `google_place_id` in `app_config`.
- Ripulire i residui pubblicitari RestoHub in demo01 (FEATURES, CTA finale, footer «propulsée par RestoHub»); decidere nome brand neutro al posto di «Bella Napoli» (o renderlo editabile nel motore); collegare i 2 placeholder menu quando pronti; rendere editabili metodi di pagamento / servizi «Sur place».

## 📌 15/08/2026 — sessione Cowork (Mac mini)

Sessione lunga: 2 fix UI, una diagnosi di lentezza, l'anti-flash del tema in SSR e la nuova feature **Lingue pubbliche** (regola super + email tradotte + collegamento modale ordine).

### 🐛 Foto login sparite sotto il velo verde
- Causa: `login.astro` usava `SLIDE_FALLBACKS = /slideshow/slide-0N.webp` (roba vetrina La Molisana, **inesistente nel motore**) appena il `restaurant_name` era impostato → 404 → solo gradiente + `#14100c`. Il ramo buono (`FALLBACK_COVERS = /restohub/slide01..04.webp`) scattava solo col nome vuoto.
- Fix: rimosso `SLIDE_FALLBACKS`, `heroImages = heroCfg` → senza `site_hero_*` si usano sempre le slide RestoHub (che esistono). Nota: `siteImageSlots.ts` punta ancora a `/slideshow/` per i fallback (per-cliente, non toccato).

### 🔴 Clienti bloccati — barra rossa
- `clients.astro`: riga con `box-shadow: inset 3px 0 0 #ed1c24` quando `c.blocked` (classe `.is-blocked`). Scelto **inset** e non `border-left` perché la riga è CSS grid con padding fisso: un bordo vero avrebbe disallineato le colonne solo sulle righe bloccate. Il toggle blocco già chiama `render()`, quindi compare/sparisce subito. Distinto dalla pillola no-show (`tag-ns`).

### 🐌 Lentezza "tutto lento + settings di default prima dei salvati"
- Misurato con curl: `connect 0.19s` (= ping Dubai↔Francoforte), `ttfb−connect ~0.6-0.8s`. La **2ª/3ª query su connessione riusata** = ~0.6s. `/admin/clients` dev: 1ª richiesta 1.8s, poi 2ms (cache 60s calda). **Il dev server è innocente**: il collo di bottiglia è la **distanza dal Supabase dev di Francoforte** (Enzo lavora da Dubai). Il codice SSR è già a posto (`Promise.all`, cache 60s). In produzione (Hostinger EU, vicino a Francoforte) il problema non si vede. Rimedio se resta a Dubai: Supabase dev su **Mumbai (ap-south-1)**, ~30-40ms invece di 190 (il dev è usa-e-getta, i clienti restano in UE). Supabase non ha regioni Medio Oriente.

### ✨ Anti-flash del tema in SSR (`AdminHead` + `adminBoot`)
- Problema: lo script che leggeva la cache `mdd_theme` era dentro `AdminNav`, **centinaia di righe dentro il `<body>`** → il browser dipingeva i `:root` di default (arancione MOODD) e poi, tardi, i colori veri. Peggio al primo accesso/incognito (nessuna cache): aspettava `getSession()` + `fetch /api/admin/pages`.
- Fix: nuovo `src/lib/admin/adminBoot.ts` — legge lingua admin + tema + favicon in **UNA query** su `app_config` (cache 60s, condivisa con `adminLang()`, che ora è una vista su boot). Nuovo componente `src/components/admin/AdminHead.astro` (in fondo al `<head>` di tutte le 10 pagine admin) stampa `<style is:inline>html{--c-*}</style>` + micro-script per glass/theme-color/favicon, **lato server, prima del primo paint**. `AdminHeader` rende il logo brand server-side. Tolto il blocco tema/logo dallo script di `AdminNav` (era anche dannoso: la cache localStorage poteva riscrivere i colori vecchi sopra quelli veri). `is:inline` sul `<style>` è **obbligatorio** (senza, Astro lo estrae e sposta perdendo la cascata); mira `html` non `:root` (stessa specificità ma più in basso → vince).
- Effetto collaterale: lingua/tema/favicon erano 3 letture separate, ora 1 sola → meno query per pagina.

### 🌍 LINGUE PUBBLICHE — nuova feature (3 step)
Regola per le lingue con cui il ristorante comunica coi clienti, decisa dal super admin, distinta dalla lingua dell'admin (gestore) e dal widget prenotazioni (che resta **indipendente**, 9 lingue, per scelta di Enzo). Set = stesse 5 dell'admin: **FR/EN/IT/NL/ES**.
- **Step 1 — regola nel super** (`super.astro`, tab Impostazioni): spostata qui la **lingua admin** (era in Design); sotto, sezione **Lingue pubbliche** in griglia (`repeat(auto-fill,minmax(240px,1fr))`), ogni lingua con switch attiva/inattiva + stella ★ predefinita (☆ per le altre). Regole: ≥1 attiva, la predefinita non si spegne. Storage `app_config`: `public_languages` (array JSON) + `public_lang_default`. **Niente migrazione** (come `custom_events`). Costanti + `normalizzaLinguePubbliche()` in `superAdmin.ts`; API in `pages.ts` (GET/PUT, super-only). Default storico = FR+EN, predefinita FR.
- **Step 2 — traduzioni** (`notifications.ts` + `reservationI18n.ts`): email **ordine** (conferma, link pagamento, recensione) portate da FR/EN a 5 lingue con `pick5(dict, lang)` (fallback FR); email **prenotazione** + widget: aggiunto **NL** ovunque (mancava del tutto, nemmeno le résa ce l'avevano). Aggiunto `nl` al tipo `LinguaWidget` (→ 10 lingue lato résa/widget: fr/en/es/it/nl/de/ru/ar/zh/ja). `CLIENT.firma` aveva solo fr/en → helper `firma()` con fallback FR + aggiunte IT/NL/ES alla firma default del motore. Email **bons cadeaux** ancora FR-only (fuori scope, segnalata).
- **Step 3 — collegamento modale ordine** (`orders.astro`): pillole "Lingua dell'email" renderizzate **SSR** dalle lingue attive (solo attive, predefinita pre-selezionata), non più FR/EN fisse. `caricaBootAdmin` esteso per leggere anche le lingue pubbliche (stessa query, 0 round-trip in più). `ncLang` ora `string`, default dalla regola (`data-default`). Il PUT invalida `CACHE_ADMIN_BOOT` anche al cambio lingue pubbliche.

### Lezioni
- **`astro check` è l'UNICA verifica valida sui cambi di tipo**: esbuild strippa i tipi e non vede una chiave mancante in un `Record<Union>`. Un mio script python andato in **crash a metà** (prima del `write` finale) non ha salvato l'edit del tipo `LinguaWidget` + `LINGUE_WIDGET`, mentre i batch successivi (che rileggevano il file originale) hanno salvato il resto → 28 errori tutti a cascata da "`nl` non esiste in `LinguaWidget`". Regola: dopo ogni edit di tipo, il check di Enzo è d'obbligo; e uno script che tocca più cose deve scrivere presto o essere idempotente.
- **Distanza DB ≠ problema di codice**: misurare `connect`/`ttfb` con curl su connessione riusata prima di ottimizzare query. 0.6s/query da Dubai è fisica, non un bug.
- **Anti-flash = SSR nel `<head>`, non script nel `<body>`**: qualunque cosa serva prima del primo paint va renderizzata dal server; la cache localStorage nel body arriva sempre dopo il paint su pagine grandi.
- **Una sola fonte di verità** per la normalizzazione della regola (`normalizzaLinguePubbliche`), usata da API e boot: evita che UI e backend divergano.


## 📌 14/08/2026 — sessione Cowork (Mac → Mac mini)

Sessione su **pagina Clients** + fix orari + i18n servizi. Lavoro iniziato su un Mac e continuato sul **Mac mini** (repo clonato in `~/Developer/restohub`, `.env` copiato dal vecchio Mac, `npm install`).

### 🕛 Orari oltre la mezzanotte (apertura take-away)
- Bug: fascia serale `18:00 → 00:00` (o `→ 01:00`) rifiutata al salvataggio (« Heures Soir invalides »). Regola adottata: se **chiusura ≤ apertura** la fascia **scavalca la mezzanotte** → chiusura = giorno dopo (`00:00` = mezzanotte fine giornata).
- Fix in TRE punti coerenti: `src/pages/api/admin/settings.ts` (`fasciaValida`: minuti, `+1440` se close≤open, span 0–24h) · `src/lib/slots.ts` (`calcolaSlot`: `if (chiusura <= apertura) chiusura = chiusura.plus({ days: 1 })`) · `src/pages/api/admin/special-days.ts` (stessa `fasciaValida`).
- **Scelta**: le **finestre di servizio delle prenotazioni** (widget, `reservation_services` from/to) restano SOLO diurne — overnight NON implementato lì (toccherebbe validazione + disponibilità + attribuzione della data dopo mezzanotte). Rimandato.

### 🌐 Nomi servizi nella lingua admin
- Erano fissi in FR (`SERVIZI_WIDGET[k].fr`). Nuova funzione **`nomeServizio(key, lang)`** in `src/lib/reservationI18n.ts` (fallback fr → key). Usata in `settings.astro` (dropdown servizi + pillole giorni speciali), `reservations.astro` (filtri, chiusure, dettaglio), `index.astro` (chiusure permanenti). Il **matching legacy resta su `.fr`** (chiave tecnica, non toccato).
- Manca **`nl`** nel dizionario servizi → fallback FR. `dailyBrief.ts` ha i servizi ancora in FR (non toccato).

### 🔤 Etichetta Google
- « Google — avis » ora segue la lingua admin (« Google — recensioni » in IT) in `settings.astro` (Liens), riusando la chiave `itg.g.reviews`.

### 👤 Modale cliente (pagina Clients) — statistiche + storico + toggle
- Click su un cliente → modale a **due colonne** (sx: info + statistiche · dx: storico), largo 900px, `max-height: 88vh` con **scroll interno** per colonna; responsive < 720px impila.
- **Statistiche** in schede sezionate: **Ordini** (numero, totale speso, scontrino medio) + **Prenotazioni** (totale, annullamenti, no-show, persone media, tempo a tavola, anticipo, spesa media). Base già nell'oggetto Client; le prenotazioni riusano `GET /api/admin/reservations?client_stats=1&client_email=&client_phone=` (stesse metriche del modale prenotazione).
- **Storico** cronologico ordini+prenotazioni via `GET /api/admin/clients?activity=<key>`.
- **Contatti** email/telefono **cliccabili** (mailto:/tel:) con icone.
- **Toggle (switch)** Newsletter (ON = iscritto) e Blocco prenotazioni (ON = consentito), **sopra** le statistiche. Salvataggio **immediato** via `PATCH /api/admin/clients`. Gli **stessi switch** anche nel modale modifica (matita), lì col tasto **Salva**.
- Chiavi i18n nuove: `cli.stOrders`, `cli.stSpent`, `cli.avgBasket`, `cli.blockedShort`, `cli.allowedShort`.
- File toccati: `src/pages/admin/clients.astro`, `src/i18n/admin.ts`, `src/lib/reservationI18n.ts`.

### 🧪 Dati demo (script SQL SEPARATO — NON nel repo)
- 10 clienti demo (profili vari: VIP, no-show, solo asporto, gruppi, nuovo…) + **menù finto** (8 categorie / 35 piatti) + **28 ordini** (articoli reali; `pickup_time` nell'ultima settimana → visibili in pagina Ordini) + **30 prenotazioni**. Indirizzi `@demo.rh`, **idempotente** (pulizia in cima). Da lanciare nel SQL Editor del Supabase demo.

### Lezioni
- Il modale cliente esisteva già con lo storico; mancavano solo le statistiche → **riusare l'endpoint prenotazioni** invece di scrivere nuovo codice server.
- Le modifiche di **codice** richiedono **rebuild + redeploy** per vedersi online (i dati SQL sono immediati): un utente che « non vede » una feature nuova quasi sempre non ha ridistribuito / non ha fatto hard refresh.

## 📌 30/07/2026 — sessione Cowork

### 🏠 Accueil — semplificazione & drag fluido su touch
- **Modale « Tuiles »** (nuovo FAB a strati, visibile anche su mobile a differenza di Organiser): switch per mostrare/nascondere ogni isola. Flag `hidden` DENTRO il layout personale già salvato (`home_layout:<userId>`) → **nessuna migrazione**. Isole non disponibili (es. Google senza Place ID) non compaiono nella lista.
- **Drag riscritto con Pointer Events** (prima HTML5 drag&drop = morto su iPad/iPhone). Regola d'oro trovata a caro prezzo: **spostare nel DOM la tile trascinata annulla il pointer capture** → `pointercancel` e drag rotto dopo il primo scambio. Soluzione: la tile esce dal flusso (`position:fixed`, segue il dito), nella griglia si muove un **segnaposto tratteggiato**; alla fine la tile prende il posto del segnaposto. Animazione **FLIP** sulle altre isole + **auto-scroll** ai bordi + hit-test geometrico (niente `elementFromPoint`, la tile fixed coprirebbe le altre).
- **Spaziatura masonry**: righe da 10px + gap 12px lasciavano fino a 21px di vuoto sotto (arrotondamento a righe intere). Ora righe da **2px**, gap verticale 0, spazio dal `margin-bottom` della tile → verticale = orizzontale = 12px.
- Bug: `home-layout.ts` non aveva `google` tra le TILE_KEYS → la posizione della tile Google non si salvava mai. Aggiunte `google` e `visibilite`.

### ⭐ Recensioni Google — più recenti e per intero
- Places API **(New) NON ordina le recensioni** e ne dà max 5 « pertinenti ». Fallback su Places API **(Legacy)** con `reviews_sort=newest` in `google-info.ts` (prova Legacy → se il progetto non l'ha, ordina per data quelle della New API). **Serve attivare « Places API » legacy + aggiungerla nelle restrizioni della chiave.**
- Testo recensione: da 300 a **1500** caratteri (intero); tolto il taglio a 190 nella UI. Carosello: **12s** (era 7) e font citazione 1rem.

### 🔎 Search Console — livello « Visibilité » (service account, NO OAuth)
- Scelto **service account** (non OAuth) per non disturbare la verifica di Google Business in corso e per accendere subito senza schermata di consenso. `src/lib/searchConsole.ts`: **JWT RS256 firmato con `node:crypto`** → access token (cache 55 min, i fallimenti NON in cache). Chiave = **una env MOODD** `GOOGLE_SA_KEY_B64` (base64 del JSON del service account; email robot `moodd-search@moodd-admin.iam.gserviceaccount.com` da aggiungere come utente nella Search Console di OGNI cliente). Sito per-cliente in `app_config.gsc_site` (`sc-domain:…` o URL).
- **Endpoint** `/api/admin/search-console` (semplice per la tile; `?detail=1&days=N` per la pagina). Cache 3h, errori mai in cache.
- **Tile « Visibilité »** in Accueil (clic/impression 28g + tendenza + top requêtes). **Tab Google** in Statistiques: 4 KPI con variazione (posizione invertita: scendere = verde), selettore 7/28/90/180/365, **2 grafici SVG a linea SEPARATI** (clic + impressioni; dataviz vieta il doppio asse → small multiples) con crosshair+tooltip, tabelle top requêtes/pages a colonne fisse. Scheda Search Console nel tab Integrations (mostra l'email robot + campo propriété + Vérifier).

### 📊 Sources de trafic — analytics interno cookieless
- « Da dove arrivano » NON è Search Console (solo ricerca Google). Costruito analytics **first-party**: beacon `sendBeacon` nel Layout pubblico (solo sugli **ingressi**: se `referrer.host === location.host` → navigazione interna, ignora), `/api/track` classifica lato server (Google/Facebook/Instagram/TikTok/X/Direct/Newsletter/Altro da referrer o `utm_source`), filtra i bot. **Nessun cookie, nessuna IP → nessun banner**. `/api/admin/traffic?days=N` aggrega via RPC `traffic_sources` (evita il tetto 1000 righe). Sezione « Sources de trafic » a barre nel tab Google.

### 🔔 Prenotazioni — rappel cliente ~3h prima
- Email di **solo promemoria al CLIENTE** (niente bottoni modifica/annulla), 9 lingue, `emailRappelResa` (riusa `guscioResa` con ctaHtml vuoto). Inviata **solo se prenotata per un giorno FUTURO** (giorno résa > giorno di creazione), non il giorno stesso.
- Approccio **cron** (non Resend `scheduledAt`): `src/lib/rappelReservations.ts` legge sempre lo stato AGGIORNATO → una résa annullata/modificata non manda nulla di falso, e copre oltre i 30gg di Resend. Endpoint `/api/cron/reservation-reminders` (CRON_SECRET, `?force=1` per test). PUT di `reservation.ts` azzera `reminder_sent_at` → modifica ri-arma il promemoria. Attivazione via **pg_cron nel Supabase del CLIENTE** (`resa-reminders-30min`, minuti 20,50), come daily-brief/newsletter — MAI cron-job.org. SETUP.md aggiornato.

### Lezioni
- **Pointer capture**: mutare il DOM dell'elemento catturato rompe il drag → usare un segnaposto, tenere fisso l'elemento trascinato.
- **Dual-axis vietato** (dataviz): due misure di scala diversa → grafici separati (small multiples), non due assi Y.
- **Analytics cookieless**: beacon solo sugli ingressi esterni/diretti; classificazione lato server; `utm_source` è l'unica fonte precisa (Instagram spesso non passa il referrer).
- **Cron = roba del CLIENTE**: il progetto motore (dev) non ha pg_cron né sito pubblico → `schema "cron" does not exist` è normale lì; i cron vanno nel Supabase del cliente dopo il deploy.
- **Cache**: non mettere MAI in cache errori o token vuoti (bloccherebbero i retry per ore).
- **Filtro UI**: lo stato iniziale `.is-active` deve combaciare con la variabile JS di default, altrimenti il guard « già attivo » blocca il primo clic (bug filtro 28j).
- Places API **New** non ordina/pagina le recensioni: per « le più recenti » serve la Legacy.

## 📌 28/07/2026 — sessione Cowork

### 🎁 BONS CADEAUX — tab Marketing completo (commit `461f593`, migrazione #45)

Buoni regalo = **valore PREPAGATO con saldo scalabile** (≠ coupons, che sono sconti). Nuovo tab **Marketing → Bons cadeaux**, stessa impalcatura dei Coupons.

- **Creazione = form MULTI-STEP a 4 tappe** (stepper in alto, Précédent a sinistra / Suivant a destra, Suivant disabilitato finché manca la valeur): 1) **Bon** — valeur a pillole preset 25/50/75/100/150/200 + « Autre » · expiration a preset Aucune/1 mois/6 mois/1 an/Fin d'année/« Autre » col **datepicker custom** del brand (z-index 320 > overlay 300) · code (vuoto = auto) · **Paiement** Espèces/Carte/Lien de paiement · 2) **Offert par** prénom, nom, email, tél · 3) **Destinataire** stessi campi + **message (textarea)** + **switch « Envoi postal »** che apre adresse/CP/ville/pays + **frais d'envoi** · 4) **Récap** con tutti i dati + 2 pulsanti **« ✉ Au destinataire » / « ✉ À l'offrant »** (spenti se manca l'email; con *lien de paiement* l'offrant è **selezionato di default**, è lì che sta il bottone Payer).
- **Telefoni**: select prefisso (riusa `src/lib/prefissi.ts` + `CLIENT.paese`, default BE +32) → salvati in formato internazionale (`separaPrefisso` riconosce i numeri già prefissati; lo 0 iniziale cade).
- **Codice auto** = **5 iniziali del nome ristorante** (da Réglages → Général, fallback client.ts) + 2 blocchi random senza caratteri ambigui: « La Molisana » → `LAMOL-U65B-8JT5`.
- **Pagamento**: Espèces/Carte → `paid=true` subito. **Lien de paiement** → `paid=false` + **Stripe Checkout** (`creaCheckoutBon` in stripe.ts, metadata `gift_card_id`, riga extra per i frais d'envoi) e bottone **« Payer maintenant »** nell'email all'offrant. Il **webhook Stripe** intercetta `metadata.gift_card_id` → `paid=true`. Se Stripe non è configurato: toast rosso con l'errore vero + fallback « Paiement en attente » nell'email (niente fallimenti silenziosi).
- **Card**: codice · **valore restante/totale in grande arancione** (non più pillola) · righe « Pour X » / « De la part de Y » / « Expire le » / « Utilisé N fois » (conteggio dal ledger) · pastiglia rotonda in alto a destra **✓ verde = payé** / **⏸ grigia = en attente** (card attenuata e « Utiliser » nascosto finché non è pagata) · azioni: Utiliser · switch Actif · **matita** (edit) e **cestino** appaiati a destra, cancellazione **a 2 tap** (« Confirmer ? », 3s).
- **Modifica** (matita): riapre il multi-step **precompilato** (valore→preset o Autre, scadenza, telefoni splittati col prefisso, spedizione…). Regole: la **valeur si cambia solo se il buono è intatto** (nessun riscatto → 409); il **metodo di pagamento solo se non pagato** (caso reale: « avevo mandato il link, ha pagato in cassa » → passi a Espèces e si attiva); codice modificabile con check di unicità. In edit compare **« ↻ Renvoyer le lien de paiement »** (solo se lien + non pagato): **crea una sessione Stripe NUOVA** (le vecchie scadono) e rispedisce subito l'email all'offrant.
- **Riscatto**: « Utiliser » in sala (importo → scala `balance_cents` con **optimistic lock** su `.eq("balance_cents", letto)`, riga nel ledger `gift_card_redemptions` kind=manual). Uso ONLINE al checkout = **Step B, non ancora fatto** (colonne `gift_card_*` su orders già pronte).
- **Email del buono** (`emailBonCadeau` in notifications.ts, template scuro): codice in riquadro tratteggiato oro + valore, messaggio in citazione firmato dall'offrant, scadenza, indirizzo/frais se spedizione. Al **destinataire** → bottone **« Télécharger le PDF »**; all'**offrant** → « Payer maintenant » (o « Paiement en attente »).
- **PDF pubblico**: `src/pages/api/bon-pdf.ts` con **`pdf-lib`** (nuova dipendenza), A4, protetto dal `pay_token` (uuid) e **rifiutato se il buono non è pagato** (402). Font standard → helper `pulisci()` per i caratteri fuori WinAnsi.
- **Migrazione #45** `gift_cards.sql`: `gift_cards` (code/code_norm, initial/balance_cents, active, expires_at, source admin|purchase, recipient_*, sender_*, message, ship_* + shipping_cents, payment_method, paid, paid_at, **pay_token**, buyer_email/stripe_session_id per la fase acquisto online) + `gift_card_redemptions` (ledger) + colonne `gift_card_*` su orders. Tutta idempotente: durante la sessione è stata **estesa 4 volte** e rilanciata senza danni.

### ✉️ Prenotazioni — buchi email chiusi

Quando è il CLIENTE ad agire dal suo link, il ristorante riceveva solo la push. Aggiunte due email (stesso indirizzo `reservation_notify_email`): **`emailNotificaAnnulloResa`** (tema rosso, « Annulée par le client ») nel DELETE e **`emailNotificaModificaResa`** (tema blu, coi dati aggiornati) nel PUT di `reservation.ts`. Ora il ristoratore è avvisato per email in tutti i casi: nuova (oro) · modifica (blu) · annullo (rosso).

**Da fare sui buoni**: Step B (uso online al checkout) · acquisto del buono dal cliente sul sito (fase C, schema già pronto) · eventuale rinvio email del bon dalla card.

## 📌 27/07/2026 — sessione Cowork

Due migliorie alle PRENOTAZIONI, costruite e pushate nel motore.

- **Allerta chiusura GIORNO (Jours spéciaux "Fermé")**: creando un giorno chiuso (Réglages → Horaire → Jours spéciaux), se ci sono prenotazioni confermate su quelle date si apre un modale **Garder / Annuler + prévenir**. "Annuler" → status `cancelled` + email "locale fermé" al cliente (9 lingue) + stop dell'email-recensione. File: nuova `emailChiusuraResa` + testi `ferm*` in `notifications.ts`; endpoint `/api/admin/special-days-impact` (GET impatto · POST annulla+email); modale in `settings.astro` (handler `spAddBtn`). Solo giorni `closed` (non `open`), solo prenotazioni `confirmed`.
- **Gestione chiusura SEZIONE (Fermeture exceptionnelle)**: chiudendo una section per un giorno (modale Sections in Réservations, funzione `znSalva` con reason='closed'), se ci sono prenotazioni si apre un modale per gestirle una per una: **Déplacer** in un'altra section (auto-riassegnazione tavolo via `assegnaTavoli` se plan mode, altrimenti "à placer") · **Annuler + email** (riusa `emailChiusuraResa`) · **Recontacter** (flag `recontact`). Contatori di capienza per section, rossi in overflow ma **NON bloccanti** (caso pioggia: far entrare tutti). File: migrazione **#43** `reservations_recontact.sql` + colonna `recontact`, pillola accent "À recontacter" in lista; endpoint `/api/admin/zone-closure-impact` (GET impatto+capienza · POST move/cancel/recontact); `znGestisciImpatto` in `reservations.astro`. Filosofia: il sistema aiuta e avvisa, l'umano decide, mai annullo automatico.

Note: l'email di chiusura parte solo se Resend è configurato (sul motore/dev è no-op loggato; invio vero sui clienti). La migrazione **#43** va lanciata sul Supabase di ogni cliente al momento del merge (additiva/idempotente).

### 🔔 PUSH ADMIN — Fasi 1-3 COSTRUITE e in PRODUZIONE su La Molisana

Il progetto «PUSH ADMIN» (sezione dedicata più sotto) è realizzato nel motore e già LIVE su La Molisana. Tre fasi:

- **Fase 1 — infrastruttura + attivazione per-dispositivo** (commit `c13f599`): `src/lib/push.ts` (VAPID lazy da env `import.meta.env ?? process.env`; `inviaPush` invia a TUTTE le subscription, ripulisce le morte 404/410, ritorna `{sent,found,errors}`) · `api/admin/push.ts` (POST {subscription} upsert `onConflict:endpoint` · POST {test} · DELETE ?endpoint) · migrazione **#44** `push_subscriptions` · `public/sw.js` (+handler `push` e `notificationclick`, icona/badge `/icon-192.png`) · Réglages → Notifications: riga «Notifications sur cet appareil» con toggle + badge «Activée» + pulsante **Tester**. Chiave: `applicationServerKey` vuole `BufferSource` su ArrayBuffer → `b64ToU8(...) as BufferSource`.
- **Fase 2 — trigger reali** (commit `315351d`): helper centralizzati in push.ts `inviaPushResa("new"|"demande"|"modif"|"annul")` e `inviaPushOrdine` (testi FR). Agganci `void` (non bloccanti): `reservation.ts` POST (nuova/demande) · PUT (modifica cliente) · DELETE (annullo cliente) · `stripe-webhook.ts` (commande payée). Tap → `/admin/reservations` o `/admin/orders`.
- **Fase 3 — pallini "non visti" + badge PWA** (commit `17716c3`), **SENZA migrazione** (riusa il poller globale di AdminNav): pallino rosso col numero su **Comm.** e **Résa.** (span `.nav-badge`); conteggio dal server al load (`reservations?new_since` / `orders?recent_paid`); "già visto" per-dispositivo in localStorage (`mdd_resa_seen_at` a tempo, `mdd_cmd_seen_ids` per-ID perché un ordine nasce pending→paid); incremento live sugli eventi `moodd:new-resa`/`moodd:new-order` del poller; azzerato aprendo la sezione. `navigator.setAppBadge(tot)` per l'icona della **PWA installata**.

**La Molisana LIVE**: merge del solo blocco push — dry-run con `git merge-tree` = **0 conflitti, 12 file toccati, nessun file vetrina** (La Molisana non aveva divergenze su quei file) → nessun checkout protettivo → `npm install` (web-push) → astro check 0 → push/deploy Hostinger. Migrazione **#44** sul suo Supabase; chiavi **VAPID nel pannello Hostinger**.

**Decisione VAPID**: **una sola coppia condivisa MOODD** per tutti i clienti (non è legata a Supabase/Stripe, è l'identità push presso i browser); dove si riusa la stessa coppia, **stesso `VAPID_SUBJECT=mailto:admin@moodd.online`** (NON per-cliente). Privata mai in chat (Enzo la genera con `npx web-push generate-vapid-keys`).

**Lezioni push**: Brave blocca FCM di default → errore «Registration failed - push service error» finché non attivi «Use Google services for push messaging» + riavvio. `setAppBadge` funziona SOLO dalla PWA installata, non in scheda browser (fallback = pallino in-app). Su Mac la notifica può non comparire come banner se il permesso di sistema per il browser è off / Non disturbare (guardare il Centro Notifiche). Merge di feature del **MOTORE** (non vetrina) = pulito, nessun merge selettivo; il pericolo del checkout protettivo resta solo quando il motore tocca file vetrina/brand.

Resta la **Fase 4** (non fatta): composer di messaggi MOODD ai ristoratori in Réglages super.

## 📌 25/07/2026 — sessione Cowork

- **La Molisana: merge al motore COMPLETATO.** Portata a `engine/main` a2b6611 (tema per cliente, eventi locali, Stripe pigro, #41-42). Merge SELETTIVO: dopo `merge engine/main` (conflitto solo su astro.config), `git checkout HEAD -- public/ src/config/ src/pages/{index,en/index,links}.astro src/layouts/Layout.astro astro.config.mjs` → il de-brand del template NON ha toccato il sito live (avrebbe cancellato foto/loghi e messo «coming soon»). Migrazioni #41-42 lanciate, tema scuro ri-pinnato in Réglages→Design, cron daily-brief+newsletter attivi. Ora ha remote `engine` e branch `backup-pre-merge`. È indietro di 1 commit (la #4 qui sotto). **Lezione: git NON avvisa per i file toccati solo dal motore → per i clienti serve il merge selettivo.**
- **FEATURE #4 — Immagini sito pubblico → Asset admin: FATTA e pushata** (motore `54a2c71`). Il ristoratore cambia le foto del sito dall'admin. MECCANISMO generico nel motore: `src/lib/siteImages.ts` (legge `app_config` chiavi `site_*`, cache 60s) + `api/admin/site-images.ts` (GET/PUT) + tab **Assets → Site** (`assets.astro`, filtro per pagina, card identiche a Images, **upload diretto nel modale ImagePicker** via «+ Ajouter»). MAPPA per-cliente: `src/config/siteImageSlots.ts` (43 slot La Molisana su 5 pagine: Accueil 22, Ambiance 18, Menu/Contact/Commander). Le vetrina usano `siteImg(IMGS,"chiave",fallback)` → finché non carichi niente, nulla cambia. La mappa è per-cliente (in src/config/, protetta al merge).
- **Obiettivi vicini (decisi oggi)**: 1) immagini→asset ✅ · 2) fondazione WhatsApp (Twilio: avvisi ristoratore + conferme cliente + campagne #6) — l'agente AI ordini #7 NON serve subito · 3) EN v2. Ordine: prima le feature nel motore, poi si (ri)costruiscono i clienti → nascono avanzati e gli update futuri sono merge puliti.
- **EducazioneNapoletana (EN)**: analizzato. Fork troppo vecchio/divergente (niente client.ts/middleware/lib-admin; DB fatto a mano, 4 tabelle; LIVE con dati) → **NIENTE merge**. Piano: **EN v2 = rebuild da zero sul motore**, in parallelo, Supabase nuovo (#1-42), si re-inseriscono solo menu+orari (storico ordini → CSV archivio). Salvare: GA4, SEO, cookie consent. Lasciare: BizPrint (→ futura stampa termica nativa, obiettivo #3). Nota: EN sviluppato su 2 macchine (Mac Mini + MacBook) → `git pull` prima di lavorare, `git push` dopo.

## 🔻 DA RIPRENDERE (priorità)

- **Primo cliente vero con SETUP.md** («presto il nuovo cliente»): repo clone + Supabase nuovo (#1-42 in ordine, o file all-in-one) + bucket + env con CRON_SECRET nuovo + deploy + 2 job pg_cron + Général/permessi/tema.
- **🔔 PUSH ADMIN — ✅ Fasi 1-3 FATTE (27/07), live su La Molisana.** Resta la **Fase 4**: composer messaggi MOODD ai ristoratori (Réglages super).
- **🎁 BONS CADEAUX — Step B**: uso del buono ONLINE al checkout (scala il saldo, Stripe incassa il resto; colonne `gift_card_*` su orders già pronte). Poi **Step C**: acquisto del buono dal cliente sul sito pubblico.
- **🤝 RESTOTEAM — modello deciso** (sezione dedicata): prima la piattaforma col suo sito/API, poi la pagina Recrutement nel motore.
- **🍽️ SERVICE EN SALLE — spec approvate** (sezione dedicata) — `table_sessions` con `location_id` dal giorno uno.
- **🎟️ FIDELITY CARD — idea impostata 08/09/2026** (sezione dedicata): nessuna tessera (il cliente È la carta), bollini o cashback, e il premio esce come **coupon** riusando il sistema esistente. Limite noto: chi paga in cassa non accumula.
- **🏢 MULTI-SEDE — DECISO 08/09/2026** (sezione dedicata): UNA installazione, `location_id` nullable dove NULL = «tutte le sedi», interruttore nel super admin. Caso reale: 450 Gradi, 3 punti. ~~Strada B~~ superata.
- **⬆️ ASTRO 7** su branch dedicato (compiler severo sui tag, `compressHTML: true` esplicito, Node ≥ 22.12).
- **🏗️ Brand step 2**: restano sito pubblico ed email transazionali (admin header/favicon ✅ 24/07).
- **🧹 REFACTOR**: datepicker `.dp-*` in 5 copie (menu, résa, settings, marketing, accueil/eventi) → componente condiviso.
- **⚡ SSR fase 2**: Clients, Menu, Statistiques. · **PLAN fase 3**: mini-piantina, occupazione live, advisory lock. · 404 · tab Menus («bientôt») · lunch sul sito pubblico · istogramma tile Résa con En attente · **CLIENTS.md** (chi è a quale versione) · promemoria contratti in scadenza nel daily brief (meta #40 pronti) · stampante termica (analisi fatta: CloudPRNT/SDP, print_jobs, si aggancia ai round).

## 🏗️ MODELLO MULTI-CLIENTE

- **Fonte della verità = `MOODDVS/MOODD-Admin`** (privato), storia git CONDIVISA coi clienti (MAI «Use this template» di GitHub: storia sganciata = merge impossibili).
- **Nuovo cliente = clone** (mai copia di cartella: si porterebbe .env/node_modules/remote sbagliati) + `remote set-url origin` sul suo repo + `remote add engine` verso il template → **stella**: ogni cliente indipendente che «chiama casa» con `git fetch engine && git merge engine/main` quando Enzo decide. La parentela git non è un legame attivo: permette a git di calcolare le differenze; ogni cliente la eredita dal clone.
- **Aggiornare un cliente**: fetch+merge (conflitti rari, quasi solo client.ts → si tiene la versione cliente) → astro check → test → push → deploy → **lanciare le migrazioni mancanti** di MIGRATIONS.md. Taggare le versioni (`git tag v2.2`), mergiare tag precisi.
- **Nel cliente si toccano SOLO**: `src/config/client.ts`, asset in `public/`, `site` in astro.config, testi legali/vetrina. Tutto il resto dall'admin (app_config).
- **STRATO VETRINA (esempio La Molisana)** — regole in SETUP.md: nel template è **CONGELATO** (mai più toccarlo: una cancellazione si propagherebbe ai clienti col merge); nei repo cliente **cancellabile il giorno uno**. Vetrina = pages menu/ambiance/jobs/contact (+en), components Hero/Story/Molise/Features/PhotoStrip/CtaFinal, i18n. Motore pubblico da tenere: order*, reservation*, links, unsubscribe, privacy/cookies (struttura), Layout, Header/Footer/MobileNav/CookieBanner/ReservationModal/SitePopup.
- **De-brand**: zero «Molisana/Migraf» nei file attivi (Layout da CLIENT, titoli, placeholder, /links, middleware). Residui solo nella vetrina congelata.
- Super admin `admin@moodd.online` hardcoded → Enzo vede tutto su ogni installazione.
- Docs nel repo: **SETUP.md** (checklist nuovo cliente + merge + regole vetrina) · ENGINE.md · supabase/**MIGRATIONS.md** (#1-42, tutte idempotenti).

## 🧪 AMBIENTE DEV

- **Supabase «MOODD-Admin»** (org MOODD-Resto, Frankfurt): SOLO sviluppo motore, mai dati veri. Auto-expose OFF; **niente integrazione GitHub↔Supabase** (migrazioni sempre manuali; un repo serve N database). #1-42 ✅ in un colpo con `moodd_admin_setup_all.sql` (possibile perché idempotenti); 4 bucket (menu/popups/documents/brand); utente `admin@moodd.online` (password dedicata). Piano free: si pausa dopo 1 settimana, si riattiva con un click.
- `.env` dev: Supabase dev, Stripe/Resend VUOTI (il motore parte lo stesso: Stripe pigro), `PUBLIC_SITE_URL=http://localhost:4322`, CRON_SECRET fittizio.
- Dev server: `npm run dev -- --port 4322` (4321 = La Molisana). Riavvio per lib/API/.env/middleware; rebuild per astro.config; 504 → `rm -rf node_modules/.vite`.

## 🎨 TEMA PER-CLIENTE (Réglages → Design) — 24/07

- **8 colori** (accent, hover, fond, cartes, champs/off, lignes, texte secondaire, texte principal) + **effet verre** (switch, default OPACO; `glass:"on"` → trasparenze+blur via `html.glass`; lo stato attivo accent vince con `:not(.active)`) + **ombres** (slider 0-100%, default 15%: tutte le ombre nere → `calc(A * var(--sh, 0.15))`; veli dei modali esclusi). Semantici (verde ok, rossi) FISSI. Anteprima live, salvataggio auto (debounce 500ms), «Revenir aux couleurs MOODD». Réglages a 2 colonne full-width sopra 1080px (Permessi | Design).
- **Storage**: `app_config.admin_theme` JSON — per-cliente, via `/api/admin/pages` (GET a tutti, PUT solo super). Assente/parziale = default.
- **Anti-flash**: AdminNav inline legge cache `mdd_theme` e setta `--c-*` inline su `<html>` (vince sui `:root`) PRIMA del paint + meta theme-color + classe glass + `--sh`; il fetch aggiorna. Login: solo cache (pre-auth). Super: fetch dedicato in background.
- **DEFAULT = brand MOODD**: accent `#ff7300` · hover `#e04f00` · fond/cartes `#ffffff` · champs `#e6e6e6` · lignes `#ebebeb` · secondaire `#a6a6a6` · principal `#666666` · verre opaco · ombre 15%. In TEMA_DEFAULT (superAdmin.ts) + `:root` delle 11 pagine + fallback JS + manifest.
- **Favicon brand nell'header**: `brand_favicon` (Admin → Général) sostituisce logo header (`#ah-logo`, `data-default`) e favicon del tab, ovunque + login; cache `mdd_logo`; API pages GET → `logo`.
- **Icone default del template**: chevron MOODD ricostruito in vettoriale (poligoni, `#ef7622`+`#3f3e42`) → favicon.svg, favicon.ico 16/32/48, icon-192/512 (quadrato bianco arrotondato), apple-touch-180; manifest bianco.

## 🔔 PROGETTO — PUSH ADMIN (PWA) — ✅ FASI 1-3 FATTE 27/07 (live su La Molisana) · resta Fase 4

**Solo lato RISTORATORE e MOODD. Niente push web ai clienti finali (scelta deliberata)** — per loro: WhatsApp via Twilio col numero del ristorante (roadmap).
- Canale: PWA admin installata (iPhone: Safari → Condividi → Aggiungi a Home, iOS ≥ 16.4; Android nativo). Niente App Store (nativa/Capacitor scartate: doppia manutenzione / rischio rifiuto).
- Trigger: nuova prenotazione dal sito · nuovo ordine dal sito · annullo/modifica del cliente · nuova recensione Google · **nuovo messaggio dal form di contatto**. Tap → pagina giusta.
- **Messaggi MOODD**: composer in Réglages (super) per upgrade/manutenzioni/novità ai ristoratori.
- **Badge** col contatore sull'icona (Badging API, `setAppBadge`) = non visti; azzerato alla visualizzazione.
- Tecnica: service worker + VAPID per installazione + tabella `push_subscriptions` (migrazione nuova) + endpoint subscribe/send + lib invio. Test iOS = parte delicata.
- **✅ STATO (27/07)**: Fasi 1-3 realizzate e LIVE su La Molisana (dettaglio nell'entry 27/07, commit `c13f599`/`315351d`/`17716c3`, migrazione #44). Resta solo la **Fase 4** (composer messaggi MOODD ai ristoratori).

## 🤝 PROGETTO — RESTOTEAM (annunci HORECA + candidature) — modello deciso 24/07

- **RestoTeam = HUB con il SUO Supabase** (piattaforma di Enzo, sito in creazione). **MAI condividere il DB** con le installazioni admin (credenziali sparse = rischio; schemi incatenati).
- **Integrazione via API con chiave PER-RISTORANTE**: endpoint tipo `POST /api/offers`, `GET /api/offers/mie`, `GET /api/applications?offer=…`; la chiave identifica il ristorante → ognuno vede solo il suo.
- **Nel motore: pagina «Recrutement»** — pubblica annunci e mostra candidature senza uscire dall'admin.
- **Team → RestoTeam SOLO SU INVITO (GDPR)**: bottone «Inviter sur RestoTeam» → email → è la persona che crea/reclama il profilo. Mai copiare dati dei dipendenti d'ufficio.
- **Flusso inverso**: candidato assunto → un click → membro Team precompilato dal profilo RestoTeam.
- **Ordine**: 1) RestoTeam sito + API machine-first; 2) Recrutement nel motore (integrazione sottile).

## 📌 11/09/2026 — Un guscio solo per tutti i modali

### 🎚️ Un interruttore solo per tutta l'applicazione
- `.switch` era **ridefinito in 6 pagine** (11 blocchi CSS), piu `.tm-sw` sulla Home e `.sp-sw` nel form Giorni speciali: nove disegni leggermente diversi della stessa cosa.
- Ora `src/styles/switch.css`, importato da AdminHead come `modal.css`. Nessun componente `.astro`: la struttura e' tre tag, il valore sta tutto nel CSS.
- **Tre difetti veri, non solo estetica**:
  1. la pallina era posizionata con un `top` fisso (`top: 3px`) invece che con `top: 50%` + `translateY(-50%)` → sembrava storta appena l'altezza cambiava;
  2. lo spento usava `--c-line` / `--c-input`, token che **spariscono** quando il cliente cambia tema. Ora fondo PIENO ricavato dal colore del testo mescolato al fondo, e **niente bordo**: il bordo lo faceva sembrare un campo da compilare;
  3. l'input era `width: 0; height: 0` → cliccava solo la label. Ora copre tutto (`inset: 0`), il tocco prende anche sui bordi.
- **Stato senza checkbox**: dove e' cliccabile la riga intera (i servizi del form Giorni speciali) si mette `is-on` sul `.switch`, che fa quello che fa `input:checked`. Cosi anche quelli non-checkbox usano lo stesso disegno.
- Misura via `--sw-w` / `--sw-h` / `--sw-k`, piu `.switch-sm` per le liste fitte. Mai una classe nuova per ogni taglia.
- ✅ Convertiti: **Home** (tile Tuiles) e **SpecialDaysForm** (servizi). ⏳ Da fare: agenda, google, marketing, menu, settings, super, orders, reservations — una alla volta, togliendo la copia locale.
- Le pagine non convertite non cambiano: la loro copia nel `<style>` scoped vince nella cascata finche' non gliela si toglie.

### 📅 Prenotazioni: la vista Settimana mostra le CARD, non un riassunto
- Prima la settimana era una riga compatta per prenotazione (ora · nome · coperti · zona · stato): si vedeva che c'era qualcuno, non chi.
- Ora usa **la stessa `riga()` della vista giorno**: stessi contatti, stessi stati, stessi bottoni. Una funzione sola, nessuna seconda versione della card da tenere allineata.
- ⚠️ **Le liste sono due**: `rese` (il giorno mostrato) e `reseVista` (i 7/30 giorni). Le azioni cercavano la prenotazione **solo** in `rese` — dalla settimana non l'avrebbero trovata e i bottoni sarebbero stati inerti. Introdotto `trovaResa(id)` che cerca in entrambe: **10 chiamate** `rese.find(...)` sostituite.
- Il gestore dei click e' ora una funzione sola (`gestisciClickLista`) agganciata a **tutt'e due** i contenitori.
- ⚠️ Va agganciata accanto al `semEl` **dichiarato piu sotto**: metterla vicino a quella di `rowsEl` compilava ma esplodeva a runtime (TDZ su un `const`).
- `data-date` ora sta **solo sulla testata del giorno**: cliccando il giorno si va al giorno, cliccando una card si aprono i suoi dettagli. Prima l'aveva anche la riga, quindi ogni click su una prenotazione portava via dalla settimana.
- Dopo un'azione la settimana si ridisegna da sola: `carica()` chiama `caricaVista()` quando la vista attiva non e' il giorno. Senza, restava indietro fino al cambio di vista.
- 🧹 Tolte `.vs-row` e le sue cinque figlie + `VISTA_ST`: non servono piu' a nessuno.

### 📅 Prenotazioni — modali al guscio condiviso + vista Mese allungabile
- Convertiti **Servizi**, **Sezioni** e **Nuova prenotazione**. Interruttori (`.sv-switch`, 3 punti) passati al componente `.switch`.
- **Nuova prenotazione**: deroga voluta come il modale evento di Agenda — le due colonne scorrono separate (a sinistra data/ora/sezione, a destra il cliente). Sotto i 760px si impilano e torna la barra unica.
- ⚠️ **Due inciampi sistematici della conversione**, ora scritti in ENGINE.md:
  1. il controllo «c'e' un modale aperto?» (`.overlay.is-open`) non vedeva i modali nuovi → il refresh automatico ricaricava la lista sotto le mani di chi stava compilando. Ora guarda anche `.md-overlay:not([hidden])`;
  2. gli stili dei campi erano agganciati a `.modal` → nei modali convertiti gli input tornavano al **bianco di sistema**. Otto selettori riscritti in coppia `.modal X, .md-box X`.
- **Vista Mese**: bottone «+15 giorni» in fondo, la finestra si allunga di 15 alla volta. L'etichetta in alto e' passata da «Prossimi 30 giorni» fisso a `Prossimi {n} giorni`. Rientrando si riparte da 30.
- **Mobile**: vista Mese a 2 colonne (7 su 360px sono strisce di 45px), via la testata dei giorni e le celle vuote di allineamento, iniziale del giorno spostata DENTRO la cella.
- ⚠️ Il bottone «Mese» andava a capo non per mancanza di spazio: un `@media (max-width: 760px)` piu' in basso nel file vinceva sulle regole mobile scritte prima e allargava la pillola della data. Risolto alzando la specificita' (`.daybar .d-label`).
- **«Chiudi fino alla riapertura»** compare solo a servizio/sala CHIUSI, come le pillole del motivo — tranne quando la chiusura e' gia permanente, dove resta perche' e' l'unico modo di riaprire.

### 🔎 «I posti liberi sono sbagliati» — non lo erano
- Enzo: con una prenotazione da 4 alle 12:30, il modale diceva 74/74 alle 12:00 **e alle 12:45**, 70/74 solo alle 12:30.
- Estratto il calcolo e **eseguito in Node** con i suoi dati: la formula (sovrapposizione fra la finestra del nuovo tavolo e quelle esistenti) e' corretta e con durata 90 minuti da 70/74 a 12:00, 12:30 **e 12:45**.
- Quei numeri sono esattamente quelli di una **durata d'occupazione di 15 minuti**. Era una impostazione di test lasciata in Réglages.
- ✅ **Aggiunta comunque la FINESTRA accanto al conteggio** (`70 / 74   12:00–13:30`): il numero non e' «i posti liberi adesso» ma «i posti liberi per tutta la durata di questo tavolo», e senza scriverlo sembra sbagliato ogni volta che una prenotazione vicina entra o esce dalla finestra. Rende anche visibile a colpo d'occhio la durata configurata — l'informazione che oggi e' mancata.
- ❌ **NON** si e' passati al conteggio istantaneo, che Enzo aveva proposto: con 74 posti tutti prenotati alle 12:30, alle 12:00 direbbe «74 liberi», si accettano 10 persone che restano fino alle 13:30 e alle 12:30 ci si trova con 84 coperti. Il conteggio sulla finestra non puo' vendere due volte lo stesso posto.

### 🔔 Il toast delle notifiche: corallo, piu' grande, con un alone che pulsa
- **Corallo del brand al posto del degrade' oro**: era l'unico elemento dell'admin di un colore che non esiste da nessun'altra parte. Testo scuro su corallo, la stessa coppia del bottone «Terminée» della card ordine.
- **Piu' largo e piu' alto**: 340 → 600px di minimo, altezza 92 → 112, icona 52 → 62, titolo 1,18 → 1,35rem. Su telefono resta a larghezza piena e scende di un gradino.
- **Lo schermo dietro si scurisce e il velo CHIUDE al click** (deciso da Enzo fra tre opzioni): la notifica e' una cosa da sbrigare, non da ignorare. `.mn-scrim` a z-index 490, sotto al toast (500).
- **8 secondi invece di 5**: il toast e' cliccabile e porta alla pagina; cinque sono pochi per accorgersene, asciugarsi le mani e toccarlo.
- **L'aura pulsa, non gira.** Primo mockup con un alone rotante + un filo bianco che correva sul bordo: Enzo li ha bocciati entrambi e ha ragione — un movimento rotatorio in periferia tira l'occhio VIA dal testo, segui la scintilla invece di leggere il nome. Il battito lo tira VERSO il toast.
- **Due strati, non uno** (uno solo o si vede poco o diventa una macchia): `.mn-aura-glow` sempre acceso che respira, `.mn-aura-wave` che parte dalla sagoma e si spegne allargandosi. E' l'onda a dare il battito: senza, l'alone sembra solo una luce accesa.
- `prefers-reduced-motion`: l'alone resta fermo e l'onda non parte.
- ⚠️ **Struttura cambiata**: `.mn-toast` e' ora il GUSCIO (posizione ed entrata) e `.mn-box` la scatola colorata. Il contenuto va scritto in `tBox`, **non** in `tEl`: scrivendo nel guscio si cancellerebbero alone e onda.
- Apertura e chiusura in un posto solo (`apriToast` / `chiudiToast`): prima ogni notifica si riscriveva il suo `classList.add("show")` e il suo timeout.
- Ombra a opacita' FISSA e non legata a `--sh`: sul tema scuro `--sh` e' ~0 e l'ombra sparirebbe proprio dove serve (stessa scelta gia fatta per il FAB).

### 🪟 La verita' e' il modale d'acquisto di Stampa
- ~30 modali nell'admin, ognuno col suo overlay, la sua scatola, il suo header e i suoi bottoni riscritti a mano. Stessa cosa disegnata trenta volte, quindi trenta volte leggermente diversa.
- Presa per buona la forma del **modale d'acquisto della pagina Stampa**: angoli 16px, header (titolo + ×) col filetto sotto, corpo, footer coi bottoni e filetto sopra.
- **Header e footer fermi per COSTRUZIONE, non con `position: sticky`**: la scatola e' un flex in colonna, loro sono `flex: 0 0 auto`, il corpo e' l'unico con `overflow-y: auto`. Niente z-index da governare e niente filetti che sbavano sugli angoli arrotondati. Il `min-height: 0` sul corpo non e' decorativo: senza, un flex item non scende sotto il suo contenuto e spinge header e footer fuori dalla scatola.
- **Larghezza via `--md-w`**, non una classe nuova per ogni misura: `<Modal width="900px">`.
- **Cosa cambia per formato**: SOLO grandezza del titolo e altezza di header/footer. Tre gradini: desktop 1.5rem, tablet (≤1023) 1.3rem, mobile (≤640) 1.12rem.
- **Due pezzi, non uno**: `src/styles/modal.css` (classi `.md-*`, gia importato da AdminHead su ogni pagina) + `src/components/admin/Modal.astro` (il markup). Chi ha una struttura strana usa le classi senza il componente.
- **Il guscio non porta JS**: la pagina aggancia `[data-md-close]` su sfondo, × e Annulla. Cosi' ogni pagina resta padrona del suo stato (reset dei campi, blocco dello scroll) invece di combattere con un handler condiviso.
- **Niente `!important` sulle `.md-*`**: sono la base, una pagina che deve deviare lo fa col suo `<style>` scoped. Il vecchio blocco `!important` in fondo a `modal.css` resta per i modali non ancora convertiti e si toglie con l'ultimo.
- ✅ Convertito: `print` → modale d'acquisto (**il riferimento**). Tolte 14 righe di CSS locale, restano solo `.omodal-ship` e `.omodal-err` che sono davvero suoi.
- ⏳ Da fare uno alla volta: gli altri ~29. L'anteprima PDF della stessa pagina Stampa ha una forma diversa (header con due bottoni, corpo = iframe a tutta altezza) e va decisa a parte.

### 🏠 Home — i tre modali convertiti
- **Tuiles** (420px) e **Giorni speciali** (520px): conversione pulita. Sparite `.evm-modal`, `.tm-modal`, `.evm-titre`, `.evm-x` — erano il guscio riscritto due volte.
- Il modale Giorni speciali aveva `max-height: 88vh; overflow-y: auto` sulla scatola intera: scorreva **tutto**, titolo compreso. Ora scorre solo il corpo.
- **Note**: e' l'unico corallo dell'admin, e il corallo e' la sua identita' (si legge come un foglietto attaccato al frigo). Deciso con Enzo: **struttura condivisa, colori suoi** → classe `.md-nota` in `modal.css` che ridefinisce SOLO i colori (fondo, filetti, titolo, ×). Il contenuto — textarea avorio, tag marroni, bottone Aggiungi — non si tocca.
- ⚠️ **Una meccanica sola per aprire e chiudere**: il guscio usa l'attributo `hidden`, non `.is-open`. Le pagine convertite passano a `hidden` e agganciano `[data-md-close]` invece di confrontare `e.target === overlay`. Due meccaniche avrebbero significato due modi di sbagliare.
- Da `index.astro` sono sparite anche `.overlay`, `.modal`, `.m-close`: sulla Home non serviva piu' nessuna delle tre.
- 🎨 **Contrasto dopo la conversione**: il modale e' passato da `--c-card` a `--c-bg` (il guscio condiviso), e tutto cio' che era tarato su `--c-input` / `--c-line` ci si e' confuso dentro — tab non selezionati, campi, righe della lista, interruttore delle tile.
- Rifatti **ricavando fondo e bordo dal COLORE DEL TESTO mescolato al fondo** (`color-mix(in srgb, var(--c-text) 9%, var(--c-bg))`), non da un token fisso: cosi restano staccati su qualunque tema scelga il cliente, chiaro o scuro. Il tab non selezionato ha ora il testo in `--c-text`, non in `--c-muted`.
- ⚠️ `.spf` (form Giorni speciali) e' **condiviso** con Réglages, dove sta su `--c-card` e va benissimo com'e'. Il rialzo e' quindi scritto **solo** sotto `#evt-overlay`: cambiarlo nel componente avrebbe rotto Réglages.
- **Tile Note**: testo portato alla stessa misura del modale (0.98rem) e il pallino decorativo `.np-dot` sostituito dal **cerchio vero** `.note-check`. Ora una nota si spunta **dalla tile**, senza aprire il modale: il cerchio e' l'unico punto dell'anteprima che non porta dentro.
- La logica del «fatto» era scritta dentro l'handler del modale: estratta in `spunta(id)`, chiamata dai due punti. Stesso cerchio, stesso codice.

### 📅 Agenda — il modale evento
- Era gia costruito **a mano** come il guscio: flex in colonna, `h2` e `.m-foot` in `flex: 0 0 auto`, `.m-cols` come corpo. Aveva ragione lui: e' la stessa idea, scritta una volta di troppo.
- ⚠️ **DEROGA VOLUTA al guscio**: qui NON scorre il corpo, scorrono le **due colonne separatamente**. Avevo provato a uniformare a una barra sola — Enzo l'ha fermato, e ha ragione: sono due contenuti indipendenti (a sinistra i titoli per lingua, a destra le descrizioni lunghe) e con una barra sola, scrivendo la descrizione EN, si perde di vista il titolo EN. Il corpo e' `overflow: hidden`, la barra sta nelle colonne.
- Sotto i 760px le colonne si impilano e torna la barra unica: due barre **affiancate** hanno senso, due **impilate** no.
- Resta valida la nota storica: li serve `display: block` e non un grid a una colonna, perche il contenitore ha un'altezza definita dal flex e le righe implicite non bastano.
- Bottoni del footer → `.md-btn` / `.md-btn-primary`. Sparite `.m-cancel` e `.m-save` locali; `.m-err` resta (e tiene il `margin-right: auto` che spinge i bottoni a destra).
- 🧹 **Trovato CSS morto**: ~30 righe di `#cp-overlay` e `#gc-overlay` (coupon e buoni regalo) copiate da `marketing.astro`. Quegli id **non esistono in agenda**. Non toccate: da togliere in un giro di pulizia a parte.


### 🛒 Ordini — il modale «Nuovo ordine»
- Wizard a 3 passi: **lo stepper resta fermo sotto il titolo**, come un header di secondo livello. Al 3° passo si deve poter tornare al 1° senza risalire tutto il carrello. Corpo flex in colonna, `overflow: hidden`, la barra sta nel pannello.
- **Dimensione fissa 80vw × 80vh su desktop**: comportamento gia' presente e conservato. Serve perche' aggiungendo piatti la scatola crescerebbe sotto le mani. Ora si esprime con `--md-w: 80vw` + `height` sul `.md-box`, invece di riscrivere la scatola.
- `.nc-nav` era `space-between`. Nel footer condiviso (`flex-end`) basta `#nc-prev { margin-right: auto }`: stesso trucco del `.m-err` in agenda. Sparite `.nc-nav-btn`, `.nc-nav-next` e `.nc-send`.
- 🧹 Tolto da `modal.css` il blocco mobile `!important` di `.nc-modal`: quelle classi non esistono piu'.
- ⏳ Sulla stessa pagina resta `#rf-overlay` (rimborso), non ancora convertito.

### 🐛 Ordini: pagina VUOTA e muta — un ordine senza email uccideva tutta la lista
- Sintomo: nessuna card, nessun messaggio, ma il conteggio in alto giusto («2 ordini · 30,00 €»).
- **Causa**: `esc()` era `s.replace(...)` su una stringa nuda, e la riga dell'email chiamava `esc(o.customer_email)` **senza guardia**. Un ordine creato dall'admin puo' non avere email — il modale chiede nome + telefono, non l'indirizzo. `null.replace` → TypeError dentro `cardHTML` → `render()` moriva a meta.
- **Perche' era MUTO**: `render()` nasconde l'elemento del messaggio (`display: none`) quando ha ordini da disegnare, POI lancia; il `catch` scriveva l'errore dentro quell'elemento **senza riaccenderlo**. Ed era pure un `catch` vuoto, senza `console.error`. Il conteggio invece era gia stato scritto, prima del punto di rottura: da qui il quadro assurdo di una pagina vuota con un conteggio giusto.
- **Tre correzioni**, non una:
  1. `esc()` accetta `unknown` e fa `String(s ?? "")` — nessun campo puo' piu' farla esplodere;
  2. la riga dell'email compare **solo se l'email c'e'**, come gia faceva il telefono;
  3. `mostraStato()` riaccende sempre l'elemento del messaggio, e i tre `catch` fanno `console.error` (anche quello dell'aggiornamento **silenzioso**, che prima inghiottiva tutto).
- ⚠️ **Lezione sul metodo**: avevo estratto `cardHTML` e girata in Node con tutti gli stati — passava. Passava perche' il mio `esc` **finto** faceva `String(x)`, quello vero no. Uno stub piu' gentile dell'originale nasconde esattamente il bug che stai cercando: gli stub vanno copiati, non riscritti.

### 🐛 Ordini: annullato, ma la card restava fra gli attivi
- **Le liste sono DUE**: `ordini` (oggi, live) e `ordiniGiorno` (il giorno consultato col datepicker). `render()` disegna quella giusta, ma `cambiaStato()` aggiornava solo `ordini`. Guardando un altro giorno la card non si spostava: il nuovo stato compariva solo ricaricando.
- **La firma bloccava anche il recupero**: `carica(true)` ridisegna solo se `firmaDa(list)` cambia, e la firma della copia appena modificata a mano e' gia identica a quella del server. Quindi il giro di controllo veniva saltato in silenzio. Ora dopo un cambio di stato la firma si **azzera** e si ricontrolla col server (e si ricarica il giorno, se se ne sta guardando uno).
- **L'email di annullamento era `await`**: la PATCH restava appesa a Resend per secondi prima di rispondere, col bottone fermo. Ora e' `void ... .catch()`, come `inviaNotifiche` alla creazione: l'annullamento e' gia scritto nel database, la risposta non deve aspettare la posta.
- Lezione: **due copie della stessa lista e una cache a firma** = due modi indipendenti di non vedere un aggiornamento. Chi scrive lo stato locale deve toccarle entrambe e invalidare la firma.

### ↩️ Ordini annullati: si possono rimettere in corso (ma non tutti)
- Il rollback esisteva solo per i **terminati**. Ora c'e' anche sugli **annullati** — l'API accettava gia' `cancelled → paid`, mancava il bottone.
- ⚠️ **Non compare se l'ordine e' stato rimborsato** (anche solo in parte): quel denaro e' uscito davvero, e riportare l'ordine a «pagato» lo farebbe rientrare negli incassi del giorno e nelle statistiche. Deciso con Enzo fra quattro opzioni.
- ⚠️ **Al cliente NON arriva nessuna email**: quella di annullamento e' gia partita e lui resta convinto che sia annullato. Va avvisato a voce. Un'email «ordine di nuovo confermato» e' un lavoro a parte (nuovo testo in 5 lingue + template).
- Il click non ha richiesto codice nuovo: gli annullati vivono nella griglia degli **spenti**, che gia' gestiva `data-act="rollback"`.
- La card annullata puo' ora avere due azioni (Rimborsa + Rimetti in corso): stanno insieme a destra in `.cf-acts`, la pastiglia resta a sinistra.

### 📇 Card ordine: icone al posto di «Email :» e «Tel :»
- Le due parole si ripetevano su ogni card senza dire niente: un indirizzo e un numero si riconoscono da soli. Sostituite da busta e cornetta, stesso tratto delle altre icone della pagina.
- Le etichette restano come `aria-label` sul link, per i lettori di schermo.
- `.row` e' diventata un flex: aggiunta l'ellissi sul testo, altrimenti un indirizzo lungo sfondava la card (prima ci pensava il `<p>` in flusso normale).
### 📋 Prenotazioni: il modale DETTAGLI, l'ultimo `.overlay` della pagina
- Mancava l'informazione essenziale quando il piano sala e' acceso: **i tavoli assegnati non comparivano da nessuna parte**. Aggiunti riusando `etichettaTavoli(r)` e `sezioneTavoli(r)`, gli stessi delle card: stesso nome, stessa sezione, nessuna seconda versione da tenere allineata.
- **Riga di testa su due livelli**: sopra il QUANDO e per QUANTI (data, ora, coperti), sotto il DOVE (tavoli, sezione). Ogni voce ha la sua icona, le voci vuote non si stampano e la seconda riga sparisce del tutto se non c'e' niente da metterci.
- **Il servizio e' uscito**: lo dice gia' l'ora, e occupava la riga che serviva ai tavoli.
- **Il canale di prenotazione** (walk-in / telefono / sito) e' ora l'icona bianca a sinistra della pillola di stato, senza parola: il nome resta nel `title`. Prima era un'icona persa in testa alla riga meta **e** una riga «origine» in fondo — la stessa cosa detta due volte.
- ⚠️ **Allineamento**: pillola e prima riga hanno altezze diverse (l'una ha il padding, l'altra no) e con `align-items: flex-start` i contenuti non cadevano sulla stessa linea. Introdotta `--dt-riga`, l'altezza della pillola, ereditata da entrambi come `min-height`: si centrano sulla stessa linea e la seconda riga scende senza spostare nulla.
- **Il riquadro e' sempre visibile**: prima era il blocco del cronometro, quindi le informazioni sparivano per una prenotazione in attesa o annullata. Ora il riquadro e' la cornice fissa e a comparire e' solo la parte cronometro (`#dt-tblock`). Sparita la lista chiave/valore `#dt-rows`, che era la seconda presentazione delle stesse cose.
- ⚠️ **Spaziature dall'alto, non dal basso** (`margin-top` invece di `margin-bottom`): quando manca il cronometro o non ci sono opzioni, il riquadro si chiude sul contenuto invece di lasciare spazio appeso.
- **Mobile (≤640)**: lo stato sale in cima (prima la pillola, poi il canale) e i dettagli scendono sotto — due sole inversioni CSS (`column-reverse` + `row-reverse`), **senza toccare il markup**, che nel DOM resta in ordine di lettura.
- ⚠️ Girando la riga in colonna, `flex: 1 1 240px` sulla meta non e' piu' una larghezza minima ma un'**altezza** di partenza: 240px di vuoto nel riquadro. In colonna la base va azzerata.
- 🏁 Con questo **Prenotazioni e' la prima pagina finita**: nessun `.overlay` rimasto, fuori il CSS del guscio vecchio, i selettori in coppia e il ramo `.overlay.is-open` del controllo «modale aperto».

### 🐛 Due errori veri trovati da `astro check`, non da esbuild
- **`caricaVista` non era nello scope di `carica()`**: e' dichiarata nel blocco delle viste, molto piu' in basso. Il refresh silenzioso della settimana sarebbe morto con un ReferenceError. Risolto con un segnaposto `ricaricaVista` accanto a `let vista`, riempito da quel blocco — lo stesso schema di `planNomi`.
- **`base_name` in `checkout.ts`**: il tipo locale di `itemsOrdine` non conosceva i pezzi separati aggiunti per le pastiglie delle varianti.
- 🧹 `_to_delete` escluso da `tsconfig.json`: i file di verifica estratti dagli `.astro` (senza import risolvibili) producevano **87 errori** che coprivano i due veri. Un check illeggibile e' un check che non si guarda.

### 👥 Clienti: modale dettagli e modale modifica al guscio condiviso
- **Dettagli** (`#act-overlay`): il nome del cliente e' salito nell'**header** — prima era un `<h2>` dentro la colonna di sinistra, col × che galleggiava da solo in alto a destra. Le due colonne continuano a scorrere separate (`#act-overlay .md-body { overflow: hidden }`), come nel modale evento di Agenda. Breakpoint allineato a **760/761**, la deroga gia' in uso per i modali a due colonne (qui era rimasto 720).
- **Modifica/aggiungi** (`#ed-overlay`): azioni nel footer (`Annulla` + `Salva`) al posto del bottone corallo a tutta larghezza; l'errore vive nel footer spinto a sinistra e da vuoto non occupa spazio.
- **Riga foto rifatta come negli altri modali**: etichetta sopra, anteprima, pastiglie neutre «Carica una foto» / «Libreria». L'anteprima resta un **cerchio** con le iniziali: per una persona il ritratto e' tondo dappertutto nell'app. Montato `<ImagePicker />`, che qui non c'era: una foto gia' caricata non va ricaricata.
- ⚠️ Il listener `imgpick:pick` esce subito se il modale e' chiuso: la Libreria vive **fuori** dal modale e senza quel controllo una scelta fatta altrove finirebbe sull'avatar.
- **Permesso/negato sono diventati PILLOLE**, verde e rosso, con la stessa forma degli stati nella colonna accanto (`.act-status`). Il testo semplice resta per il caso neutro — cliente senza email — dove non c'e' niente da concedere o negare.
- 🐛 Trovato per strada: **«Consentito» non aveva nessuna classe**. Solo «Bloccato» diventava rosso, l'altro restava grigio come un testo qualsiasi.
- 🐛 **Modulo ordini spento dal super admin**: la sezione statistiche, il tab e la colonna erano gia' coperti, ma il tab di partenza no. La regola era «Prenotazioni, ma Ordini se non ci sono prenotazioni»: per un cliente senza prenotazioni sceglieva da solo il tab nascosto e mostrava la lista del modulo spento. Ora gli ordini escono **dai dati** (`actAtti` li filtra), non solo dalla vista.
- **I 5 piatti piu' ordinati** in fondo alla sezione ORDINI, dalla **stessa chiamata** `client_top` che alimenta i preferiti nel modale «Nuovo ordine»: i due posti non possono dire cose diverse e l'API non e' stata toccata. Qui sono pero' solo da leggere — nel modale ordine servono ad aggiungere al carrello, in una scheda cliente sarebbero un bottone che non fa nulla.
- ⚠️ Statistiche e piatti arrivano da due chiamate diverse e non si sa quale finisce prima: l'ultimo pacchetto resta in `exUltimo`, cosi' **chiunque arrivi per secondo ridisegna con tutti e due** invece di cancellare l'altro. Entrambe rispettano `actKeyCorrente`.

### ⌨️ Campi — il terzo componente condiviso
- Dopo il guscio e l'interruttore, `src/styles/field.css`: **dentro un modale non serve nessuna classe**, `input`/`textarea`/`select` in `.md-box` prendono la grafica da soli. Fuori dai modali c'e' `.fld`.
- **Fondo `--c-card`, lo stesso delle card** (riga di prenotazione, tile, sezioni statistiche). Non e' un caso: una casella da riempire e una card sono tutte e due un piano rialzato rispetto al fondo, e cambiando tema si muovono insieme.
- **Nessun bordo**, angoli 6px. Il bordo a riposo e' `1px solid transparent` e **non** `border: 0`: cosi' quando prende il fuoco e diventa corallo l'altezza non salta di due pixel.
- ⚠️ **Il selettore dei modali e' volutamente lungo** (`.md-overlay .md-box …`). Le pagine si erano scritte le loro copie con la **stessa specificita'** (`.md-box input`): chi vince dipenderebbe dall'ordine in cui il bundle le mette, cioe' dal caso. Con un selettore piu' forte «uguale in ogni modale» e' vero davvero; le copie locali si tolgono con calma, finche' ci sono sono codice morto. Tolte in `clients`.
- ⚠️ **Mai la scorciatoia `background`**, solo `background-color`: la scorciatoia azzererebbe la freccia disegnata dei select.
- ⚠️ **Il corpo del testo resta 0.95rem anche su mobile**: sotto i 16px Safari iOS ingrandisce la pagina al primo tocco nel campo e il modale finisce fuori schermo. Li' rimpicciolire fa danno.
- ⚠️ Checkbox, radio, file, range, color e hidden sono **esclusi**: hanno una grafica loro, e fra questi c'e' l'input invisibile di `.switch`, che senza l'esclusione si sarebbe ritrovato un fondo.
- 📝 **«Sembra che ci sia un'opacita'»**: non c'era. `color-mix` fra due hex non produce alpha. Il campo sembrava di vetro perche' la schiaritura era troppo debole (9% del testo sul fondo) — si alza la percentuale, non si aggiunge un rgba. Poi la risposta vera e' arrivata da Enzo: usare `--c-card`, il colore che l'occhio riconosce gia' come «piano rialzato».

### 🏚️ Interruttore: anche i `<button role="switch">`
- Su Clienti l'interruttore non e' una checkbox ma un bottone, e lo stato lo porta `aria-checked`. Il componente conosceva solo `input:checked` e `.is-on`.
- Aggiunto `[aria-checked="true"]` a `switch.css` **senza duplicare lo stato in una classe**: `aria-checked` serve gia' all'accessibilita', una classe parallela sarebbe una seconda verita' da tenere allineata a mano. Il JS non e' stato toccato.

### 🍽️ Menu — modale sezioni: frecce al posto del trascinamento, e un salvataggio solo
- Il trascinamento su tablet era un terno al lotto e, soprattutto, **riparentava le sezioni per sbaglio**: bastava passare sopra la riga giusta al momento sbagliato.
- Ora due cerchi su/giu' (`.i-btn`, la stessa impronta degli altri bottoni della riga). La regola: **si sposta di un posto fra i FRATELLI, portandosi dietro il sotto-albero**. Cambiare padre per sbaglio non e' piu' possibile, e la freccia si SPEGNE quando non c'e' dove andare.
- Se il dito sbaglia e prende la freccia accanto, il rimedio e' premere l'altra: giu'+su e' l'identita'. Col drag, un dito impreciso ti spostava la sezione in un punto qualunque.
- ⚠️ Touch: `@media (pointer: coarse)` e non un breakpoint di larghezza — un tablet in orizzontale e' largo come un portatile e si usa col dito.
- **Verificato in Node** su un albero a tre livelli: dopo ogni mossa, ogni figlio ha il padre prima di se', la profondita' e' coerente e sta dentro il blocco del padre. Il caso critico — far uscire una sezione CON figli — li porta dopo il vecchio padre invece di lasciarli in mezzo agli ex fratelli.

### ⏱️ «Ci mette troppo a salvare» — erano DUE problemi, non uno
- Enzo: «i clienti si innervosiranno». Aveva ragione, e la causa principale non era quella che sembrava.
- **L'endpoint**: `PATCH /api/admin/categories` faceva **due UPDATE in sequenza per OGNI sezione**, sempre, anche per quelle ferme. Con 20 sezioni, **40 andate e ritorno** verso Supabase per spostare una riga di un posto. Ora e' un `upsert` unico, e i piatti si toccano solo per le sezioni che hanno davvero cambiato posto, in parallelo: da ~40 chiamate a 2.
- **L'interazione**: ordine, livello, nome e tipo ora si cambiano **solo in memoria**; il server lo si sente una volta sola, con «Salva». Il footer dice «Modifiche non salvate» finche' c'e' qualcosa in sospeso.
- Aggiungi ed elimina restano immediati ma **salvano prima quello che c'e' in sospeso**: passano dal server e finiscono con un ricaricamento, che altrimenti se lo porterebbe via.
- ⚠️ **Ordine di salvataggio**: prima i NOMI, poi l'ordine. I piatti sono legati alla sezione per nome e la PATCH tocca gli stessi piatti: invertendo, li cercherebbe con un nome che non esiste piu'.
- ⚠️ Con modifiche in sospeso il click sullo SFONDO non chiude (un click storto buttava via tutto in silenzio). «Annulla» scarta **e chiude**: e' il «lascia perdere», non un «ripulisci e restaci dentro».

### 🔘 Bottoni — il quarto componente condiviso
- Dopo guscio, interruttore e campi: `src/styles/button.css`. `.btn` e' il bottone d'azione dentro un modale; `.md-btn` resta la coppia annulla/conferma del footer.
- Ogni pagina se l'era riscritto: `.ed-pill`, `.sec-btn`, `.f-img-btn`, `.ed-upl`, `.pill`, `.m-ghost`. Sei nomi per la stessa cosa.
- **Regola nata qui: UN SOLO bottone corallo per modale, ed e' la conferma.** In «Modifica immagine» «Comprimi in WebP» era corallo pieno come «Salva» — due bottoni che chiedono cose diverse con lo stesso peso.
- `.btn-danger` (Rimuovi) e' grigio a riposo e rosso solo al passaggio: rosso fisso sembra un allarme sempre acceso.

### 🧹 Conversioni: agenda, marketing, assets, menu
- **Agenda**: il guscio era gia' condiviso ma sotto c'erano tre componenti riscritti a mano (interruttore, `.pill`, `.f-input`). Censimento del CSS: **65 classi e 8 id mai usati**, interi blocchi copiati da marketing (buoni regalo, coupon, newsletter). ~120 righe morte che ogni cliente scarica — segnalate a Enzo, non ancora tolte.
- **Marketing**: tutti i modali tranne «Usa buono». La pagina si era riscritta un `.modal` che IMITAVA il guscio condiviso (titolo sticky col filetto, footer sticky): sembrava giusto, sotto era tutto suo.
- ⚠️ **Newsletter: «Invia a tutti» stava per PRIMO, a sinistra, in corallo** — nel punto dove negli altri modali c'e' «Annulla». Per un bottone che manda email a tutti i clienti e non si torna indietro. Riordinato in fondo a destra.
- **Crediti**: il footer COMPARIVA scegliendo un pacchetto, e i riquadri dei prezzi si spostavano sotto il dito. Ora «Paga» c'e' sempre, spento.
- **Buoni regalo**: «‹ Indietro» era una `.pick`, la stessa classe delle pastiglie di scelta del form — sembrava un'opzione da selezionare, non un comando.
- **Assets** e **Prenotazioni** sono le prime pagine FINITE: nessun `.overlay` rimasto, fuori tutto il guscio vecchio.
- In quasi tutti mancava **«Annulla»**: si usciva solo dalla ×.

### 👻 Il documento che non si cancellava — era una CARTELLA
- Enzo: «vedo il toaster ma e' sempre li'». Il file mostrava anche nome senza estensione, peso vuoto e data vuota: tre sintomi, una causa sola.
- `storage.list()` restituisce anche i **PREFISSI** (le cartelle) insieme agli oggetti: arrivano con `id: null` e senza metadati. Il codice li prendeva per documenti — ecco peso e data vuoti, che sono proprio i campi che una cartella non ha.
- E `remove()` su un percorso senza oggetti **non da' errore**: restituisce la lista (vuota) di cio' che ha tolto. L'endpoint la leggeva come successo → toast verde su un file ancora li'. **Dire il falso e' peggio di un errore.**
- ✅ La lista scarta le cartelle (`id !== null`); la DELETE verifica che il nome sia fra i file tolti davvero, altrimenti 404.

### 🖼️ L'anteprima PDF non funzionava da una settimana, in silenzio
- `caricaPdfjs()` inseriva a runtime uno `<script src="https://cdnjs.cloudflare.com/...">`. La CSP dell'admin e' `script-src 'self' 'nonce-...'` (resa stringente il 04/09): origine esterna e niente nonce → **il browser lo rifiutava**.
- Falliva in silenzio perche' `generaAnteprima()` ha un `catch` che ripiega sull'icona. Nessun errore, nessun sospetto.
- ✅ `pdfjs-dist` (6.3.289) come dipendenza, con `import()` dinamico e worker via `?url`: Vite ne fa un pezzo servito da `'self'`, la CSP resta stretta e si scarica solo quando si carica davvero un PDF.
- ⚠️ Il rovescio: prima un CDN irraggiungibile costava solo l'anteprima; ora una dipendenza mancante ferma tutta la pagina Assets. Dopo ogni merge sui clienti va rifatto `npm install`.

### 🧪 16 test che non giravano da mesi
- Lanciando `npm test` per la prima volta: `slots.test.ts` segnava **«0 test»** e falliva all'import. Non «nessun test da fare» — non partiva affatto.
- `slots.ts` importava `./db` in cima, e `db.ts` **lancia** se mancano SUPABASE_URL / SUPABASE_SERVICE_KEY. Astro gliele passa, vitest no (Vite espone solo le `VITE_*`).
- ✅ Il client Supabase serve in UN punto, dentro `aggiornaTimezone()` che e' gia' async e gia' in try/catch: import dinamico li'. `slots.ts` torna a essere calcolo puro e i suoi **16 test** girano. Totale: **39 verdi**.
- E' la lezione gia' scritta nel diario («env valutate all'import → lazy»), applicata altrove ma non qui.

### 🧪 Assets/Documenti — 18 test unitari e tre problemi veri
- Enzo: «ho l'impressione che ci siano diversi problemi». Invece di tirare a indovinare, `tests/documenti.test.mjs` (18 test, `node --test`): nomi, anteprime, rinomina, cancellazione, trasporto, cestino. Funzioni copiate **verbatim**.
- **Verde**: accenti e spazi nei nomi, anteprima agganciata al nome giusto, omonimi che non si sovrascrivono, `../` rifiutati, anteprime che non compaiono come documenti.
- 🐛 **Due cestini armati insieme**: il cestino e' a due tempi, ma ogni bottone si armava per conto suo e restava armato 3 secondi. Con piu' documenti se ne potevano avere due o tre pronti a scattare, e un click distratto cancellava un file che non si stava guardando. Aggiunta la guardia «uno solo alla volta», la stessa che Ordini e Prenotazioni avevano gia'.
- 🐛 **Il limite di peso guardava la cosa sbagliata**: il client bloccava a 10 MB il file SUL DISCO, ma il PDF viaggia in JSON come base64 — **+33%**. Un file da 9 MB partiva come ~12 MB e poteva morire per strada senza messaggio. Ora il limite e' sui tre quarti.
- 🐛 **L'API nascondeva gli errori**: `if (error) return { documents: [] }` col commento «bucket non ancora creato» faceva diventare QUALUNQUE errore «nessun documento» — bucket mancante, permessi, Supabase giu'. Ora solo il bucket inesistente da' lista vuota.
- L'anteprima PDF viene da pdf.js su CDN esterno: se e' bloccato non si genera, e ora almeno lo scrive in console invece di sparire in silenzio.

### 🖨️ Stampa e Super: l'ultimo giro di modali
- **Stampa (acquisto)**: gia' sul guscio condiviso. Rimessi in riga i riquadri dei pacchetti — bordo da `color-mix` sul testo invece di `--c-line`, stesso sollevamento al passaggio del mouse delle altre card — e l'errore portato al rosso di sistema con `:empty { display: none }` (prima lasciava una riga vuota).
- **Super (nuovo utente)**: era un guscio tutto suo (`.us-overlay`, `.us-modal`, `.us-close`, campi con fondo `--c-card`). Passato a `<Modal>`: ~15 righe di CSS in meno, azioni in un footer vero con un «Annulla» che prima non c'era, «Genera» diventato `.btn`, e tre `style=` inline diventati classi.

### 🪑 La piantina della sala — il modale piu' grosso di tutti
- Ultimo `.overlay` fatto a mano che valesse la pena convertire: 90vw × 90vh, header cucito a mano, e dentro una tela con tavoli trascinabili, due pannelli flottanti e la colonna dei tavoli collegati.
- ✅ Passato a `<Modal>` (`width="1600px"`). Il titolo e la × arrivano dal guscio; il **totale** («7 tavoli · 14 posti») e i messaggi sono scesi nel **footer**, a sinistra, col «Chiudi» a destra — cosi' restano sempre visibili invece di stare appesi in fondo alla colonna degli attrezzi.
- ✅ Bottoni al componente condiviso: i quattro «+ Rotondo / Quadrato / Pianta / Muro», «Disegna la sala» e «Collega tavoli» sono `.btn`, i due «Duplica» sono `.btn .btn-sm`. Tolte 6 righe di CSS: prima ce n'erano **tre disegni diversi** nello stesso modale (contorno corallo, riempito, pastiglia).
- ✅ Campi al componente condiviso: i due pannelli flottanti (nome/posti del tavolo, larghezza/altezza del decoro) non hanno piu' il loro CSS — li veste `field.css` perche' stanno dentro `.md-box`.
- ⚠️ **Due trappole, tutte e due invisibili finche' non si prova**:
  1. **I pannelli flottanti sparivano dietro il modale.** Sono `position: fixed` con `z-index: 60`: bastava contro il guscio vecchio (300), non contro `.md-overlay` (**400**). Portati a 500.
  2. **La sala si sarebbe schiacciata a zero.** La tela si dimensiona con un container query (`container-type: size`), che misura il genitore: il `.md-body` e' alto quanto il contenuto, quindi non c'era niente da misurare. Risolto mettendo il corpo a colonna flex e `.sl-wrap` a `flex: 1 1 auto; min-height: 0`. Le due regole sono ora scritte in ENGINE.md, perche' valgono per qualsiasi modale che debba RIEMPIRE la finestra.
- ➕ Sotto i **900px** le tre colonne (attrezzi | sala | gruppi) si impilano: prima il modale non aveva **nessun** `@media` e su tablet le colonne uscivano dal bordo.
- I cestini tondi restano `.tm-ibtn` — e' il bottone-icona della pagina, usato anche da Team e Marchi, e ha uno stato «conferma» che si allunga in pastiglia. `button.css` non ha (ancora) una variante icona: farne una e migrare le quattro pagine e' un giro a se'.

### 👔 Team: il modale contatto prende la forma di quello cliente
- Era l'altro `.overlay` fatto a mano di Impostazioni: guscio proprio, campi `.f-input`, etichette `.f-lab` con margini a occhio, e un footer dove «Salva» stava **a sinistra** con i due interruttori di fianco — l'unico posto dell'admin dove il bottone di conferma non era in fondo a destra.
- ✅ Passato a `<Modal>` (660px). Footer standard: errore a sinistra, **Annulla / Salva** a destra come in ogni altro modale. L'«Annulla» prima non c'era.
- ✅ Campi ed etichette: `.f-field` + `.f-label`, **gli stessi del modale cliente** in Clienti. Le caselle non hanno piu' CSS proprio, le veste `field.css`; la riga foto e' la stessa (`cerchio + bottoni .btn`, «Rimuovi» in `.btn-danger`).
- **DIPENDENTE e ATTIVO restano nel footer** (provato a portarli nel corpo come righe con filetto, Enzo li ha rivoluti li'): interruttore + etichetta a sinistra, «Annulla / Salva» a destra. Il footer allinea a sinistra e a spingere e' solo il PRIMO bottone (`margin-left: auto`), cosi' il secondo gli resta accanto invece di volare all'altro capo.
- ✅ **«+ Aggiungi un contatto» e' diventato il FAB condiviso**: pillola corallo in basso a destra con etichetta corta «+ Contatto», come «+ Cliente» e «+ Ordine». Era l'ultimo posto dell'admin dove il pulsante d'aggiunta stava dentro l'intestazione della pagina. Nuova chiave `set.tm.contactWord` nelle 5 lingue (il «+» lo mette il markup, come altrove).
- Lo mostra `mostraTab` **solo** sul tab Team, che e' anche l'unico dove la barra «Salva» non compare: i due flottanti occupano lo stesso angolo e non si incontrano mai.
- Tolte ~14 righe di CSS (`.tm-upl`, `.tm-upl-rm`, `.tm-foot`, `.tm-save`, `.tm-avatar-edit`, `.tm-avatar-side`). `.f-lab` resta, ma ormai serve **solo** al modale documenti — l'ultimo guscio vecchio della pagina.

### 👻 L'anteprima PDF era rotta in DUE posti, ne avevamo aggiustato uno
- Enzo: «nella pagina documenti l'anteprima non appare neanche qui». Era vero, ed e' lo **stesso** guasto corretto in Assets qualche giorno fa: il tab Documenti di Impostazioni aveva la **sua copia** della funzione, che caricava pdf.js da `cdnjs.cloudflare.com` con uno `<script>` creato a runtime. La CSP dell'admin (`script-src 'self' 'nonce-…'`) lo rifiuta — origine esterna, niente nonce — e il `catch { return null }` era **muto**: restava l'icona grigia, identica a quella di un PDF protetto.
- Il documento che l'anteprima ce l'aveva era stato caricato dalla pagina Assets, gia' corretta. Due porte per la stessa stanza, una aggiustata e una no.
- ✅ **Una funzione sola**: `src/lib/admin/pdfThumb.ts` (`caricaPdfjs` + `generaAnteprimaPdf`), usata da Assets e da Impostazioni. Tolte 71 righe da Assets e 50 da Impostazioni. Il parametro `origine` finisce nel log, cosi' si sa da quale pagina arriva l'errore.
- **La lezione non e' «c'era un bug»**: correggere una copia e lasciare l'altra e' il modo tipico in cui un guasto sopravvive a chi l'ha riparato. Quando una funzione e' copiata in due pagine, la correzione va nel modulo, non nella copia.

### 📄 Documenti: anche «+ Aggiungi un documento» e' il FAB condiviso
- Pillola corallo in basso a destra, etichetta corta **«+ Documento»** (nuova chiave `as.docWord` nelle 5 lingue). L'`<input type="file">` resta nascosto nel tab, e' il FAB a farci click sopra.
- Come quello del Team lo mostra `mostraTab` solo sul suo tab — e anche li' la barra «Salva» non compare, quindi l'angolo in basso a destra e' libero.

### 📄 Il modale documento — e Impostazioni chiude
- Ultimo `.overlay` fatto a mano della pagina. Passato a `<Modal>` (520px): footer vero con **Annulla / Carica** (l'«Annulla» non c'era), campi da `field.css`, etichette `.f-field`/`.f-label` come negli altri due modali della pagina.
- **13 `style=` in riga spariti dal markup**: larghezze, gap, margini e `flex` erano scritti a mano accanto a ogni tag — impossibile ritoccare una misura senza rileggere l'HTML. Adesso sono otto regole (`.dc-row`, `.dc-grow`, `.dc-lang`, `.dc-inline`, `.dc-fname`, `.dc-hint`, `#dc-nval`, `#dc-nunit`).
- L'etichetta e il campo «nome file» si nascondevano **separatamente**, con due `style.display` da tenere allineati a mano in due punti del codice. Ora sono un `.f-field` solo (`#dc-nom-box`) e la riga da scrivere e' una.
- ✅ **Impostazioni e' una pagina CHIUSA**: `.overlay`, `.modal`, `.m-close`, `.f-lab` e `.f-input` non esistono piu' li'. 24 righe di guscio ridisegnato in meno, tutte e tre le finestre (piantina, team, documento) sul guscio condiviso.

## 📌 12/09/2026 — Conversione dei modali CHIUSA + cinque guasti silenziosi

**Il filo della giornata**: ogni guasto trovato oggi era invisibile perche' il
ripiego somigliava al funzionamento normale — un'icona grigia al posto
dell'anteprima, un bottone che cambia solo il testo, un numero tondo, sette
trattini da 2px, una notifica push di troppo. Tre su cinque nascevano dalla
stessa causa: **due copie della stessa cosa, corretta in una sola**.

### 🧩 Conflitto su tsconfig.json: due clienti su quattro
- Il motore aveva aggiunto `_to_delete` agli `exclude`; **La Molisana** ci aveva messo `build`, **L'Huile** `build` + `_backup` — le loro cartelle di lavoro. Stessa riga toccata da due parti: conflitto. ChouChou ed EN, che non l'avevano toccato, sono passati lisci.
- ✅ Risolto **a monte**: nel motore gli exclude sono ora `dist`, `build`, `_backup`, `_to_delete`. Cosi' nessun cliente ha piu' un motivo per toccare quel file, e la versione del motore e' un sovrainsieme di quelle locali — risolvere col `--theirs` non perde niente.
- **Un conflitto ripetuto sullo stesso file del motore va letto come «manca qualcosa nel motore»**, non come sfortuna. Annotato in ENGINE.md accanto alla regola d'oro.

### 💥 Lo script di sync moriva alla prima riga di merge vera
- `BRANCH?: unbound variable`, riga 76. La riga era `echo "   • merge engine/$BRANCH…"`: i **puntini di sospensione attaccati alla variabile**. Bash prende i byte di `…` come parte del nome, cerca `BRANCH…` e sotto `set -u` si ferma. Risolto con le graffe: `${BRANCH}…`.
- **Perche' non era mai saltato fuori**: quella riga sta DOPO il ramo del dry-run (che fa `continue`) e dopo il «gia' aggiornato» (che fa `continue`). Si tocca solo quando c'e' davvero qualcosa da mergiare — cioe' nel momento peggiore, a meta' giro, col primo cliente gia' fetchato.
- Cercati tutti i casi dello stesso tipo in `scripts/`: era l'unico.

### 🧭 Lo script di sync aveva due clienti su quattro
- `scripts/sync-clienti.sh` elencava solo **ChouChou** e **La Molisana**. Sul Mac i repo cliente sul motore sono **quattro**: mancavano **L'Huile** — che il diario risulta mergiato a ogni giro, quindi finora a mano — ed **EN v2**, rimasta commentata con un TODO anche dopo la ricostruzione sul motore.
- Il punto non e' la riga mancante: **lo script stampa solo i clienti che ha in lista**, quindi il riepilogo finale diceva «✓ ok» e sembrava tutto a posto. Un cliente fuori lista e' invisibile, non segnalato.
- ✅ Lista completata (4 clienti) e messo in cima l'avviso che quella lista e' la sola fonte. Stessa nota in ENGINE.md.

### 🎛️ Documenti: sei colonne e due piani di colore
- **Sei colonne fisse** al posto di `auto-fill, minmax(190px, 1fr)`. Su uno schermo largo l'auto-fill ne infilava otto o nove e la prima pagina di un A4 diventava un francobollo illeggibile — che e' proprio quello per cui l'anteprima esiste. Sei e' il numero in cui il menu si riconosce ancora. Poi 4 / 3 / 2 sulla scala 1279 · 1023 · 640.
- **Le card erano `--c-card`, lo stesso colore della `.section` che le contiene**: a separarle c'era solo un bordo. Passate a `--c-bg`, come le card del Team nella stessa pagina.
- **Le pastiglie filtro erano trasparenti**, quindi anche loro si confondevano col pannello. Fondo pieno `--c-bg` e bordo da `color-mix` sul testo (non `--c-line`, che su certi temi sparisce). Cambiate per Team e Documenti insieme: e' lo stesso controllo in due tab, tenerne una versione piu' scura dell'altra sarebbe stata una divergenza in piu' da ricordare.
- La pagina ha ora due piani soli: il pannello chiaro, e tutto quello che ci sta sopra.
- 🗑️ **Il cestino a due tempi anche qui**: la × e' diventata l'icona del bidone, e soprattutto e' arrivata la guardia «**uno solo armato alla volta**», la stessa di Assets e Ordini. Qui mancava: ogni bottone si armava per conto suo e restava armato 3 secondi, quindi con sei card in riga ci si poteva ritrovare due o tre cestini pronti a scattare e un click distratto cancellava un documento che non si stava guardando. Un click ovunque fuori dal cestino lo disarma.

### 🎟️ «Usa buono» — e Marketing chiude
- Ultimo `.overlay` fatto a mano della pagina, e il piu' piccolo: 12 righe. `<Modal>` a 420px, footer vero con **Annulla / Incassa** (l'«Annulla» non c'era), i due `style=` inline diventati `.gcu-info` e `#gc-use-amount`.
- ✅ **Marketing e' una pagina CHIUSA**: via `.overlay`, `.modal`, `.m-close`, `.m-save`. Restano `.f-lab`, `.f-input` e `.m-err`, che non sono il guscio ma etichette, campi e messaggi dentro le scatole condivise.
- 🐛 **Trovato per caso togliendo `.m-save`**: la regola `.m-save.confirm` (il rosso scuro del secondo tempo) non agganciava piu' niente. Il bottone «Invia a tutti» della newsletter era passato a `.md-btn` in una conversione precedente, quindi da allora il secondo tempo cambiava **solo il testo** e non diventava rosso — su un'azione che manda una mail a tutta la lista. Ora la regola e' `.md-btn-primary.confirm`.
- E' il secondo guasto della giornata dello stesso tipo: una cosa corretta in un posto e rimasta rotta nell'altro, invisibile perche' il ripiego somigliava al funzionamento normale.

### 🎁 Card buono regalo: chi, quando, e dove sono finiti i soldi
- Destinatario, offrente e scadenza erano a **0.82rem**, piu' piccoli di una nota a margine — ed e' l'informazione per cui si apre la pagina. Portati a 0.95rem con piu' aria fra le righe.
- **«Usato 3 volte» si fermava li'**: per sapere QUANDO e QUANTO bisognava aprire la tabella su Supabase. L'API contava le righe del ledger e buttava via tutto il resto. Ora `GET /api/admin/gift-cards` rende anche `redemptions` (importo, data-ora, nota, tipo) e la card mostra il registro subito sotto il conteggio, rientrato con un filetto corallo che lo lega alla riga da cui dipende.
- **Data E ora**: un buono speso due volte lo stesso giorno darebbe due righe identiche.
- Il registro e' alto al massimo 7.5rem e scorre: un buono usato quindici volte non allunga la card e non sfalsa la griglia.
- ⚠️ **Ripiego per i clienti non migrati**: se il `select` ricco fallisce (mancano `note`/`kind`/`created_by`) si ricade sul solo `gift_card_id`, cioe' sul conteggio di prima. Senza, un errore avrebbe azzerato anche il numero di utilizzi — un dato che c'e' sempre stato.
- **Icone al posto delle etichette**: «Per», «Da parte di», «Scade il», «Usato» erano quattro parole ripetute su ogni card per introdurre quattro dati che si riconoscono da soli. Ora un'icona a larghezza fissa (regalo · persona · calendario · ciclo) e il dato in grassetto — e i quattro valori si incolonnano senza dipendere da quanto e' lunga l'etichetta tradotta, che in nederlandese e spagnolo cambia parecchio.
- ⚠️ **Le icone non parlano agli screen reader**: ogni riga porta il `title` e un `.sr-only` con l'etichetta vera. Un'icona muta e' un'informazione tolta a chi non la vede.
- 🖱️ **Via il bottone «Usa», e' la CARD ad aprire il modale**: era un bottone da 0.78rem schiacciato fra interruttore, matita e cestino — il bersaglio piu' piccolo per l'azione piu' frequente della pagina. Ora la card usabile e' `role="button"`, risponde a Invio e Spazio, e si solleva al passaggio del mouse; quella esaurita, scaduta o non pagata resta inerte.
- ⚠️ **L'ordine dei controlli nel gestore e' obbligato**: matita, cestino e interruttore stanno DENTRO la card, quindi il `closest("[data-use]")` li prenderebbe tutti. La card va controllata per ultima, dopo un `return` esplicito su ognuno degli altri.

### 💸 Rimborso — e Ordini chiude
- Terzo guscio della raccolta: non `.overlay` come gli altri ma `.rf-overlay`, tutto suo, con **19 righe** di CSS che ridisegnavano fondo, scatola, titolo, campo e bottoni.
- ✅ `<Modal>` a 420px. Resta solo la riga «€ [importo] [Tutto]», l'unica cosa davvero propria di questo modale: campo da `field.css`, «Tutto» da `button.css`, «Annulla / Rimborsa» dal footer condiviso.
- **«Annulla» era ROSSO PIENO** (`--c-red`), grande quanto «Rimborsa»: i due bottoni si somigliavano e quello che sembrava piu' pericoloso era quello che non faceva niente. Ora e' la coppia neutra/accento di ogni altro modale.
- **Via lo z-index 1000.** Non risolveva nessun conflitto: in Ordini non c'era niente fra 400 e 1000: era solo un «il piu' alto possibile». Ora il guscio sta a 400 come tutti, e il toast a 2000 resta sopra — che e' giusto, perche' annuncia l'esito del rimborso mentre la finestra e' ancora aperta.
- ✅ **Ordini e' una pagina CHIUSA.**

### 🧟 «Aggiungi cliente»: non era da convertire, era da seppellire
- Ultimo `.overlay` di Clienti — solo che **non si apriva piu'**. Il pulsante «+ Cliente» chiama `apriNuovo()`, che apre il modale unificato `#ed-overlay`; in tutta la pagina non esisteva un solo `add("is-open")` su `#overlay`. Residuo di quando aggiungi e modifica erano due finestre.
- Sepolti: 32 righe di markup, 9 costanti, `chiudiModale()`, `salva()` (~35 righe con una POST che non partiva mai), i listener, e ~45 righe di CSS (`.overlay`, `.modal`, `.m-close`, `.m-actions`, `.m-save`, `.m-cancel`, `.m-msg`, `.modal input`, `.tel-prefix`).
- ✅ **Clienti e' una pagina CHIUSA.**

### 🔎 Il confronto prima di cancellare: tre cose erano andate perse
Prima di buttare `salva()` l'ho confrontata riga per riga con il salvataggio vivo. Il codice morto era piu' completo in tre punti, e nessuno se n'era accorto perche' il modale che li conteneva non si apriva:
1. 🐛 **Invio non salvava piu'.** Nel morto premere Invio in uno dei quattro campi salvava; nel vivo non c'era nessun `keydown`. Rimesso.
2. 🐛 **Lo spinner era sparito.** Il morto metteva `.is-loading` sul bottone durante la scrittura, il vivo faceva solo `disabled = true`: su rete lenta il bottone si spegneva e basta. Rimesso.
3. 🐛 **Il prefisso telefonico non si spostava piu'.** Scrivendo «+33 6…» o «0033…» nel campo numero, il morto riconosceva il prefisso, lo metteva nella tendina e ripuliva il numero. Il vivo no. Rimesso su `#ed-phone`.
- 🐛 **Client e server in disaccordo**: «almeno email o telefono» era controllato dal client SOLO in creazione, ma il server lo pretende su ogni scrittura. Svuotando i due campi di un cliente esistente si otteneva un `400` con il messaggio **in francese** mostrato grezzo, qualunque fosse la lingua dell'admin. Ora il controllo vale sempre, e l'errore e' tradotto.
- 🧹 **Tolta `POST /api/admin/clients`**: senza chiamanti una volta sepolto il modale (l'unico altro uso dell'endpoint, in Prenotazioni, e' una PATCH). Erano 29 righe di API esposta con una copia dei controlli da tenere allineata a quelli della PATCH — che li ha tutti: nome obbligatorio, email o telefono, formato email. La DELETE continua a funzionare: l'`X-Method-Override` diventa un DELETE vero nel middleware, prima del dispatch.
- **La lezione**: un modale morto non e' innocuo. Ha continuato a ricevere correzioni che il modale vivo non ha mai avuto.

### 🍽️ Lunch: il terzo modale a due colonne
- Stessa forma del modale piatto, gia' convertito: `<Modal width="940px">`, corpo che NON scorre, le due colonne che scorrono ognuna per conto suo, footer con l'interruttore «Attivo» a sinistra e la coppia di bottoni a destra.
- Invece di riscrivere le regole, ho **aggiunto `#lu-overlay` ai selettori del modale piatto**: sono lo stesso problema (due colonne dentro una finestra da 940px), e tenerli in due blocchi separati vuol dire che la prossima correzione ne tocca uno solo. Vale anche per la deroga 760/761.
- I due `style=` in riga sono diventati `.lu-f-nome` e `.lu-combo-hint`.
- ⚠️ **Il campo prezzo va riportato a 110px con l'ID**: dentro `.md-box` field.css da' `width: 100%` a tutti i campi, e il prezzo si stendeva su tutta la colonna. Stessa trappola gia' vista nella piantina e nel modale documento — quando un campo ha una larghezza SUA, il selettore deve batterla.
- 🧹 `.m-msg:empty { display: none }`: con `flex: 1` uno span d'errore vuoto si prendeva tutto lo spazio libero del footer.
- Verificato prima di toccarlo (regola nuova): il modale e' VIVO — lo aprono il «+» sul filtro Lunch e la matita sulle card.

### 🍷 Menù: l'ultimo modale, e il guscio vecchio esce dal motore
- Quarto e ultimo `.overlay` fatto a mano. Convertito come i suoi due fratelli, aggiungendo `#mn-overlay` agli stessi selettori: le regole delle due colonne sono ora **una sola**, condivisa da piatto, lunch e menu.
- 🐛 **La trappola vera stava nel JS, non nel CSS.** La scelta immagine e' un evento `window` (`imgpick:pick`) che arriva a TUTTE le pagine in ascolto: ogni modale si difende con una guardia «sono io quello aperto?». Quella del menu era `mnOverlay.classList.contains("is-open")` — una classe che dopo la conversione non esiste piu'. Sarebbe rimasta `false` per sempre: scegliere una foto dalla libreria non avrebbe fatto niente, **in silenzio**. Ora e' `mnOverlay.hidden`.
- 🔀 **Riordinati i tre bottoni**: era «Salva bozza · Annulla · Salva», cioe' l'unico bottone che BUTTA VIA il lavoro incastrato fra i due che lo salvano. Ora «Annulla · Salva bozza · Salva»: le due azioni che conservano stanno insieme a destra.
- L'ultimo `style=` in riga e' diventato `.mn-add-course`.

### 🏁 Il guscio dei modali: conversione CHIUSA
- Con Menù **nessun modale admin usa piu' il guscio fatto a mano**. Spariti da tutte le pagine `.overlay`, `.modal`, `.m-close`, `.m-actions`, `.m-cancel`, `.m-save`.
- Tolto anche il **blocco di compatibilita' in fondo a `modal.css`**: sei regole con `!important` che servivano a tenere in riga i modali non ancora convertiti battendo gli stili scoped delle pagine. Non aggancia piu' niente, e gli `!important` erano il prezzo di far convivere due gusci.
- Resta fuori solo **ImagePicker**, che non e' mai stato un `.overlay`: ha un guscio suo (`.imgpick-*`) ed e' un COMPONENTE, quindi convertirlo tocca tutte le pagine che lo usano.
- 🧹 Codice morto segnalato e non toccato: `.m-actions` / `.m-cancel` in `reservations.astro`.

### 📊 L'istogramma della Home era piatto — una riga di CSS
- Enzo: «normalmente dovresti vedere degli istogrammi, giusto?». Si: c'erano sette trattini da 2px al posto delle barre.
- 🐛 `.st-bars` aveva **`align-items: flex-end`**. In flexbox quello fa restringere ogni colonna sul proprio contenuto, quindi `.st-bar` non era piu' alta 110px ma «auto» — e **una percentuale contro un genitore alto «auto» vale `auto`**. L'`height: 73%` della barra dentro diventava `auto`, cioe' zero, e restava solo il `min-height: 2px`. Le barre non erano mai state disegnate.
- ✅ `align-items: stretch` (il default). La barra si appoggia in basso col `justify-content: flex-end` che `.st-bar` ha gia': il `flex-end` sul contenitore non serviva a quello e rompeva tutto il resto.
- Verificato in un browser vero (Playwright) prima e dopo, sugli stessi dati: **2 2 2 2 2 2 2** px → **2 2 74 74 110 2 2** px.

### 🇮🇹 «Jeu, Ven, Sam, Dim» in un admin italiano
- Le etichette dell'asse erano due array **francesi scritti a mano** (`GIORNI_FR`, `MESI_FR`) dentro il calcolo lato server. Un ristoratore italiano vedeva i giorni in francese sul grafico della Home e su tutta la pagina Statistiche.
- ✅ Ora le da' `Intl` dalla lingua globale dell'admin. Si toglie il punto e si alza l'iniziale, cosi' restano identiche a come erano disegnate. **In francese l'output e' lo stesso di prima** (Lun Mar Mer Jeu Ven Sam Dim): nessun cliente attuale vede cambiare niente. Solo i mesi passano da «Jan Fév» a «Janv Févr», che e' la forma di Intl.
- Anche la «T» di trimestre era fissa: adesso e' una chiave nelle 5 lingue (T / Q / T / K / T).

### ♊ Le statistiche erano DUE copie identiche di 180 righe
- `src/pages/api/admin/stats.ts` e `src/lib/admin/calcolaStats.ts` contenevano lo stesso calcolo, con in cima il commento: «⚠️ Copia FEDELE… se cambi il calcolo lì, aggiornalo anche qui (e viceversa)».
- Le ho confrontate riga per riga: **non erano ancora divergenti**, differivano solo per i commenti e per l'involucro (risposta JSON contro valore di ritorno). Ma e' la terza duplicazione della giornata, e le altre due erano gia' divergenti: l'anteprima PDF (corretta in Assets, rotta in Impostazioni) e il rosso del secondo tempo su «Invia a tutti».
- ✅ L'endpoint ora **importa** `calcolaStats`: da 206 righe a 37, e non fa piu' nessun calcolo. La localizzazione delle etichette e' arrivata gratis su tutti e due i posti — se fossero rimaste due copie, l'avrei messa in una sola.
- **Un commento che dice «ricordati di aggiornare anche l'altro» non e' una protezione: e' la descrizione di un guasto che deve ancora succedere.**

### 🔢 «1000 recensioni tonde» — non era un limite di Google, era il nostro
- Enzo: «nella scheda vedo 1138 recensioni, nel filtro Tutte ne vedo 1000. E' un limite o un errore?». Un errore.
- 🐛 `GET /api/admin/google/reviews` faceva `select(...)` **senza `range`**, e **PostgREST rende al massimo 1000 righe per richiesta**, senza errore e senza avviso. Il numero tondo era il segnale. Il progetto conosceva gia' la trappola — `ordiniPagati` in `calcolaStats` pagina proprio per questo — ma qui non era stata applicata. Ora legge a pagine di 1000.
- 🐛 **La stessa trappola faceva un danno peggiore altrove**: prima di ogni sync si caricano gli id delle recensioni gia' note per capire quali sono NUOVE e mandare la notifica push al ristoratore. Anche quella `select` era troncata a 1000: oltre quella soglia delle recensioni vecchie risultavano nuove. **Con 1138 recensioni stava gia' succedendo.** Paginata anche quella.
- 🔇 Terzo punto, preventivo: il giro su Google si fermava a **40 pagine (2000 recensioni)** e buttava via il resto in silenzio. Alzato a 200 pagine (10 000) e, se il tetto viene toccato, adesso lo scrive nei log invece di sparire.
- ⚠️ Il numero mostrato potrebbe restare un filo sotto i 1138: la scheda conta il totale dichiarato da Google, la lista conta le recensioni che l'API ci consegna davvero. Se dopo un nuovo sync resta una differenza piccola e NON tonda, e' quello — non un troncamento.

## 📌 10/09/2026 — Varianti visibili nella card Ordini

### 🍕 Le pastiglie sotto il nome del piatto
- **Prima**: `2× Margherita — 33 cm (Sans gluten)`, una riga sola in cui piatto, formato e supplemento hanno lo stesso peso. In cucina si legge male.
- **Ora**: il nome del piatto in grande, e sotto le **pastiglie corallo** con variante e supplementi.
- **Le pastiglie sono allineate al NOME, non al numero**: rientrano di `calc(1.7rem + 0.6rem)`, cioe la larghezza del «2×» piu il suo gap. Cosi formano una colonna sotto il piatto invece di ripartire dal bordo della card — e' il dettaglio che fa leggere il blocco come una cosa sola.
- **Niente pastiglie = niente riga**: un piatto senza varianti resta identico a prima, la card non si allunga di un pixel.
- Vanno a capo da sole (`flex-wrap`): a cedere sono le pastiglie, **mai il nome del piatto**. Provato col caso difficile, «Calzone ai funghi porcini» con tre pastiglie in una card stretta.

### 🐛 Le varianti «non si salvavano»: erano salvate, non venivano LETTE
- Sintomo: metti le varianti, salvi, toast «piatto aggiornato», riapri la modifica e ci sono. **Ricarichi la pagina e spariscono.**
- Il toast era la prova decisiva: il PUT rispondeva **200 senza colonne scartate**, quindi la scrittura conteneva davvero le varianti. Il problema non era la scrittura, era la **prima lettura**.
- **Causa**: la pagina Menu nasce da dati **SSR** (`caricaMenuPagina()` in `lib/admin/caricaMenu.ts`), non da una chiamata all'API. E li la select era `MENU_SELECT_BASE + ", sold_out, name_i18n, desc_i18n"` — **senza `variants`**.
- Ecco perche' il sintomo sembrava assurdo: dopo il salvataggio la pagina fa `caricaTutto()`, che **passa dall'API** (che le varianti le legge) → si vedevano. Al reload i dati arrivano dall'SSR → sparivano. Stesso dato, due letture diverse, una sola incompleta.
- ⚠️ **Due liste di colonne che dovevano restare allineate e non lo erano**: `COLONNE_NUOVE` in `api/admin/menu.ts` e `MENU_SELECT` in `caricaMenu.ts`. La migrazione #71 ha aggiornato la prima e dimenticato la seconda. Ora `caricaMenu.ts` ha la sua costante `MENU_COLONNE_NUOVE` con il commento che dice a cosa va tenuta allineata.
- Corretto nella stessa passata anche il ripiego: se una colonna mancava, prima si ricadeva su `MENU_SELECT_BASE` perdendo **tutte** le colonne nuove. Ora se ne toglie **una alla volta**, come fa gia `conRipiego` nell'API.

### 🔑 «Non autorisé» dopo un'ora — il token non veniva mai rinnovato
- Segnalato come «le varianti non si salvano»: si mettevano, si vedevano, dopo un reload sparivano. Poi, provando di nuovo, «non autorizzato». **Non era un problema di varianti.**
- **Causa**: `headers = { Authorization: Bearer <token> }` veniva costruito **una volta sola al caricamento della pagina**. I token Supabase scadono (di norma dopo un'ora): un tab lasciato aperto continuava a mandare quello vecchio, e **ogni scrittura tornava 401 «Non autorisé»**.
- ⚠️ **Riguardava 8 pagine su 10**: `assets`, `clients`, `index`, `menu`, `orders`, `reservations`, `settings`, `stats`. Solo `agenda` e `google` erano a posto, perche avevano gia una `authFresh()` che rilegge la sessione a ogni chiamata.
- **Fix scelto — l'ascoltatore, non la riscrittura.** supabase-js rinnova il token da solo in background ed emette l'evento: basta un `onAuthStateChange` che riscrive `headers`. **Nessuna delle ~150 chiamate `fetch` e' stata toccata.** L'alternativa (mettere `await authFresh()` a ogni call site) era 8 file × ~20 punti, tutta superficie per sbagliare.
- Dove `headers` era `const` e' diventato `let` (5 pagine). Nelle altre 3 era gia' `let`.
- 🔎 **Perche' era cosi difficile da vedere**: il sintomo cambia col punto in cui capita. Nel modale del menu l'errore appare in un messaggio piccolo che si perde; altrove la lista si ricarica e sembra solo che il dato «non sia stato salvato». Da qui la pista sbagliata sulle varianti — e la caccia a un bug che stava due piani piu' sotto.

### 🛒 Modale «Nuovo ordine»: si sceglie il formato
- Il modale non mostrava le varianti: qualunque piatto si aggiungesse, partiva col prezzo base. **Il server invece le accettava gia'** (`rigaOrdine` legge `rich.variant` da un pezzo): mancava solo la scelta nell'interfaccia.
- **Nessun modale in mezzo**: un piatto con formati mostra il nome come testata (niente prezzo, niente +) e sotto una riga rientrata per formato, col suo prezzo e il suo +. Si sceglie dalla lista, in un colpo solo. Un piatto senza formati resta identico a prima.
- ⚠️ **La chiave del carrello e' diventata `id|formato`.** Con la sola `id`, aggiungere la Margherita da 45 dopo quella da 33 **sovrascriveva** la riga invece di aggiungerne una. Introdotto `RigaCart` con `variant`, `label` e `price` gia risolto (formato + sconto), cosi il resto del codice non deve piu' sapere se una riga ha un formato: totali, recap, «cosa cambia» e invio leggono `r.price` e `ncNome(r)`.
- **`ncAggiungi()` e' l'unico punto che scrive nel carrello** — prima la stessa riga era duplicata in tre posti (lista, preferiti, ricarica in modifica) e sarebbe diventata tre volte sbagliata.
- 🐛 **Preferiti: bug trovato mentre lo scrivevo.** L'API aggregava i piu' ordinati **sul solo `id`**, quindi il chip di un piatto con formati avrebbe mandato una riga senza formato → **409 dal server**. Ora aggrega su `id|formato` e restituisce `variant`: «Margherita 33» e «Margherita 45» sono due preferiti distinti. Piu' una rete di sicurezza lato client: piatto con formati e chiave mancante → si prende il primo disponibile.
- **Modifica di un ordine**: il carrello si ricostruisce col formato salvato. Senza, modificare un ordine con varianti lo avrebbe riscritto tutto sul formato base.
- Anche gli ordini creati a mano salvano ora `base_name` e `variant_label` (`rigaOrdine`), quindi le pastiglie valgono pure per loro.
- ⚠️ Errore evitato: avevo aggiunto `variants` a mano nella select di `piattiPerOrdine`, ma **`conRipiegoColonne` lo aggiunge gia'** (`MENU_COLONNE_NUOVE`). Sarebbe finita duplicata. Annullato.

### ⚠️ La modifica vera stava sotto, non nel CSS
- `checkout.ts` salvava sulla riga d'ordine **una stringa sola**, concatenata: nome + trattino + etichetta variante + supplemento fra parentesi. Per mostrare i pezzi separati l'unica strada sarebbe stata **spezzarla sul trattino lungo** — e si sarebbe rotta col primo piatto che ha un trattino nel nome.
- Aggiunti due campi **accanto** a `name`, non al suo posto: **`base_name`** e **`variant_label`** (il supplemento era gia in `notes`, la chiave variante gia in `variant`).
- ✅ **`name` NON e' stato toccato**: lo leggono le email al ristoratore, la stampa cucina e Stripe. Cambiarlo avrebbe rotto tutto quanto sta a valle per guadagnare niente.
- ✅ **Nessuna migrazione**: gli ordini vecchi non hanno `base_name` e il rendering ripiega da solo sulla riga piatta di prima. Vecchi e nuovi convivono nella stessa lista, con un solo `if` in un solo punto.
- **Da fare quando servira**: le stesse pastiglie nella **stampa cucina** e nelle **notifiche push**, che oggi usano `name` e restano com'erano.

### 📖 Home, tile «Menu»: i nomi al posto del numero
- «4 piatti» non dice QUALE: bisognava aprire il menu per scoprirlo. Ora la tile elenca i piatti fuori uso con la pastiglia: **grigia «Nascosto»** (fuori dal sito), **rossa «Esaurito»** (ancora a menu ma finito).
- **Nascosto vince su esaurito**: se il piatto non e' online, dire che e' esaurito non aggiunge niente al ristoratore.
- Ordine: prima gli **esauriti** (li vede anche il cliente sul sito), poi i nascosti. Massimo 4 + «+ N ancora…».
- Riusate le pastiglie dei Giorni speciali (`.spx-b`), aggiunto solo il grigio `.hid`. Nessun elemento nuovo.
- ⚠️ **Il select SSR della home non chiedeva `sold_out`** — stesso buco delle varianti in `caricaMenu.ts`, altro file. Aggiunto `MENU_SELECT_HOME` **con ripiego**: se la colonna manca (cliente indietro con le migrazioni) la query non fallisce intera, si rilegge senza. La home non puo' permettersi di restare senza dati per una colonna.
- `home.unavailable` non dice piu «(nascosti dal sito)»: adesso la sezione contiene due cose diverse.

### 🗓️ Home, tile «Giorni speciali»: si aggiornava solo ricaricando
- La lista della tile era disegnata **una volta sola** da una IIFE al load. Il form dentro la modale salvava, rileggeva, e la tile restava indietro.
- Il segnale c'era gia: `SpecialDaysForm` lancia `spf:loaded` su `document` dopo ogni aggiunta e ogni cancellazione. Mancava solo chi lo ascoltasse.
- Estratta `renderSpx(days)` dalla IIFE e agganciata all'evento: la tile si ridisegna **con i dati dell'evento**, senza un secondo fetch.
- Lezione: quando la stessa lista vive in due posti, il posto che la SCRIVE deve annunciarlo e il posto che la MOSTRA deve ascoltare. Un render dentro una IIFE non e' richiamabile da nessuno.

### 📧 Email: pastiglie in TUTTE, e una funzione sola
- La mail «Nuovo ordine» mostrava `Bruschette al pomodoro — test1` su una riga sola, esattamente il problema che avevamo appena tolto dalla card.
- Ora nome del piatto grande, e **sotto le pastiglie**: corallo la variante, grigia il supplemento. Stessa gerarchia della card Ordini.
- **Niente flex nelle email**: sono `span` `inline-block` con `border-radius:999px`, che si mettono in fila da soli. Outlook desktop squadra gli angoli e pazienza — la pastiglia si legge lo stesso, ed e la stessa forma gia usata dal badge «PAGATO» e dai bottoni di queste mail.
- **Il filetto sta sempre in fondo al blocco del piatto**: se ci sono le pastiglie e la loro riga a portarlo, altrimenti quella del nome. Prima il `↳` del supplemento cadeva SOTTO la linea, attaccato visivamente al piatto successivo.
- **Ordini vecchi**: senza `base_name` si ripiega sulla parentesi come prima. Nessuna migrazione, vecchi e nuovi nella stessa mail.
- `OrdineNotifica.items` ha ora `base_name?` e `variant_label?` **accanto** a `name`, mai al suo posto.
- **11/09** — fatto anche per la mail al CLIENTE (conferma) e per quella del **lien de paiement**: li la variante era ancora inline nel nome.
- Le tre email avevano **tre copie** della stessa riga d'ordine. Ora una funzione sola, `righeOrdineHtml(piatti, tema, skin)`: cambia la pelle (`SKIN_CLIENTE` 15px con margini, `SKIN_CUCINA` 19px a tutta larghezza), non la logica. La regola «ordini nuovi con `base_name`, vecchi con la stringa concatenata» sta in **un posto solo** — era il modo sicuro di non correggerne due su tre.
- **Resta fuori**: la mail «ordine modificato», che disegna un diff (barrato / +verde / freccia) su `ch.lines`, righe che non portano `base_name`. E la riga in **testo semplice** (`• 2× nome`), dove la stringa concatenata va benissimo.

### 🔴 Menu: pallino col numero di varianti accanto al nome
- Nella lista piatti un piatto con formati non si distingueva da uno senza: bisognava aprirlo per scoprirlo.
- Ora accanto al nome c'e' un **pallino corallo col numero di varianti** (`.i-vars`): stesso colore delle pastiglie della card Ordini, cosi la variante ha un solo colore in tutto l'admin.
- **Compare solo dove serve**: funzione «variants» accesa dal super admin E almeno una variante. Un piatto semplice resta identico a prima.
- Il segnale lato client e' lo stesso gia usato dal modale (`FEAT_VARIANTI` = presenza del pannello `#f-vars`), non un secondo flag da tenere allineato.
- `flex: none` come gli altri badge della riga: a stringersi e' sempre il nome (`.i-nm` con ellissi), mai il pallino.

## 🎟️ PROGETTO — FIDELITY CARD — idea impostata 08/09/2026 (da costruire)

**L'idea in una riga: la fidelity card NON è una card.** Il cliente è già identificato da telefono/email su ogni ordine e prenotazione. Una tessera fisica aggiunge un oggetto da perdere e una cosa da stampare, senza aggiungere informazione.

**Come si guadagna** — due modalità configurabili per cliente, non una imposta dal motore: **bollini** (10 pizze = 1 gratis, l'idioma della pizzeria) o **cashback in %**. Per 450 Gradi: bollini.

**Come si spende — e qui sta la scelta architetturale.** Al raggiungimento della soglia il motore **genera un coupon** intestato a quel cliente. Niente moneta nuova, niente logica di riscatto nuova: il sistema coupon esiste già, è validato al checkout ed è testato. **La fidelity PRODUCE coupon, non inventa un secondo circuito.**

**Dati: due cose sole.**
- **`loyalty_events`** — cliente, sede, ordine di riferimento, delta, motivo, data. **Append-only.** ⚠️ **Mai una colonna `saldo` modificabile sul cliente**: con le cose che somigliano a denaro si tiene il libro mastro e si somma, altrimenti il primo bug lascia saldi sbagliati senza modo di ricostruirli. Il saldo è una `SUM`, eventualmente in cache.
- **Configurazione in `app_config`** — modalità, soglia, premio, scadenza dei punti, e **quali canali contano** (ordine online, prenotazione onorata, entrambi).

**Multi-sede** (coerente con la sezione qui sotto): la carta segue il **cliente** (condivisa, `location_id` nullo), ma ogni evento registra **dove** è maturato e dove è stato speso. Stesso schema dei buoni regalo, e serve alla stessa cosa: compensare fra società diverse.

⚠️ **IL LIMITE VERO, da dire al cliente prima di venderla.** Oggi il motore vede solo ordini online e prenotazioni: **chi entra, mangia e paga in cassa non accumula niente**, ed è la maggioranza dei clienti di una pizzeria. Tre modi per chiuderlo: (1) il cameriere digita il telefono nell'admin — attrito basso, funziona subito; (2) QR sullo scontrino che il cliente scansiona; (3) aspettare **Service en salle**, già in roadmap, che lo risolve alla radice. **Partire da (1), progettare per (3).**

### ✅ FATTO 08/09: gli switch (solo quelli)
- ❌ **Primo tentativo sbagliato, annullato**: avevo messo `fidelity` fra le **funzioni opzionali** (`FUNZIONI_OPZIONALI`), con lo switch che nascondeva il tab «Promozioni». Sbagliato perche' **il meccanismo giusto esisteva gia'**: Marketing ha i suoi **sotto-tab** (Pop-up, Newsletter, Coupon, Buoni regalo) governati da `TABS_ADMIN` + `admin_tabs_hidden`. Un secondo meccanismo per la stessa cosa, e per di piu' uno solo per due funzioni diverse.
- ✅ **Fatto invece**: due sotto-tab nuovi in `TABS_ADMIN.marketing` — **`promos` (Promozioni)** e **`fidelity` (Fedeltà)** — che compaiono come pillole sotto lo switch Marketing nel super admin, accanto alle altre quattro. **Separati**, perche' sono due cose distinte: le promozioni sono regole di prezzo automatiche, la fedelta e' un programma a punti. Un cliente puo' volere l'una senza l'altra.
- In `marketing.astro`: due tab e due pannelli distinti (`#tab-promos`, `#tab-fidelity`), per ora entrambi «Prossimamente».
- ⚠️ **I pannelli restano SEMPRE nel DOM**, li spegne il super con `data-off="1"`: `mostraTab` e i listener li cercano per id e morirebbero su null. Trappola gia' annotata per gli altri tab, riusata invece che reinventata.
- **Nessuna funzione opzionale aggiunta**: `FUNZIONI_OPZIONALI` resta con la sola `variants`.

### Dove si attiva e si configura — entrambi i posti ESISTONO GIA'
- **Super admin → Réglages → Pagine visibili → Marketing**: le due pillole **Promozioni** e **Fedeltà**, accanto a Pop-up / Newsletter / Coupon / Buoni regalo. Stesso meccanismo di tutti gli altri sotto-tab (`TABS_ADMIN` + `admin_tabs_hidden`), nessuna invenzione.
- **Marketing → tab «Fedeltà»**: dove il ristoratore configura il programma. **Marketing → tab «Promozioni»**: le regole di prezzo. Separati.
- Dentro: interruttore acceso/spento del programma (diverso dal livello super — il modulo puo' esserci ma essere in pausa), modalita bollini/cashback, soglia e premio, canali che contano, scadenza. Piu' **un'anteprima della frase che ricevera' il cliente**: la soglia si sceglie guardando quella, non in astratto.
- **Il premio punta al sistema coupon**: in quella schermata si sceglie o si crea il coupon da emettere. E' li' che si chiude il cerchio — la fidelity non inventa una moneta, produce coupon.
- Il tab Promozioni si nasconde quando il modulo e' spento, con lo stesso meccanismo che gia' nasconde la colonna ordini quando il modulo ordini e' spento.

### Adesione e interfaccia — deciso 08/09 (prima ipotesi corretta)
- **Ipotesi iniziale**: checkbox al checkout «Vuoi i vantaggi fedeltà? sì/no» + tab «Fidelity» nella lista clienti con gli opted-in. **Scartata.**
- ❌ **Niente checkbox al checkout.** Ogni casella in più è attrito, e l'attrito al checkout si paga in ordini persi. Ma il problema peggiore e' un altro: chi non spunta ordina dieci pizze e non guadagna niente, poi lo scopre e se la prende col ristorante. Il programma partirebbe dal giorno in cui il cliente ha notato una casella, non dal primo ordine.
- ✅ **Si accumula per TUTTI, in silenzio.** I dati ci sono gia': ordini, telefono ed email si salvano comunque per evadere l'ordine, e sommare non richiede un permesso in piu'. Il momento del contatto diventa il **premio**: al superamento della soglia parte l'email «hai una pizza gratis». Il cliente scopre il programma li', ed e' una bella notizia invece di una domanda.
- **Il consenso sta sull'EMAIL, non sull'accumulo** — e la macchina esiste gia': `newsletter_optout` sui clienti, con le pillole «Opted-in / Opted-out» gia' nella pagina. Chi si e' disiscritto non riceve la mail del premio. (Formulazione dell'informativa da far confermare a chi segue la privacy: l'aritmetica no, la comunicazione commerciale si'.)
- **Se si vuole usare comunque quello spazio al checkout**, va girato al contrario: «Questo ordine ti dà 1 bollino — te ne mancano 4». Stessi pixel, effetto opposto: non chiedi al cliente di fare una cosa, gli dai un motivo per tornare.
- ❌ **Nella lista clienti: NON un tab, una pillola.** Quella pagina non ha tab, ha filtri a pillola (Nuovo, No-show, Opted-in, Opted-out): una barra di tab sarebbe un elemento nuovo dove non serve.
- ✅ E cambia **cosa** filtra: se accumulano tutti, «chi ha aderito» e' un elenco di nomi senza niente da farci. Le due liste che il ristoratore usa davvero sono **«vicini al premio»** e **«premio da usare»** — sulla prima manda una spinta, sulla seconda sa di avere un conto aperto. Piu' una **colonna coi bollini**, accendibile dal selettore colonne.

**Cosa NON fare**: punti con tasso di conversione, livelli bronzo/argento/oro, scadenze aggressive — complessità che il ristoratore non gestisce e che il cliente non capisce. E i punti maturati sono un **debito**: servono una scadenza dichiarata e due righe di condizioni, altrimenti te li porti dietro per sempre.

---

## 🏢 MULTI-SEDE — DECISO 08/09/2026 (caso reale: 450 Gradi, 3 punti a Bruxelles)

**Sostituisce lo scenario del 24/07 qui sotto**, che consigliava N installazioni separate. La decisione si è ribaltata quando sono usciti i requisiti veri del cliente: la condivisione che vogliono è troppa perché tre installazioni possano darla.

**Il cliente**: 450 Gradi, pizzeria napoletana, **tre società separate** (Schaerbeek, Jourdan, Stockel), un marchio solo, sito unico. Menu identico nei tre punti.

**Scelta: UNA installazione, `location_id`, interruttore nel super admin.**

- **`location_id` NULLABLE, e NULL significa «vale per tutte le sedi».** È il perno di tutto il disegno e regala due cose: (1) le righe che esistono oggi hanno NULL → **per La Molisana, ChouChou, L'Huile ed EN non cambia NIENTE**; (2) la regola di lettura `location_id = sede OR location_id IS NULL` dà la condivisione senza un secondo meccanismo.
- **Interruttore `multi_location`** in `app_config` (super admin). Spento: nessun selettore, ogni scrittura mette NULL, ogni lettura ignora la colonna. Acceso: selettore di sede nell'header, le scritture timbrano la sede corrente, il super vede tutto. **Va scritto PRIMA del resto: è la rete di sicurezza per i clienti live.**

**Cosa è condiviso (sede NULL)** — menu, categorie, formule, menu fissi, **clienti**, coupon, pop-up, newsletter, **buoni regalo**, agenda, note, documenti.

**Cosa è per sede** — prenotazioni, tavoli, zone e chiusure, giorni speciali, ordini, recensioni Google, statistiche, personale, iscrizioni push, **e i riscatti dei buoni**.

**Due tabelle nuove:**
- `locations` — nome, slug, indirizzo, telefono, attiva, + una colonna JSON con orari, servizi, zone e contatti della sede. **Le impostazioni per sede NON vanno in `app_config`**: quella tabella è letta ovunque e cambiarle la chiave primaria sarebbe la parte più invasiva del lavoro. `app_config` resta globale (brand, tema, lingue).
- **disponibilità del menu per sede** — l'esaurito NON è una proprietà del piatto, è della coppia *piatto + sede*. Deve puntare al piatto **o alla singola variante** (oggi l'esaurito esiste a due livelli: `is_sold_out` sul piatto, `sold_out` sulla variante), con la stessa convenzione: variante nulla = tutto il piatto. Stessa tabella pronta per prezzi o visibilità per sede, se un giorno servono.

**Sito pubblico: sottocartella, non cookie** — `/schaerbeek/…`, `/jourdan/…`, `/stockel/…`. Tre punti sono tre schede Google e tre bacini locali: con URL distinti ognuno si posiziona per conto suo, con un cookie non si posiziona nessuno. La pagina *Locations* diventa lo smistatore.

**Statistiche**: selettore di sede con «Tutte le sedi» in più. L'aggregato è una vista di **gestione**; gli export per il commercialista restano per sede, perché sono tre contabilità.

### ⚠️ Quello che il software NON risolve (da mettere per iscritto FRA I TRE SOCI)
- **Un database clienti in comune fra tre società = contitolarità del trattamento.** Serve una riga nell'informativa e un accordo fra loro.
- **Buono comprato a Schaerbeek e speso a Jourdan = Jourdan regala pizza contro soldi incassati da Schaerbeek.** Il motore registra *dove* il buono viene riscattato, quindi a fine mese la tabella di chi deve cosa a chi c'è — ma la compensazione fra le tre società è un accordo commerciale, da fare prima che succeda. Idem, in piccolo, per i coupon.
- **Tre società = tre conti Stripe**, mentre un'installazione ha una `STRIPE_SECRET_KEY` sola → chiavi per sede nell'`.env` (l'ambiente lo controlli tu) e webhook separati per punto. Stessa cosa per la scheda Google, oggi una per installazione.
- **Il rischio vero non è la difficoltà, è il filtro dimenticato.** Con tre società nello stesso Postgres, una query senza `location_id` non è un bug: è Schaerbeek che vede i clienti di Stockel. Il filtro deve passare da **un punto solo** e va testato apposta. `supabaseAdmin` usa la service role key e **bypassa RLS**, quindi la disciplina sta nel codice, non nel database.

**Sequenza proposta**: `locations` + interruttore + selettore + spina dorsale prenotazioni/ordini (quello che serve a 450 Gradi per aprire) → statistiche e marketing per sede in una seconda passata. **Su un branch, mergiato una volta sola e testato**, mai a pezzi dentro i giri di merge normali.

**Aperto, da chiedere al cliente**: di chi è il marchio (dove vive il sito vetrina), se la consegna resta su Uber Eats (oggi è così → il nostro ordine sarebbe solo asporto), le lingue pubbliche (Bruxelles: FR/NL oltre all'inglese?), e se ci sono prenotazioni da recuperare dal widget attuale.

---

## 🏢 MULTI-SEDE (più punti, sito unico) — ~~scenario studiato 24/07~~ SUPERATO dalla sezione qui sopra

- **A — nativo (futuro, dopo Service en salle)**: un Supabase, `location_id` ovunque, selettore sede nell'header, permessi per sede, UN CRM/newsletter. Refactor profondo (settimane).
- **B — N motori + sito vetrina (CONSIGLIATA per il primo caso)**: un'installazione per punto su sottodomini; la vetrina fa scegliere il punto (widget embeddabile). Zero modifiche = N× SETUP.md. Contro: CRM/stats separati, login multipli (mitigabile: stesso utente nei N Supabase).
- **Percorso**: B subito → migrazione ad A (import taggando location_id). **Disciplina**: ogni tabella nuova si disegna chiedendosi «del ristorante o della sede?».

## 📋 PROGETTO — Service en salle (V1 cameriere + V2 QR cliente) — spec approvate 23/07

**SESSIONE TAVOLO** (`table_sessions`, con `location_id` dal giorno uno); i round si mischiano sulla stessa card.
- **V1**: PIN in Réglages → Team → `/service` (token scope service, NON login admin; cambio-cameriere rapido) · tavolo dalla griglia del plan · articoli → card TABLE in Commandes · round con orario · «Demander l'addition» → Terminée·Non payée (bordeaux) → «Encaissé» → Payée. Annullo articolo ~2 min poi solo admin; tavolo extra a testo libero; note per articolo.
- **V2**: QR generico → tavolo + PIN GENERATO (privacy) → menu → dati+GDPR+Stripe a ogni round (`source:"qr"` → CRM) → card già pagata → auto-FATTO 1h dall'ultimo round · switch in Réglages.
- Dati: `team.pin` · `table_sessions` (table_name, zone, covers, waiter, client_pin, reservation_id→spent_cents, status, orari, total) · round su orders. `/api/staff/login {pin}` · tab «Tables» · print_jobs per round. V3+: conto aperto, divisione, mance, fire.

## ⚙️ IL MOTORE — funzionalità (stato al 24/07)

- **Pagine admin**: Accueil (tile masonry, note taggate, daily brief, **eventi locali** ✅) · Commandes (+ manuali con link di pagamento, rimborsi) · Réservations (motore V1, plan de salle 2 fasi, viste Jour/Semaine/Mois, pallino occupazione, Demandes, chiusure anche permanenti) · Clients (CRM v2, blocco, foto) · Menu (Plats/Boissons/Lunch ✅/Menus ⬜, permessi per tab, FAB contestuali) · Statistiques · Marketing (pop-up, **Newsletter 2.0**: segmenti lingua×gruppo, programmate/ricorrenti #39, brouillons, 2 bottoni, card con rilancio; coupons; **Bons cadeaux** ✅ 28/07) · Assets · **Admin** (8 tab: Général, Horaire, Réservations, Cuisine, Liens, Team, **Documents+disdetta** #40, Notifications) · **Réglages** (permessi pagine+tab, **Design**).
- **Eventi locali** (Accueil): + sulla tile Jours spéciaux → modale (nom, datepicker, «chaque année», elimina 2 tap); mescolati alle feste belghe, nome in accent, tag Ouvert/Fermé; `app_config.custom_events` via `/api/admin/events` (niente migrazione).
- **Stripe PIGRO** via Proxy: il motore parte senza chiave; errore solo all'uso reale. Chiavi cliente per-cliente (webhook legata ad account+endpoint, MAI riusabile); `MOODD_STRIPE_SECRET_KEY` unica (crediti newsletter, meglio test-mode nel dev).
- **Email**: Resend v6 (`replyTo`), batch 100; template = documento HTML completo con body bgcolor; immagini con URL pubblici; lettera résiliation bianca serif.
- **Auth**: JWT ES256 + SSR cookie; super admin hardcoded; permessi per pagina E tab con anti-flash.
- **Middleware**: method-override (WAF Hostinger blocca DELETE mobili) + 301 www. `checkOrigin: false` (Bearer = sicuro).
- **PWA**: manifest standalone, installabile (iPhone: Aggiungi a Home) — push in progetto.

## 🗃️ SCHEMA DB (migrazioni #1-50, tutte idempotenti)

`menu_items` · `settings` · `orders` (+source, cancel_token, refund #41, **payment_method** cash/card/link #49, **supplement_due/paid + refund_due** differenza modifica #50) · `app_config` (timezone, admin_pages/tabs_hidden, **admin_theme**, **admin_lang**, **public_languages/public_lang_default** (lingue pubbliche, no migrazione), **custom_events**, home_layout, daily_brief_*, restaurant_name, company_*, brand_*, reservation_*, closures_permanent, link_*) · `special_days` (+services #33) · `admin_notes` (+tags #34) · `restaurant_tables` (#36) · `lunch_menus` (#38) · `newsletter_schedule` (#39) · `admin_docs_meta` (#40) · `newsletter_log/optout/credits` · `menu_categories` (+kind) · `coupons` · `team` · `clients` (+hidden/photo/blocked) · `popups` · `reservations` (source, review, options, seated, table_time, spent, tables #37, client_action_at #42, recontact #43) · `service_closures` · `zone_closures` · **`push_subscriptions`** (#44) · **`gift_cards`** + **`gift_card_redemptions`** (#45: buoni regalo, saldo scalabile, pay_token, ship_*, payment_method/paid; colonne `gift_card_*` su orders). **`gift_card_orders`** (#46: acquisto buoni fisici da MOODD). **`page_views`** + RPC `traffic_sources` (#47: analytics interno cookieless, sources de trafic). `reservations.reminder_sent_at` (#48: rappel cliente 3h prima). **`print_orders`** (#68: ordini prodotti stampati acquistati da MOODD, Stripe MOODD, snapshot). **`reservations.extra_minutes`** (#69: estensione tavolo +15/+30/+45). RLS ovunque; GRANT in ogni migrazione (auto-expose OFF). pg_cron per cliente (**5 job**, x-cron-key): `auto-complete-orders` + `daily-brief` + `newsletter` + `reservation-reminders` + `google-reviews-hourly` (vedi SETUP.md §6 / NUOVO_PROGETTO.md). **Ogni cliente il suo Supabase**: i cron NON si ereditano. Future: team.pin, table_sessions (+location_id).

## 🎨 Design system

**Default MOODD**: sopra. **Semantici fissi**: ok `#2e9e6b` · blu `#3b82f6` · err `#ff8a8f` · bordeaux `#d24d55` · rosso `#ed1c24` · mattone `#a3320f`. Font: Bebas Neue (icone -1.5px) + Nunito Sans. Convenzioni UI: bin conferma 2 tap · elementi off scuri/soft · FAB shrink · filtri a pillole accent coi contatori · card non righe · datepicker brand (z 420 negli overlay).

## ⚠️ Lezioni tecniche

- GRANT ogni tabella. Mai `.remove()` prima dei binding. Anti-flash = cache sincrona + CSS pre-paint.
- **Env valutate all'import**: un throw a livello modulo per una chiave OPZIONALE uccide il motore all'avvio → lazy (Proxy/guard); obbligatoria solo Supabase.
- **File .sql nel repo ≠ indicizzati**: la riga in MIGRATIONS.md fa parte della migrazione (caso #41-42).
- **Conversioni CSS di massa**: `box-shadow` multi-riga sfuggono alle regex per-riga; l'ordine delle replace conta (il testo nuovo può contenere l'ancora → assert prima); i fallback JS (meta theme-color) NON si convertono in var(); gli **attributi SVG non supportano var()** → passare da `style=`.
- **Tema chiaro su motore nato scuro**: serviva il token texte principal; i bianchi su sfondi SEMANTICI restano fissi; le tinte di sfondo del vetro non scalano con lo slider ombre.
- Secret in 2 posti si disallinea (job «succeeded» ma 401) → rotazione. checkOrigin ≠ WAF (rebuild per astro.config).
- ⚠️ **PostgREST tronca a 1000 righe**: una `select()` senza `.range()` ne rende al massimo mille, SENZA errore e senza avviso — il numero tondo e' l'unico indizio. Ogni lettura che puo' superare la soglia va fatta a pagine (schema: `ordiniPagati` in `calcolaStats.ts`).
- Storage senza metadati → tabella sidecar path-keyed best-effort. Log estesi = insert ricco + retry basico, retrocompatibili.
- Ancore python: substring/indentazioni → includere la riga precedente; marker univoci; assert fallito = niente scritto.
- **Stripe pigro = errori silenziosi**: senza `STRIPE_SECRET_KEY` (dev) la creazione di un lien de paiement fallisce e l'email parte senza bottone → far sempre RISALIRE l'errore all'UI (toast) invece del solo `console.error`. Stesso ragionamento per Resend.
- **pdf-lib**: font standard = solo WinAnsi → ripulire il testo (apostrofi tipografici, trattini lunghi, NBSP) prima di `drawText`, altrimenti lancia.
- **Saldi**: scalare con optimistic lock (`.eq("balance_cents", valoreLetto)`) + ledger a parte; il saldo è una cache, la verità sono le righe dei riscatti.
- **Migrazione viva**: durante una sessione lo schema può crescere più volte — tenere il file idempotente (`add column if not exists`) e ridare a Enzo l'SQL COMPLETO ogni volta, invece di frammenti.
- Datepicker: z-index 420 sopra gli overlay (300). Fix «fatti» verificati col grep nel repo. Fuso device ≠ ristorante.
- `<style is:global>`; ES256 ieee-p1363; SSR cookie con `<` escapato; narrowing TS; live binding ESM.

## 🔧 Metodo di lavoro (Cowork + Enzo)

- **MAI secret/chiavi in chat** (se succede → rotazione immediata). Git SOLO dal terminale di Enzo (Mac o Cursor, è lo stesso), comandi senza `cd`: generico `git -C <repo> add -A && git -C <repo> commit -m "..." && git -C <repo> push`. `npx astro check` SOLO dal Mac (VM = binari macOS → Exec format error).
- Cowork: device_bash sul mount `/sessions/<id>/mnt/MOODD-Admin`; stage/commit files coi path REALI `/Users/moodd/Developer/...`; niente DELETE sul device (`mv` in `_to_delete/`, svuota Enzo). Bridge: 502 → aspettare; uno stage può perdere un file (ricontare, ristagliare); staged stantia → `rm` prima di ristagliare.
- ⚠️ **esbuild NON vede le variabili non dichiarate**: sostituendo le due righe che definivano `const lb` e lasciando la terza che lo usava, il file compilava e la vista Settimana/Mese moriva a runtime (ReferenceError, lista vuota e filtri bloccati). Dopo ogni patch che TOGLIE una dichiarazione, controllare a mano che il nome non sia usato altrove (`grep "nome\."`). Solo `astro check` lo prende, e lo lancia Enzo.
- Patch: python heredoc con ancore esatte + `assert count==1` (fallito = nulla scritto). File nuovi: `cat > file <<'EOF'` via device_bash, o Write→SendUserFile→device_commit_files. Verifica sintassi: stage fresco → estrazione `<script>` → esbuild nel container.
- Enzo: non-expert dev, rispondere in ITALIANO, comandi passo-passo espliciti. Conferma prima di toccare file. Admin UI in FRANCESE.
- Diario aggiornato a ogni sessione; push a fine giro; migrazioni le lancia Enzo dal SQL Editor.

## Infrastruttura

- **GitHub**: `MOODDVS/MOODD-Admin` (template) · repo per cliente. Mac: `/Users/moodd/Developer/MOODD-Admin` (in Cowork).
- **Supabase dev**: progetto «MOODD-Admin» (Frankfurt). · **Hosting clienti**: Hostinger Node ≥ 22 (WAF: override; checkOrigin false già nel motore).
- Clienti attuali: **La Molisana** (LIVE — 27/07 allineata col blocco PUSH: merge pulito 0 conflitti, migrazione **#44** lanciata, chiavi **VAPID** su Hostinger, notifiche push attive. In precedenza già a `engine/main` 5dab4a9 con #41-43, tema scuro pinnato, cron ok). · **EducazioneNapoletana** (LIVE su admin vecchio → da ricostruire come EN v2 sul motore, vedi 25/07).
