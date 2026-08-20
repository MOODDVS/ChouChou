# RestoHub — Motore multi-cliente · Avanzamento & decisioni

Diario del MOTORE (template `MOODDVS/MOODD-Admin`). I clienti hanno i loro progetti Claude (es. «La Molisana»). Aggiornato man mano.

## 📌 20/08/2026 — sessione Cowork (Mac mini)

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
- **🏢 MULTI-SEDE — scenario studiato** (sezione dedicata): strada B subito quando serve, nativo dopo Service en salle.
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
- Trigger: nuova prenotazione dal sito · nuovo ordine dal sito · annullo/modifica del cliente. Tap → pagina giusta.
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

## 🏢 MULTI-SEDE (più punti, sito unico) — scenario studiato 24/07

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

`menu_items` · `settings` · `orders` (+source, cancel_token, refund #41, **payment_method** cash/card/link #49, **supplement_due/paid + refund_due** differenza modifica #50) · `app_config` (timezone, admin_pages/tabs_hidden, **admin_theme**, **admin_lang**, **public_languages/public_lang_default** (lingue pubbliche, no migrazione), **custom_events**, home_layout, daily_brief_*, restaurant_name, company_*, brand_*, reservation_*, closures_permanent, link_*) · `special_days` (+services #33) · `admin_notes` (+tags #34) · `restaurant_tables` (#36) · `lunch_menus` (#38) · `newsletter_schedule` (#39) · `admin_docs_meta` (#40) · `newsletter_log/optout/credits` · `menu_categories` (+kind) · `coupons` · `team` · `clients` (+hidden/photo/blocked) · `popups` · `reservations` (source, review, options, seated, table_time, spent, tables #37, client_action_at #42, recontact #43) · `service_closures` · `zone_closures` · **`push_subscriptions`** (#44) · **`gift_cards`** + **`gift_card_redemptions`** (#45: buoni regalo, saldo scalabile, pay_token, ship_*, payment_method/paid; colonne `gift_card_*` su orders). **`gift_card_orders`** (#46: acquisto buoni fisici da MOODD). **`page_views`** + RPC `traffic_sources` (#47: analytics interno cookieless, sources de trafic). `reservations.reminder_sent_at` (#48: rappel cliente 3h prima). RLS ovunque; GRANT in ogni migrazione (auto-expose OFF). pg_cron per cliente: `daily-brief-hourly` + `newsletter-hourly` + `resa-reminders-30min` (x-cron-key). Future: team.pin, table_sessions (+location_id).

## 🎨 Design system

**Default MOODD**: sopra. **Semantici fissi**: ok `#2e9e6b` · blu `#3b82f6` · err `#ff8a8f` · bordeaux `#d24d55` · rosso `#ed1c24` · mattone `#a3320f`. Font: Bebas Neue (icone -1.5px) + Nunito Sans. Convenzioni UI: bin conferma 2 tap · elementi off scuri/soft · FAB shrink · filtri a pillole accent coi contatori · card non righe · datepicker brand (z 420 negli overlay).

## ⚠️ Lezioni tecniche

- GRANT ogni tabella. Mai `.remove()` prima dei binding. Anti-flash = cache sincrona + CSS pre-paint.
- **Env valutate all'import**: un throw a livello modulo per una chiave OPZIONALE uccide il motore all'avvio → lazy (Proxy/guard); obbligatoria solo Supabase.
- **File .sql nel repo ≠ indicizzati**: la riga in MIGRATIONS.md fa parte della migrazione (caso #41-42).
- **Conversioni CSS di massa**: `box-shadow` multi-riga sfuggono alle regex per-riga; l'ordine delle replace conta (il testo nuovo può contenere l'ancora → assert prima); i fallback JS (meta theme-color) NON si convertono in var(); gli **attributi SVG non supportano var()** → passare da `style=`.
- **Tema chiaro su motore nato scuro**: serviva il token texte principal; i bianchi su sfondi SEMANTICI restano fissi; le tinte di sfondo del vetro non scalano con lo slider ombre.
- Secret in 2 posti si disallinea (job «succeeded» ma 401) → rotazione. checkOrigin ≠ WAF (rebuild per astro.config).
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
- Patch: python heredoc con ancore esatte + `assert count==1` (fallito = nulla scritto). File nuovi: `cat > file <<'EOF'` via device_bash, o Write→SendUserFile→device_commit_files. Verifica sintassi: stage fresco → estrazione `<script>` → esbuild nel container.
- Enzo: non-expert dev, rispondere in ITALIANO, comandi passo-passo espliciti. Conferma prima di toccare file. Admin UI in FRANCESE.
- Diario aggiornato a ogni sessione; push a fine giro; migrazioni le lancia Enzo dal SQL Editor.

## Infrastruttura

- **GitHub**: `MOODDVS/MOODD-Admin` (template) · repo per cliente. Mac: `/Users/moodd/Developer/MOODD-Admin` (in Cowork).
- **Supabase dev**: progetto «MOODD-Admin» (Frankfurt). · **Hosting clienti**: Hostinger Node ≥ 22 (WAF: override; checkOrigin false già nel motore).
- Clienti attuali: **La Molisana** (LIVE — 27/07 allineata col blocco PUSH: merge pulito 0 conflitti, migrazione **#44** lanciata, chiavi **VAPID** su Hostinger, notifiche push attive. In precedenza già a `engine/main` 5dab4a9 con #41-43, tema scuro pinnato, cron ok). · **EducazioneNapoletana** (LIVE su admin vecchio → da ricostruire come EN v2 sul motore, vedi 25/07).
