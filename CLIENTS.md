# CLIENTI — stato di allineamento col motore

Registro di quali installazioni girano sul motore (`MOODDVS/MOODD-Admin`) e quanto sono allineate.
Aggiornare a ogni merge/deploy di un cliente. Vedi `SETUP.md` (setup), `NUOVO_PROGETTO.md` (checklist nuovo cliente), `supabase/` (migrazioni).

**Motore — riferimento attuale:** `main` (09/10/2026, `70406ee` — il marchio in fondo al bancone).

> ⚠️ **Da dove si aggiornano i clienti: `engine/main`, e basta.** Il ramo `multi-sede`
> ha fatto il suo lavoro — il multi-sede e' nel motore e tutti e sei i clienti ci sono
> sopra — ed e' stato riportato su `main` il 04/10. Per un periodo la ricetta scritta
> qui diceva `engine/main` mentre i merge veri si facevano da `multi-sede`: due verita'
> diverse nello stesso documento, che e' il modo piu' rapido di aggiornare un cliente
> dal ramo sbagliato senza accorgersene. Adesso ce n'e' una sola.

> **La versione PRE multi-sede** resta raggiungibile per sempre dal tag
> **`single-location`** (`cf58d40`, 13/09/2026): `git checkout single-location`.

## Legenda stato
- 🟢 **Allineato** — a pari col motore (HEAD attuale), migrazioni applicate.
- 🟡 **Parziale** — allineato a una data passata; mancano commit motore recenti e/o migrazioni.
- 🔴 **Indietro** — molto distante dal motore, richiede merge importante.
- ⚫ **Fuori motore** — non gira sul motore (da ricostruire).
- 🔵 **In allestimento** — clonato dal motore, non ancora in linea: manca ancora qualcosa della checklist nuovo cliente.

## Quadro

| Cliente | Stato | Hosting | Dominio | Lingue | Ultimo allineamento | Note |
|---|---|---|---|---|---|---|
| **450 Gradi** | 🟢 Allineato | Hostinger | 450gradi.be | en | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | **il solo multi-sede vero** (Schaerbeek, Stockel, Jourdan); dizionario fr presente ma non esposto: nessun selettore lingua. Cron `pg_cron` creati il 03/10. ⚠️ fino al 06/10 questa riga diceva `e3e863a`: non c'era mai arrivato (vedi il giro del 06/10) |
| **La Molisana** | 🟢 Allineato | Hostinger (EU) | lamolisana.be (live) | fr/en | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | modale di prenotazione senza involucro (solo widget + bottone Fermer), suo |
| **Comptoir ChouChou** | 🟢 Allineato | Hostinger | comptoirchouchou.be (live) | fr/en | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | ⚠️ widget molto personalizzato: due auto-merge gli hanno gia' mangiato dei pezzi |
| **L'huile sur le feu** | 🟢 Allineato | Hostinger | lhuilesurlefeu.be | fr/en/it/nl | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | pagina di annullo nelle sue 4 lingue |
| **Educazione Napoletana** | 🟢 Allineato | Hostinger | educazionenapoletana.be | fr/en/it | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | pagina di annullo anche in italiano. **Ticket di cucina suo** (`config/ticket.ts`, commit `e32521e`): «Forza Napoli!» sotto l'insegna, nota dell'ordine sopra i piatti, conto dei pezzi sulla riga di servizio. Stampante collegata e prova uscita il 07/10 |
| **BROS** | 🟢 Allineato | Hostinger | brospizza.be | fr/en/it | **merge `70406ee` — 09/10/2026** (il marchio in fondo al bancone; incassi, resi e articoli piu' ordinati nella Accueil) | sesto cliente. Pagamento **al ritiro** (nessuna chiave Stripe); pagina di annullo propria (`AnnullaOrdine.astro`). ⚠️ migrazione #75 da lanciare su Supabase |
| **L'Aperitivo** | 🔵 In allestimento | — | brasserieaperitivo.be (sito WordPress attuale) | fr | **clone `70406ee` — 09/10/2026** | settimo cliente, allestimento iniziato il 09/10. Fatti: demo cancellati, `client.ts` coi recapiti veri (dal sito attuale), `site`, `manifest.json`. Mancano: loghi e icone, Supabase + `TUTTO.sql` + bucket, env, Stripe, Resend, sito pubblico, super admin |

✅ **Tutti e sei allineati e deployati** (09/10/2026, `70406ee`). Il settimo, L’Aperitivo, e' in allestimento. **450 Gradi e Educazione Napoletana** sono anche sulla **stampa dei ticket** (05/10, `e3e863a`, zero conflitti in tutti e due).

⚠️ **Per chi prende la stampa servono tre cose, e due stanno fuori dal codice:**
1. **`TUTTO.sql`** nel suo Supabase — porta la coda (#76) e il ticket per stampante (#77). Da oggi si puo' rilanciare su un database vivo senza riscrivere niente.
2. **`PUBLIC_SITE_URL`** fra le variabili su Hostinger (`https://www.450gradi.be`, `https://educazionenapoletana.be`…): e' l'indirizzo che il tablet va ad aprire. Senza, la coda non accoda e lo scrive solo nei log.
3. La stampante si sceglie nel **super**: **Sedi → matita → Impression** se il cliente ha piu' punti, **Intégrations → Impression** se ne ha uno solo.
4. **L'interruttore della stampa automatica ACCESO.** ⚠️ La «prova di stampa» del pannello chiama `mandaStampa` diretto (`api/admin/printers.ts`): salta la coda **e** salta l'interruttore. Un ordine vero passa da `accodaTicket`, che si ferma secco se `print_auto` non e' `1` con la stampante scelta. Prova uscita + switch spento = la stampa «funziona» e in cucina non arriva mai niente, senza un errore da nessuna parte. **Dopo la prova, un ordine vero da un pezzo.**
5. **Le chiavi senza virgolette.** Incollando `BIZPRINT_SECRET_KEY="abc"` nel pannello dell'hosting le virgolette restano dentro il valore: il servizio risponde `401`, che si legge come «stampante assente». Dal commit `5b912d6` il motore le spoglia da solo e il 401 dice le lunghezze delle due chiavi (assente = 0, virgolette = due caratteri di troppo, invertite = lunghezze scambiate).

## ⚠️ Il giro del 04/10: 4 clienti su 6 rotti dall'AUTO-MERGE

Nessun conflitto segnalato, in nessun caso. Git ha fuso due versioni entrambe
valide e il difetto è nato dal loro incontro — che è precisamente ciò che un
auto-merge non può vedere. **Uno l'ha preso un test, gli altri tre sono emersi
guardando i file a mano.** I due punti da controllare a ogni merge:

| File | Cosa succede | Visto su |
|---|---|---|
| `src/components/ReservationWidget.astro` | Il cliente ha già un blocco `@media (pointer: coarse)` (il suo datepicker). Il motore ne aggiunge un altro per i 16px dei campi. Git vede due blocchi che **cominciano uguale** e ne tiene uno solo: **i 16px spariscono** e su iPhone toccare un campo ingrandisce la pagina. | ChouChou, L'Huile |
| `src/pages/order/cancel.astro` | La pagina del cliente ha i testi in 2 lingue e fa `lang = j.lang` secco. Dal 03/10 l'API risponde la lingua **vera** dell'ordine (fr/en/it/nl/es): `T["it"]` = `undefined` e **la pagina muore**. | 450 Gradi, Educazione Napoletana |

**Come si risolve bene**: se la lingua è una di quelle del sito, si **aggiunge
davvero** a `T` (fatto su EN e L'Huile); se no, si ripiega — e il ripiego si
scrive `if (Object.hasOwn(T, j.lang))`, che non va aggiornato quando il sito
aggiunge una lingua.

Tutti e sei sono in **Fase A**: il motore multi-sede gira, `locations` è vuota
su cinque e il comportamento è quello di sempre. Solo 450 Gradi è in Fase B.

`PRESTAZIONI.md` §1 e §3 sono **chiusi su tutti e cinque** (29/09/2026): nessun
cliente chiede piu' i font a Google, e nessuna `<img>` pubblica e' senza posto
riservato.

⚠️ **Questa tabella non si aggiorna a memoria.** Il 29/09/2026 e' stata scritta
dopo aver confrontato i file del motore riga per riga nei cinque repo e aver
verificato che locale e GitHub fossero allo stesso commit. Le due volte
precedenti era stata scritta a memoria, ed era falsa.

---

## 🔄 I recapiti copiati col clone — 29/09/2026 (motore `3f5f8ce`)

Un giro nato da un difetto solo, che si e' rivelato una famiglia intera: **un
dato del cliente copiato dentro il codice al momento del clone, e mai piu'
guardato.** Nessuno dava un errore.

- **ChouChou e L'Huile pubblicavano il numero di telefono di La Molisana** nel
  riquadro «ordini chiusi» di `/order` — sei pagine, visibili solo fuori orario,
  cioe' quando nessuno guarda. Chi ordinava la sera telefonava a un altro
  ristorante.
- **La Molisana mostrava due email diverse**: `pizzeria@` nel footer, `info@`
  nella pagina contatti e nei dati strutturati letti da Google.
- **ChouChou aveva `src/config/client.ts` col segnaposto del motore** — telefono,
  email, indirizzo e firma mai compilati al clone. E' il ripiego usato quando il
  database non risponde.
- **450 Gradi non aveva la pagina `/feedback`**, ma le email di richiesta
  recensione ci mandano gia' le stelle 1-3: il cliente scontento — quello che
  vale di piu' ascoltare — trovava un 404.
- **Il link nelle stelle non portava la sede**, ne' per gli ordini ne' per le
  prenotazioni: su un cliente a tre pizzerie il parere sarebbe arrivato alla
  casella di ripiego invece che alla cucina che puo' rimediare.
- **`/feedback` restava in sitemap** su tutti e quattro i clienti che ce
  l'avevano, pur portando `noindex`: Google riceveva una pagina che poi le
  veniva detto di ignorare.
- **Le due pagine di annullamento di 450 Gradi portavano il tema di La
  Molisana** — marrone e oro, Marcellus, angoli arrotondati — su un sito nero e
  rosso. Ci si arriva dal link della propria email, quindi le vede un cliente
  vero. Erano anche `lang="fr"` coi titoli in francese su un sito in inglese.

**Le reti nuove.** `tests/recapiti.test.mjs` cerca telefoni ed email scritti a
mano in `src/pages/`, `src/components/`, `src/layouts/` — fuori l'admin,
`src/config/client.ts` (il ripiego dichiarato) e le pagine legali. Misurata
prima di essere scritta: verde su motore e su quattro clienti, rossa solo su La
Molisana con i tre file che gia' sapevamo.

⚠️ **Perche' nessuna prova li aveva visti**: le reti sorvegliavano le CHIAVI di
`app_config` — che si leggano con l'ambito giusto. Nessuna guardava i VALORI
scritti nel sito del cliente, che e' dove il clone li lascia.

⚠️ **E una rete che sbagliava bersaglio**: `prestazioni.test.mjs` cercava il NOME
del telaio (`Layout`) per sapere se una pagina ha i font. 450 Gradi ha dovuto
chiamare il suo `Vetrina`, perche' `Layout` e' prenotato da `motore.test.mjs`:
due reti che si contraddicevano, e la seconda segnalava il nome di un file
invece di un font mancante. Ora conta che la pagina renda un telaio, cioe'
importi da `src/layouts/`.

---

## 🔄 Il multi-sede — 27/09/2026

Cinque clienti portati sul motore multi-sede in un giorno, con la ricetta in
`MIGRAZIONE-MULTISEDE.md`. La migrazione di database è **una sola**, la #73
`073_locations.sql`, dichiarata «solo schema, nessun effetto visibile»: si lancia
`supabase/TUTTO.sql` intero, che è idempotente.

Difetti trovati strada facendo, **nessuno dei quali dava un errore**:

- **ChouChou non generava nessuna sitemap**, e `robots.txt` ne annunciava
  comunque l'indirizzo. Aveva anche `Disallow: /order` **secco**: un prefisso in
  robots non ha confini di parola, quindi teneva fuori da Google la pagina
  d'ordine del ristorante.
- **`TIMEZONE` era `export let`** in `slots.ts`: una variabile di modulo mutabile
  condivisa fra tutte le richieste del processo. Con due sedi in fusi diversi
  dava un'ora sbagliata *ma plausibile*. Ora è `fusoDi(ambito)`.
- **Il CSS di una pagina di stampa finiva addosso al pannello.**
  `import.meta.glob` non rende i nomi dei file: aggancia i moduli al grafo delle
  dipendenze di chi lo chiama. Cura: `query: "?raw"`.
- **`societa.ts` di L'Huile pubblicava la partita IVA di un'altra società** nel
  footer legale, e `SeoJsonLd` gli orari del gruppo nella scheda Google di un
  punto.
- **Tre `_MENU_*.sql`** erano a un passo dall'essere cuciti in `TUTTO.sql`, e
  avrebbero installato il menu di L'Huile su ogni cliente.
- **Chiavi di cache senza la sede** (`footer:extra`, `seo:locale`, `seo:jsonld`):
  la prima pagina servita da un punto riempiva la cache e per un minuto tutti gli
  altri servivano i suoi dati.

---

## 🔄 Secondo giro di merge dell'08/09/2026 — motore `8b1481c`

**Tutti e 4 puliti, zero conflitti**, stessa identica lista di 35 file. Porta due sessioni di lavoro (da `b8bd85d`):

- **Breakpoint: conversione CHIUSA.** Nessuna deviazione residua nel motore. Molte soglie non convertite ma **tolte** (tab scrollabili in agenda/marketing/assets/settings, `.gs-packs` e `.n-stats` passate ad `auto-fit`, orari di `SpecialDaysForm`). Le eccezioni dichiarate stanno in `ENGINE.md`.
- **Clienti**: larghezze delle colonne calcolate nel JS (`--grid-cols`), selettore colonne accanto alla ricerca con preferenza in `localStorage`, lingua tolta dalla colonna e messa come bandierina sul badge, dati in bianco pieno, totale a zero → trattino.
- **Google**: mai più WebP verso Google (accetta solo JPG/PNG — era la causa del logo PNG che non si caricava su EN), tab Post impilato su tablet e mobile, recensioni a una colonna quando la scheda si impila, spazi dei campi della scheda uniformati.
- **Marketing e Assets**: bottoni «aggiungi» uniformati al FAB corallo condiviso.
- **Agenda**: modale evento che non accavalla più le due colonne a una colonna.
- **Documenti**: lingua scelta per documento (résiliation nella lingua del fornitore) → **migrazione #72**. Email «Commande Print» con il guscio delle altre.

✅ **Migrazione #72 (`supabase/072_admin_docs_lang.sql`) lanciata su tutti e 4** l'08/09.

---

## 🔄 Giro di merge dell'08/09/2026 — motore `b8bd85d`

**Tutti e 4 puliti, zero conflitti.** Porta: ordini (date future nel datepicker, nome+telefono obbligatori), checkout e coupon nelle 5 lingue, prefisso Stripe che legge `defaultLang` dal cliente, modale prenotazioni scrollabile con tavoli nella finestra persone−1/+2, colonne della home 4/3/2/1, switch push che dice perché è spento.

⚠️ **Trappola vista su La Molisana**: `git merge` è morto con `fatal: stash failed`. Causa: un `.git/index.lock` rimasto da un `git status` lanciato dalla VM Cowork (che nelle cartelle senza permesso di cancellazione crea il lock ma non riesce a toglierlo). Il merge non era nemmeno partito. Si risolve con `rm -f .git/index.lock`. **Da qui in avanti: niente comandi git nei repo dal lato Cowork** — si leggono i file, non l'indice.

---

## 🔄 Giro di merge del 06/10/2026 — motore `c878877`

Cosa porta: la **fascia della giornata** nella Accueil (Google, prenotazioni,
ordini in tre colonne), l'**affluenza oraria** su dati nostri, i **servizi di
oggi con l'interruttore** e i bottoni 15/30/45 dentro le colonne, e
l'interruttore «Pages visibles» del super che adesso comanda davvero cio' che
si vede. Spariscono sei tile — Commandes, Réservations, Google, Horaires,
Cuisine, Statistiques — il cui contenuto e' salito nella fascia.

**Nessuna migrazione**: `supabase/` non e' stato toccato. L'API nuova
(`/api/admin/affluence`) legge tabelle che esistono gia'.

La home vecchia resta raggiungibile dal tag **`home-tiles`**.

| Cliente | Stato | Conflitti |
|---|---|---|
| 450 Gradi | ✅ fatto | nessuno. Le sei tile cancellate erano identiche a quelle del motore, e `admin/index.astro` non era mai stato personalizzato: il file che cambia di piu' e' anche quello che nel cliente non esisteva in versione propria |
| Educazione Napoletana | ⏳ da fare | — |
| La Molisana | ⏳ da fare | — |
| ChouChou | ⏳ da fare | ⚠️ widget molto personalizzato |
| L'Huile | ⏳ da fare | — |
| BROS | ⏳ da fare | — |

⚠️ **450 Gradi NON era a `e3e863a`, come diceva questo file: era a `0850b01`.**
Il suo merge del 05/10 e' delle 17:57, `e3e863a` e' stato committato alle
18:36 — trentanove minuti dopo. Educazione Napoletana, mergiato alle 18:37,
ce l'aveva davvero. Quindi per un giorno il registro ha dato per allineato un
cliente a cui mancava l'ultimo pezzo della stampa (`src/lib/stampaConfig.ts`,
la stampa per chi ha un locale solo).

**Come non ripeterlo**: il commit si annota DOPO il push, non mentre si
decide di fare il giro. E la riga che lo dice senza doverci credere e' quella
che stampa `git fetch engine`:
`0850b01..c878877  main -> engine/main` — a sinistra c'e' la base VERA del
cliente. Se non e' il commit che il registro dichiara, il registro ha torto.

---

## 🔄 Giro di merge del 03/10/2026 — motore `c791f59`

Cosa porta: `payment_method = 'onsite'` ammesso dal database (**senza la
migrazione gli ordini con pagamento al ritiro non nascono**), il link «Annuler
ma commande» nella lingua in cui si è ordinato, e i tre avvisi quando è il
CLIENTE ad annullare (email alla cucina, push al ristoratore, conferma al
cliente) — prima l'annullo cambiava solo la riga e in cucina l'ordine restava.

Porta anche il **link «lascia una recensione» di nuovo modificabile dal
ristoratore**, in Réglages → Général: dal 17/09 era uscito dai Liens e non era
mai arrivato in Général, quindi un cliente a sede unica non aveva più nessun
posto dove metterlo.

| Cliente | Stato | Conflitti |
|---|---|---|
| BROS | ✅ fatto | `src/pages/order/cancel.astro`: nel motore la pagina si annulla da sola, su BROS delega ad `AnnullaOrdine.astro`. Tenuta la versione BROS, e il componente ora segue `j.lang` per tutte le lingue del sito, non solo l'inglese. |
| La Molisana | ⏳ da fare | atteso su `cancel.astro` se ha una pagina propria |
| Educazione Napoletana | ⏳ da fare | — |
| ChouChou | ⏳ da fare | — |
| L'Huile | ⏳ da fare | — |
| 450 Gradi | ⏳ da fare | — |

⚠️ **Il test della pagina di annullo è passato a `skipIf(!SONO_IL_MOTORE)`**
(commit `ac1762d`): pretendeva una riga dentro `order/cancel.astro`, che un
cliente ha il diritto di rifare. Senza quel commit il merge diventa rosso su
ogni cliente con una pagina propria — **va pushato prima del giro**.

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

## ⚠️ Migrazioni — #75 lanciata solo su BROS (04/10/2026)
**#75 `075_orders_onsite_payment.sql`** allarga il `check` di
`orders.payment_method` a `'onsite'`. Lanciata su **BROS**, l'unico che incassa
al ritiro. Sugli altri cinque **non è stata lanciata**: accettano pagamenti
online, quindi oggi non serve.

⚠️ **È una mina a tempo, non una scelta chiusa.** «Paga al ritiro» si accende
dall'admin (Impostazioni → Ordini): il giorno in cui uno dei cinque la attiva,
senza questa migrazione i suoi ordini **smettono di nascere** — carrello pieno,
«Impossibile creare l'ordine», nessuna riga, nessun avviso in cucina, nessun
errore nei log. Nessuno collegherà il guasto a un interruttore acceso settimane
prima.

La migrazione **allarga** soltanto i valori ammessi: su chi non usa il ritiro
non cambia nulla, ed è idempotente. Lanciarla ovunque toglie la mina.

---

## ✅ Migrazioni — nessuna pendente (08/09/2026)
**#72 `072_admin_docs_lang.sql`** (colonna `lang` su `admin_docs_meta`) **lanciata su tutti e quattro** l'08/09. Tutti i clienti sono a pari con le migrazioni del motore.

**#71 `071_menu_variants.sql` lanciata su ChouChou, La Molisana e L'Huile.** Educazione Napoletana v2 aveva già #1→#71. Tutti e 4 i clienti sono a pari con le migrazioni del motore.

**Chiavi VAPID: tutte e 4 a posto.** Mancavano su ChouChou (righe assenti nel `.env`) e su L'Huile (righe vuote) — generate il 07/09 con `npx web-push generate-vapid-keys`.
⚠️ `PUBLIC_VAPID_KEY` è una variabile `PUBLIC_*`: Astro la **incolla nel bundle al build**. Metterla su Hostinger e riavviare NON basta, serve il rebuild.

✅ **Redeploy Hostinger fatto su tutti l'08/09** (secondo giro), **verificato live**: logo PNG che si carica nel tab Foto di Google (era il caso che ha fatto scoprire la conversione in WebP), notifiche EN in italiano, ordine EN con `lang: it`. Il promemoria di sopra resta valido come metodo: senza redeploy il codice nuovo resta nel repo.

ℹ️ **«Varianti» è una feature opzionale**: si accende cliente per cliente da Super admin → Impostazioni. Per ora la vuole **solo Educazione Napoletana**; gli altri non vedono nemmeno il tab.

- **04/09** — #68 `print_orders`, #69 `reservations.extra_minutes`, #46 `gift_card_orders`: lanciate su tutti e 3.
- **05/09** — #70 `070_gift_cards_langs.sql` (`sender_lang`/`recipient_lang` su gift_cards): lanciata su tutti e 3.

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
- ⚠️ **`src/config/ticket.ts` e' del cliente, per tutti**: e' il disegno del ticket di cucina. Dal 06/10/2026 la rotta di stampa lo prende da li' e non da `lib/stampaRegole.ts`, cosi' un ristorante puo' avere il suo senza modificare il motore dentro il suo repo — che voleva dire un conflitto a ogni giro. Chi non lo tocca riceve il ripiego del motore, miglioramenti compresi.

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
