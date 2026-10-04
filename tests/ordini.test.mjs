/**
 * COME SI PAGA UN ORDINE — le regole che non devono cambiare da sole.
 *
 * ⚠️ Fino al 29/09/2026 il motore sapeva fare una cosa sola: si ordina e si
 * paga con la carta. Da qui in avanti sa farne due, e la seconda — si ordina
 * ora, si paga in cassa al ritiro — ha un difetto naturale: assomiglia a un
 * carrello abbandonato. Sono due righe `pending` che si distinguono per una
 * colonna sola. Sbagliare quella distinzione vuol dire o una lista piena di
 * carrelli mai confermati, o un ordine vero che non compare da nessuna parte.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
// ⚠️ Si importa `ordiniRegole`, NON `ordiniOpzioni`: il secondo arriva a
// `db.ts`, che in vitest lancia all'import — e un file di prova che non parte
// viene contato come «0 test», cioe' verde. Vedi ENGINE.md.
import { acceso, RIPIEGO_ORDINI, CHIAVI_ORDINI, inCassa, metodoCambiabile, METODI_CASSA_SCELTA } from "../src/lib/ordiniRegole.ts";
import { SONO_IL_MOTORE } from "./ambiente.mjs";

const leggi = (f) => readFileSync(f, "utf8");

test("chi non ha mai visto queste opzioni si comporta come ieri", () => {
  // ⚠️ I cinque clienti di oggi non hanno nessuna di queste righe nel
  // database. Se il ripiego cambiasse, un ristorante si troverebbe il
  // pagamento con carta spento — o peggio acceso uno che non lo vuole — da
  // un merge, senza aver toccato niente.
  assert.equal(acceso(undefined, "orders_pay_online"), true);
  assert.equal(acceso(undefined, "orders_pay_onsite"), false);
  assert.equal(acceso(undefined, "orders_coupons"), true);
  assert.deepEqual(Object.keys(RIPIEGO_ORDINI).sort(), [...CHIAVI_ORDINI].sort());
});

test("un valore storto ricade sul ripiego, non su «spento»", () => {
  // ⚠️ Una riga scritta a mano nel database, o rimasta da una versione
  // precedente, non deve spegnere gli ordini di un ristorante: «si», «true» e
  // «» non sono interruttori, e valgono quanto una riga che non c'e'.
  for (const v of ["si", "true", "oui", "", "  ", null, undefined, {}]) {
    assert.equal(acceso(v, "orders_pay_online"), true, `valore: ${String(v)}`);
    assert.equal(acceso(v, "orders_pay_onsite"), false, `valore: ${String(v)}`);
  }
  assert.equal(acceso("1", "orders_pay_onsite"), true);
  assert.equal(acceso("0", "orders_pay_online"), false);
  // Gli spazi intorno non cambiano cosa ha chiesto il ristoratore.
  assert.equal(acceso(" 1 ", "orders_pay_onsite"), true);
  // ⚠️ Il NUMERO 1 non e' un valore storto: `app_config.value` e' testo, ma
  // un 1 arrivato come numero da un JSON dice la stessa cosa della stringa
  // "1", e leggerlo come «spento» spegnerebbe un interruttore che qualcuno
  // aveva acceso. (La prova prima lo elencava fra gli storti: aveva torto
  // lei, non la regola.)
  assert.equal(acceso(1, "orders_pay_onsite"), true);
  assert.equal(acceso(0, "orders_pay_online"), false);
});

test("il checkout chiede come si paga PRIMA di creare l'ordine", () => {
  const src = leggi("src/pages/api/checkout.ts");
  const iModi = src.indexOf("modiDiPagamento(");
  const iInsert = src.indexOf('inserisci("orders"');
  assert.ok(iModi > 0, "il checkout non guarda piu' i modi di pagamento");
  assert.ok(iInsert > 0, "il checkout non crea piu' l'ordine (?)");
  assert.ok(
    iModi < iInsert,
    "l'ordine si crea prima di sapere se qui si puo' pagare: con tutto spento nascerebbe un ordine che nessuno onorera'",
  );
  // ⚠️ E il caso «nessuno dei due» si dice, non si subisce: senza questo il
  // carrello arriverebbe in fondo e si fermerebbe li' senza spiegazioni.
  assert.match(src, /modi\.nessuno/);
});

test("l'ordine da incassare si riconosce dalla riga, non dalla configurazione", () => {
  // ⚠️ La tentazione era filtrare con «se il locale ha spento il pagamento
  // online allora mostra i pending»: sbagliato, perche' un locale puo' avere
  // accesi tutti e due, e allora avrebbe insieme ordini da incassare e
  // carrelli abbandonati. Li distingue `payment_method`, che sta sulla riga.
  assert.match(leggi("src/pages/api/checkout.ts"), /payment_method: "onsite"/);
  assert.match(leggi("src/pages/api/admin/orders.ts"), /eq\("payment_method", "onsite"\)/);
  assert.match(leggi("src/pages/admin/orders.astro"), /payment_method\.eq\.onsite/);
});

test("chi ordina senza pagare viene annunciato lo stesso", () => {
  // ⚠️ Senza Stripe non c'e' nessun webhook, e l'annuncio — email al cliente,
  // email alla cucina, notifica — non lo farebbe nessuno: l'ordine
  // resterebbe una riga nel database mentre il cliente aspetta la sua pizza.
  const src = leggi("src/pages/api/checkout.ts");
  assert.match(src, /annunciaOrdine\(/);
  const iCassa = src.indexOf("if (inCassa) {");
  const iAnnuncio = src.indexOf("annunciaOrdine(", iCassa);
  assert.ok(iCassa > 0 && iAnnuncio > iCassa, "l'annuncio non e' piu' nel ramo dell'ordine in cassa");
});

test("solo un ordine nato per la cassa puo' diventare pagato dal pannello", () => {
  // ⚠️ Il resto dei `pending` sono carrelli abbandonati: segnarli pagati
  // sarebbe inventare un incasso, e le statistiche lo riporterebbero.
  const src = leggi("src/pages/api/admin/orders.ts");
  assert.match(src, /const daIncassare\s*=/);
  assert.match(src, /String\(prima\?\.payment_method \?\? ""\) === "onsite"/);
  assert.match(src, /status !== "cancelled" && !\(status === "paid" && daIncassare\)/);
});

test("spegnere tutti i pagamenti non si puo'", () => {
  // ⚠️ Sarebbe un sito che accetta ordini fino all'ultimo bottone e poi si
  // ferma, senza che niente lo dica. Si rifiuta al salvataggio, che e'
  // l'unico momento in cui c'e' una persona davanti allo schermo.
  const src = leggi("src/pages/api/admin/settings.ts");
  assert.match(src, /!vuole\("orders_pay_online"\) && !vuole\("orders_pay_onsite"\)/);
  assert.match(src, /err\.noPayment/);
});

test("volere il pagamento con carta non basta: ci vuole il conto", () => {
  // ⚠️ Un interruttore acceso su un conto Stripe che non esiste e' una
  // promessa che il checkout non puo' mantenere: il cliente arriverebbe a un
  // errore di pagamento senza capire perche'.
  const src = leggi("src/lib/ordiniOpzioni.ts");
  assert.match(src, /const online = volute\.online && stripePronto;/);
});

test("il coupon in cassa e' una scelta del ristoratore, non un automatismo", () => {
  // ⚠️ Online lo sconto lo applica il sistema; in cassa deve applicarlo una
  // persona mentre c'e' fila. Se il ristoratore non lo vuole, il campo del
  // codice sparisce appena il cliente sceglie di pagare al ritiro — e il
  // server RIFIUTA un codice arrivato lo stesso, invece di ignorarlo in
  // silenzio: il cliente ha visto un totale scontato sullo schermo.
  assert.equal(acceso(undefined, "orders_coupons_onsite"), false);
  const chk = leggi("src/pages/api/checkout.ts");
  assert.match(chk, /const couponAmmesso = modi\.coupon && \(!inCassa \|\| modi\.couponInCassa\);/);
  assert.match(chk, /TXT_COUPON_SOLO_ONLINE/);
  // Vale solo se ENTRAMBI gli interruttori sono accesi.
  assert.match(leggi("src/lib/ordiniOpzioni.ts"), /couponInCassa: volute\.coupon && volute\.couponInCassa/);
});

test("la comanda non dice «pagato» su un ordine da incassare", () => {
  // ⚠️ E' la bugia che costa denaro: chi consegna legge la pastiglia verde,
  // da' la pizza e non chiede niente. Con l'importo DENTRO la pastiglia, la
  // cifra da chiedere si trova senza cercarla.
  const n = leggi("src/lib/notifications.ts");
  assert.match(n, /da_incassare\?: boolean;/);
  assert.match(n, /const pastigliaPagamento = o\.da_incassare/);
  assert.match(n, /\$\{k\.toCollect\} · \$\{euro\(o\.total_cents\)\}/);
  // E il cliente deve sapere di uscire con i contanti.
  assert.match(n, /o\.da_incassare \? t\.payAtPickup : t\.total/);
  // L'ordine in cassa lo dichiara: senza, la riga direbbe solo `pending`.
  assert.match(leggi("src/pages/api/checkout.ts"), /annunciaOrdine\(ordine, true\)/);
});

test("con due strade aperte, la carta e' quella preselezionata", () => {
  // ⚠️ E' la strada in cui l'incasso e' gia' fatto quando la pizza esce. Chi
  // vuole pagare al ritiro lo dice con un tocco.
  const app = leggi("src/components/OrderApp.tsx");
  assert.match(app, /useState<"online" \| "onsite">\(\s*pagamento\.online \? "online" : "onsite",?\s*\)/);
  // La scelta compare solo dove c'e' da scegliere...
  assert.match(app, /const scegliePagamento = pagamento\.online && pagamento\.locale;/);
  // ...e il ripiego e' il comportamento di sempre, per i siti che non la
  // passano: niente elementi nuovi e nudi il giorno del merge.
  assert.match(app, /pagamento = \{ online: true, locale: false, coupon: true, couponInCassa: false \}/);
  // Pagando al ritiro il bottone non promette un pagamento che non avviene.
  assert.match(app, /pagaInCassa \? \(invio \? tp\.ordinando : tp\.ordina\)/);
});

test("questa rete non dipende dal database (o non parte, e non lo dice nessuno)", () => {
  // ⚠️ E' l'errore fatto scrivendo questo file, il 29/09/2026: le prove
  // importavano `ordiniOpzioni`, che arriva a `db.ts`, che LANCIA all'import
  // quando mancano le variabili Supabase — come in vitest. Risultato: «0
  // test», che nell'elenco sembra una riga verde. Era gia' successo con
  // `slots.test.ts`, sedici prove ferme per mesi.
  //
  // Questa guardia non puo' proteggersi da sola (se il file non parte, non
  // gira nemmeno lei): protegge il file DI REGOLE, che e' la ragione per cui
  // le prove sopra riescono a partire.
  const regole = readFileSync("src/lib/ordiniRegole.ts", "utf8");
  const importa = [...regole.matchAll(/^\s*import\s.+from\s+["'][^"']+["']/gm)].map((m) => m[0]);
  assert.deepEqual(
    importa,
    [],
    "ordiniRegole.ts ha un import: se porta a db.ts, le prove qui sopra smettono di partire e vitest le conta come zero",
  );
  assert.match(regole, /export function acceso/);
});

test("ogni payment_method scritto dal codice e' ammesso dal database", () => {
  // ⚠️ IL 02/10/2026 SU BROS NESSUN ORDINE VENIVA CREATO. Dal 29/09 un locale
  // puo' spegnere la carta e far pagare al ritiro: il checkout salva allora
  // `payment_method = 'onsite'`. Ma la colonna nasce dalla #49 con un `check`
  // che conosce solo 'cash', 'card' e 'link', e PostgreSQL rifiutava l'insert.
  // Il cliente riempiva il carrello, premeva «Ordina» e leggeva «Impossibile
  // creare l'ordine»: niente nel database, niente in cucina, niente nei log.
  //
  // E' lo STESSO guasto della #74 sulle prenotazioni (`source` allargato a
  // instagram e qr), dove la lezione era gia' stata scritta — e non e'
  // bastata, perche' valeva solo per quella colonna. Questa prova la estende
  // agli ordini: i valori che il codice scrive devono stare nel vincolo.
  // ⚠️ Via i commenti PRIMA di leggere. La nota in testa alla migrazione cita
  // il vincolo VECCHIO per spiegare il guasto, e una ricerca ingenua trova
  // quello: il test accusava la propria spiegazione. E' la terza volta in due
  // giorni — con gli switch e con il viewport — quindi vale come regola: un
  // test che cerca una stringa deve guardare il codice, non i commenti.
  const vincolo = readFileSync(
    new URL("../supabase/orders_onsite_payment.sql", import.meta.url), "utf8")
    .split("\n").filter((r) => !r.trim().startsWith("--")).join("\n");
  const m = vincolo.match(/check\s*\(\s*payment_method\s+in\s*\(([^)]+)\)/i);
  assert.ok(m, "il check su `payment_method` non e' piu' riconoscibile in orders_onsite_payment.sql");
  const ammessi = new Set(m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")));

  // Quello che il codice scrive davvero: `payment_method: "..."` negli insert.
  const scritti = new Set();
  for (const f of ["src/pages/api/checkout.ts", "src/pages/api/admin/orders.ts"]) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    for (const mm of src.matchAll(/payment_method:\s*"([a-z_]+)"/g)) scritti.add(mm[1]);
    // e quello su cui filtra, che deve esistere o la lista resta vuota per sempre
    for (const mm of src.matchAll(/"payment_method",\s*"([a-z_]+)"/g)) scritti.add(mm[1]);
  }
  assert.ok(scritti.size > 0, "nessun payment_method trovato nel codice: la prova si e' svuotata");

  const fuori = [...scritti].filter((v) => !ammessi.has(v)).sort();
  assert.deepEqual(fuori, [],
    "questi valori il database non li accetta: l'insert fallisce e l'ordine non nasce. Serve una migrazione che allarghi il check");

  // E il vincolo deve essere l'ULTIMO lanciato: se qualcuno aggiunge una
  // migrazione piu' nuova su questa colonna, questa prova guarda il file
  // sbagliato e torna cieca.
  const tutto = readFileSync(new URL("../supabase/TUTTO.sql", import.meta.url), "utf8")
    .split("\n").filter((r) => !r.trim().startsWith("--")).join("\n");
  const ultimo = [...tutto.matchAll(/check\s*\(\s*payment_method\s+in\s*\(([^)]+)\)/gi)].pop();
  assert.ok(ultimo, "in TUTTO.sql non c'e' nessun check su payment_method");
  const ultimiAmmessi = new Set(ultimo[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")));
  for (const v of scritti) {
    assert.ok(ultimiAmmessi.has(v),
      `"${v}" non e' nell'ultimo check di TUTTO.sql: una migrazione piu' recente lo ha ristretto`);
  }
});

test("il link di annullamento conosce la lingua in cui si e' ordinato", () => {
  // ⚠️ `orders.lang` tiene fr/en/it/nl/es dalla #49, e il checkout ci scrive la
  // lingua della pagina in cui il cliente ha ordinato. La GET di order-cancel
  // la schiacciava su due valori — `en` oppure `fr` — quindi chi ordinava in
  // italiano apriva «Annuler ma commande» in francese.
  //
  // Il link nell'email non porta la lingua: questa risposta e' l'UNICO modo che
  // il sito del cliente ha di saperla. Perderla qui vuol dire perderla e basta.
  const API = readFileSync(new URL("../src/pages/api/order-cancel.ts", import.meta.url), "utf8");

  assert.doesNotMatch(API, /lang:\s*data\.lang\s*===\s*"en"\s*\?\s*"en"\s*:\s*"fr"/,
    "order-cancel e' tornato a rispondere solo fr/en: le altre lingue si perdono prima di arrivare alla pagina");
  assert.match(API, /PUBLIC_LANG_CODES/,
    "l'elenco delle lingue e' tornato scritto a mano: va letto da dove e' gia' dichiarato");

});

// ⚠️ SOLO SUL MOTORE. Qui si guarda `src/pages/order/cancel.astro`, e un
// cliente ha il diritto di sostituirla con la propria (BROS la fa delegare a
// un componente del suo sito, con le sue tre lingue): un test del motore non
// puo' pretendere una riga di codice dentro una pagina che il cliente rifa'.
// Cio' che vale per tutti — l'API che risponde la lingua vera — e' sopra.
test.skipIf(!SONO_IL_MOTORE)("la pagina di annullo del motore ripiega, non si rompe", () => {
  // I testi sono in due lingue sole: un `T[lang]` con `it` sarebbe `undefined`,
  // cioe' pagina bianca — peggio della lingua sbagliata.
  const PAG = readFileSync(new URL("../src/pages/order/cancel.astro", import.meta.url), "utf8");
  assert.doesNotMatch(PAG, /lang\s*=\s*j\.lang\s*;/,
    "la pagina prende la lingua senza ripiego: con it/nl/es i testi diventano undefined");
  assert.match(PAG, /lang\s*=\s*j\.lang\s*===\s*"en"\s*\?\s*"en"\s*:\s*"fr"/,
    "manca il ripiego su fr per le lingue che questa pagina non ha");
});

test("l'annullo del cliente avvisa la cucina, non solo il database", () => {
  // ⚠️ IL PIATTO ERA GIA' STATO ANNUNCIATO. Quando il cliente annulla dal link
  // della sua email, l'email del nuovo ordine e' gia' partita e la comanda e'
  // appesa in cucina. Fino al 03/10/2026 quell'annullo cambiava SOLO una riga
  // nel database: nessuna email, nessuna push, nessuna conferma al cliente.
  // Il guasto si scopriva quando nessuno veniva a ritirare — cibo buttato, e
  // la colpa che sembra del cliente.
  //
  // L'annullo fatto dall'ADMIN avvisava gia'. Era quello fatto dal cliente a
  // non avvisare nessuno, ed e' passato inosservato perche' capita di rado:
  // i guasti rari non si vedono, si deducono.
  const API = readFileSync(new URL("../src/pages/api/order-cancel.ts", import.meta.url), "utf8");

  assert.match(API, /inviaAnnulloCucina\(/, "l'annullo del cliente non avvisa piu' la cucina");
  assert.match(API, /inviaPushAnnulloOrdine\(/, "l'annullo del cliente non manda piu' la push al ristoratore");
  assert.match(API, /inviaAnnullaOrdine\(/, "il cliente non riceve piu' la conferma dell'annullo");

  // Non bloccanti: un server di posta lento non deve trasformare un annullo
  // riuscito in un errore per chi ha cliccato.
  for (const f of ["inviaAnnulloCucina", "inviaPushAnnulloOrdine", "inviaAnnullaOrdine"]) {
    assert.match(API, new RegExp(`void ${f}\\(`),
      `${f} non e' piu' chiamata con void: un errore della posta farebbe fallire l'annullo`);
  }

  // ⚠️ La cucina GIUSTA. L'ordine si cerca sull'aggregato (il token e'
  // l'autorizzazione), ma l'avviso deve partire con l'ambito della RIGA: con
  // tre societa', l'aggregato manderebbe l'annullo alla prima sede.
  assert.match(API, /ambitoDiRiga\(/,
    "l'avviso parte con l'ambito aggregato: su un cliente multi-sede arriva alla cucina sbagliata");

  // E solo quando lo stato cambia davvero: la risposta idempotente esce prima,
  // cosi' un doppio clic sul link non manda due email alla cucina.
  const iIdem = API.indexOf('if (ordine.status === "cancelled") return json({ ok: true })');
  const iAvviso = API.indexOf("void inviaAnnulloCucina(");
  assert.ok(iIdem > 0 && iAvviso > iIdem,
    "gli avvisi partono prima del controllo di idempotenza: due clic, due email");
});

test("l'aura del ritardo non puo' essere ritagliata dalla sagoma della card", () => {
  // ⚠️ IL GUASTO (03/10/2026, visto su 450 Gradi): l'alone che segnala un
  // ordine in ritardo non compariva. Il calcolo dei minuti era giusto; a
  // mancare era il DISEGNO. `mask` e `filter` stavano sullo stesso elemento,
  // e il browser applica prima il filtro e poi ritaglia: l'alone, che per
  // definizione sta fuori dalla sagoma, veniva cancellato un passaggio dopo.
  // Nessuno se ne accorge finche' un ordine non e' davvero in ritardo, cioe'
  // nel momento peggiore. Il mask deve stare su `::before`, la card tiene il
  // filtro.
  const pag = leggi("src/pages/admin/orders.astro").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocco = pag.match(/\n\s*\.card \{([\s\S]*?)\n\s*\}/);
  assert.ok(blocco, ".card non e' piu' riconoscibile in orders.astro");
  const dentro = blocco[1];
  // L'ombra e' diventata UNA MISURA SOLA: `--ombra`, dichiarata qui sulla card
  // e citata dalle tre animazioni del ritardo, che prima ne portavano ognuna
  // la propria copia. Quello che a questo test interessa non cambia: sulla
  // card c'e' un `filter`, ed e' un'ombra. Si controllano entrambi i pezzi,
  // perche' se la dichiarazione sparisce le animazioni citano un valore che
  // non esiste e il ritardo torna invisibile.
  assert.match(dentro, /--ombra:\s*drop-shadow\(/,
    "la misura dell'ombra non e' piu' dichiarata sulla card: le animazioni del ritardo citano un valore che non esiste");
  assert.match(dentro, /filter:\s*var\(--ombra\)/,
    "la card ha perso l'ombra: senza `filter` non c'e' nemmeno l'aura del ritardo");
  assert.doesNotMatch(dentro, /mask:/,
    "mask e filter sono di nuovo sullo stesso elemento: il ritaglio cancella l'aura del ritardo, e il difetto si vede solo quando un ordine e' in ritardo",
  );
  assert.match(pag, /\.card::before \{[\s\S]*?mask:/, "lo sfondo dentellato non e' piu' su ::before: la sagoma dello scontrino sparisce");
});

test("il recap delle modifiche confronta le stesse chiavi dei due lati", () => {
  // ⚠️ IL GUASTO (04/10/2026): si apriva un ordine in modifica, non si toccava
  // niente, e il riquadro MODIFICHE annunciava «− 1× Bruschette / + 1×
  // Bruschette — test2». Il recap legge il carrello con `ncNome`, che scrive
  // «piatto — formato»; la fotografia dell'ordine prendeva il solo nome del
  // piatto. Su ogni ordine con una variante i due lati non si incontravano, e
  // il ristoratore leggeva una modifica che non aveva mai fatto — cioe' la
  // cosa peggiore che possa fare un riquadro di controllo.
  // La fotografia si costruisce dal CARRELLO, con la stessa funzione.
  const pag = leggi("src/pages/admin/orders.astro");
  const blocco = pag.match(/const origItems = new Map<string, number>\(\);([\s\S]*?)\n\s*ncOrig = \{/);
  assert.ok(blocco, "la fotografia dell'ordine (origItems) non e' piu' riconoscibile");
  assert.match(blocco[1], /for \(const r of ncCart\.values\(\)\) origItems\.set\(ncNome\(r\)/,
    "origItems non si costruisce piu' dal carrello con ncNome: il recap confrontera' chiavi diverse e annuncera' modifiche mai fatte");
  assert.match(pag, /for \(const r of ncCart\.values\(\)\) cur\.set\(ncNome\(r\)/,
    "il recap non legge piu' il carrello con ncNome: l'altro lato del confronto e' cambiato");
});

test("in modifica il bottone Salva si accende solo se qualcosa e' cambiato", () => {
  // ⚠️ IL GUASTO (04/10/2026): aprendo un ordine in modifica, «Salva modifiche»
  // era gia' li', acceso, su un ordine intatto. Premerlo riscriveva l'ordine e
  // faceva ripartire l'email al cliente per niente. Un bottone acceso e' un
  // invito: se non c'e' niente da salvare, non deve esserci.
  // Chi decide e' uno solo — `aggiornaSalva` — e la domanda "e' cambiato?" ha
  // una risposta sola — `ncCambiato` — altrimenti il riquadro MODIFICHE e il
  // bottone finiscono per dire due cose diverse.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /function aggiornaSalva\(\)/, "aggiornaSalva non c'e' piu': nessuno decide se il bottone va mostrato");
  assert.match(pag, /function ncCambiato\(\)/, "ncCambiato non c'e' piu'");
  assert.match(pag, /const mostra = ncEditId \? ncCambiato\(\)/,
    "in modifica il bottone non dipende piu' da ncCambiato: torna acceso su un ordine intatto");
  assert.match(pag, /if \(!ncCambiato\(\)\) \{/,
    "il riquadro MODIFICHE non usa piu' ncCambiato: puo' dire «nessuna modifica» sotto un bottone acceso");
  // Il cliente fa parte dell'ordine: cambiare solo l'email e' una modifica, e
  // senza questa firma il bottone resterebbe spento e il dato non si salverebbe.
  assert.match(pag, /ncOrig\.cliente !== ncFirmaCliente\(\)/,
    "le modifiche ai dati del cliente non contano piu': si cambia l'email e non si puo' salvare");
  // Nessuno accende il bottone alle spalle di aggiornaSalva.
  const accensioni = pag.match(/nc-send[\s\S]{0,200}?style\.display\s*=\s*"(?:inline-)?block"/g) ?? [];
  assert.equal(accensioni.length, 0,
    "qualcuno accende di nuovo #nc-send a mano invece di passare da aggiornaSalva");
});

test("i soldi presi al banco non sono soldi di Stripe", () => {
  // ⚠️ IL GUASTO (04/10/2026): «pagato» non dice dove sono i soldi. Un ordine
  // preso dal sito e pagato al ritiro resta marcato `onsite` anche dopo
  // l'incasso, e `onsite` non era nella lista dei pagamenti in cassa. Risultato:
  // il motore lo trattava come incassato online. Chi modificava quell'ordine al
  // rialzo mandava al cliente un link Stripe per pagare la differenza di una
  // cena gia' saldata in contanti; e annullandolo, l'email prometteva un
  // rimborso online di soldi che stanno nel cassetto.
  assert.equal(inCassa("cash"), true);
  assert.equal(inCassa("card"), true);
  assert.equal(inCassa("onsite"), true, "onsite e' uscito dai pagamenti in cassa: torna il link Stripe su una cena gia' pagata al banco");
  // Questi due sono passati da Stripe: `link` esplicito, e l'ordine del sito
  // pagato con la carta, che non scrive nessun metodo.
  assert.equal(inCassa("link"), false);
  assert.equal(inCassa(null), false);
  assert.equal(inCassa(""), false);
  // Il metodo si cambia solo dove i soldi li ha presi una persona.
  assert.equal(metodoCambiabile("onsite"), true);
  assert.equal(metodoCambiabile("link"), false, "si potrebbe marcare «contanti» un ordine incassato da Stripe: il rimborso sparirebbe dal pannello");
  assert.equal(metodoCambiabile(null), false);
  // Le sole scelte offerte allo staff su un ordine che esiste gia'.
  assert.deepEqual([...METODI_CASSA_SCELTA].sort(), ["card", "cash"]);
});

test("il metodo di pagamento si cambia solo dal server, e solo in cassa", () => {
  // ⚠️ Il bottone nascosto nel modale e' un suggerimento: chi manda la
  // richiesta e' il browser, e un vecchio schermo aperto da stamattina puo'
  // mandare qualunque cosa. La regola deve stare nell'API.
  const api = leggi("src/pages/api/admin/orders.ts");
  assert.match(api, /METODI_CASSA_SCELTA\.includes\(metodoRich\)/,
    "l'API accetta un metodo qualsiasi: si puo' scrivere 'link' su un ordine incassato in contanti");
  assert.match(api, /metodoCambiabile\(ord\.payment_method\)/,
    "l'API non controlla piu' se quell'ordine puo' cambiare metodo: un incasso Stripe diventerebbe «contanti»");
  // Scegliere il metodo su un ordine «da incassare» E' l'incasso.
  assert.match(api, /incassaOra = ord\.status === "pending"/,
    "scegliere il metodo non incassa piu' l'ordine: resterebbe «da incassare» con un metodo di cassa addosso");
  // E il modale deve mandarlo.
  assert.match(leggi("src/pages/admin/orders.astro"), /\.\.\.\(ncPayment \? \{ payment: ncPayment \} : \{\}\)/,
    "il modale non manda piu' il metodo: la scelta non arriva al server");
});

test("la firma degli ordini guarda tutto l'ordine, non cinque campi scelti a mano", () => {
  // ⚠️ IL GUASTO (04/10/2026): si cambiava il metodo di pagamento da contanti
  // a carta, il salvataggio andava a buon fine, e sulla card restava l'icona
  // vecchia. L'aggiornamento silenzioso confronta una «firma» con quella di
  // prima e, se e' uguale, butta i dati appena arrivati senza ridisegnare. La
  // firma era un elenco di cinque campi (id, stato, ora, totale, nome): il
  // metodo di pagamento non c'era, e nemmeno l'email, il telefono o i piatti —
  // bastava sostituire un piatto con uno dello stesso prezzo per far mentire
  // lo schermo. Un elenco scritto a mano va tenuto allineato a tutto quello che
  // la card disegna, e prima o poi non lo e' piu'.
  const pag = leggi("src/pages/admin/orders.astro");
  const f = pag.match(/function firmaDa\(list: Order\[\]\): string \{([\s\S]*?)\n        \}/);
  assert.ok(f, "firmaDa non e' piu' riconoscibile");
  assert.match(f[1], /return JSON\.stringify\(list\);/,
    "la firma e' tornata a un elenco di campi: una modifica fuori da quell'elenco non ridisegna piu' la card, e lo schermo mostra il vecchio");
});

test("un ordine completato e incassato online si rimborsa senza doverlo annullare", () => {
  // ⚠️ IL BUCO (04/10/2026): il rimborso era legato allo stato «annullato». Un
  // ordine consegnato e poi da rimborsare (piatto sbagliato, cliente che
  // reclama) non aveva nessun bottone, e l'unica via era annullare un ordine
  // che il cliente ha davvero ritirato — falsando gli incassi del giorno.
  // «C'e' un incasso Stripe da cui tirare fuori i soldi» e' una domanda sui
  // soldi, non sullo stato.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /const incassoStripe = \/\^cs_\/\.test\(/,
    "l'incasso Stripe e' tornato legato allo stato dell'ordine: i completati non si rimborsano piu'");
  assert.match(pag, /mostra && residuo > 0 && incassoStripe/,
    "il bottone di rimborso non controlla piu' incasso e residuo");
  assert.match(pag, /const refundIco = btnRimborso\(o\.status === "done"\)/,
    "sparito il rimborso sui completati");
  // Stesso data-act del footer annullato: un solo modale, un solo controllo
  // d'importo. Una seconda strada per far uscire denaro e' una strada che
  // prima o poi non ha lo stesso tetto.
  // ⚠️ Si contano i BOTTONI, non le volte che la parola compare: senza
  // togliere i commenti, la spiegazione qui sopra nel sorgente verrebbe
  // contata come un terzo bottone. (Stessa trappola gia' annotata in
  // tests/tablet.test.mjs: un test che si accontenta della propria
  // spiegazione.)
  // ⚠️ UN SOLO bottone, usato due volte. Scritto due volte, prima o poi uno
  // porta un `data-residuo` diverso dall'altro: due tetti d'importo diversi
  // per far uscire gli stessi soldi.
  const nudo = pag.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bottoni = nudo.match(/data-act="refund"/g) ?? [];
  assert.equal(bottoni.length, 1, "il bottone di rimborso e' tornato scritto piu' volte");
  // ⚠️ Si contano separatamente la DICHIARAZIONE e le CHIAMATE. Contarle
  // insieme era il mio errore: `const btnRimborso = (mostra…` non contiene
  // `btnRimborso(`, quindi il totale che pretendevo non poteva uscire mai.
  assert.equal((nudo.match(/const btnRimborso = \(/g) ?? []).length, 1,
    "il costruttore del bottone di rimborso e' dichiarato piu' di una volta");
  assert.equal((nudo.match(/= btnRimborso\(/g) ?? []).length, 2,
    "le due card non chiamano piu' lo stesso bottone di rimborso");
  assert.doesNotMatch(pag, /data-act="refund-done"/, "e' nata una seconda azione di rimborso invece di riusare quella che c'e'");
});

test("i bottoni tondi della card hanno una forma sola", () => {
  // ⚠️ «Rimetti in corso» e «Rimborsa» stanno fianco a fianco nel footer di un
  // ordine completato. Se la forma la scrivessero da sole finirebbero per non
  // essere piu' tonde uguali — e uno dei due manda via dei soldi.
  const pag = leggi("src/pages/admin/orders.astro");
  const forma = pag.match(/\n\s*\.btn-tondo \{([\s\S]*?)\n\s*\}/);
  assert.ok(forma, ".btn-tondo non c'e' piu': la forma dei bottoni tondi e' tornata scritta in piu' posti");
  assert.match(forma[1], /width: var\(--cf-h\); height: var\(--cf-h\)/,
    "il bottone tondo non prende piu' la misura dalla riga del footer: i due possono diventare diversi");
  // Chi usa la forma mette solo il colore.
  const colore = pag.match(/\n\s*\.btn-rollback \{([^}]*)\}/);
  assert.ok(colore, ".btn-rollback non e' piu' riconoscibile");
  assert.doesNotMatch(colore[1], /width|height|border-radius/,
    ".btn-rollback ridichiara la propria misura invece di prenderla da .btn-tondo");
  // E in pagina i due bottoni la portano davvero.
  assert.equal((pag.match(/class="btn-tondo btn-rollback"/g) ?? []).length, 2, "un rollback ha perso la forma condivisa");
  assert.match(pag, /class="btn-tondo btn-refund-ico"/, "il rimborso sui completati non usa la forma condivisa");
});

test("un errore nel disegno non si fa passare per un errore di rete", () => {
  // ⚠️ IL GUASTO (04/10/2026): la pagina Ordini diceva «Errore di connessione»
  // e mostrava mezza lista. La connessione era viva: a rompersi era `render()`,
  // ma stava nello stesso `try` della fetch, quindi finiva nel catch della
  // rete. Si cerca il wifi, il server, Supabase — e il guasto e' in dieci
  // righe di disegno. Un messaggio che punta nella direzione sbagliata costa
  // piu' del guasto che annuncia.
  const pag = leggi("src/pages/admin/orders.astro");
  const fn = pag.match(/async function carica\(silenzioso = false\) \{([\s\S]*?)\n        \}/);
  assert.ok(fn, "carica() non e' piu' riconoscibile");
  const corpo = fn[1];
  // La fetch e il disegno hanno due try distinti, e due messaggi distinti.
  assert.match(corpo, /console\.error\("\[ordini\] render\(\)"/,
    "render() e' tornato dentro il try della rete: un errore di disegno si annuncera' come problema di connessione");
  assert.match(corpo, /mostraStato\(tr\("ord\.renderErr"\)\)/,
    "l'errore di disegno non ha piu' un messaggio suo");
  const iNet = corpo.indexOf('tr("common.netErr")');
  const iRender = corpo.indexOf("render();");
  assert.ok(iNet > 0 && iRender > iNet,
    "render() e' di nuovo dentro il blocco che risponde degli errori di rete");
});

test("la riga che stacca i piatti dai bottoni e' dichiarata una volta sola", () => {
  // ⚠️ IL GUASTO (04/10/2026): sulla card completata i bottoni erano appesi al
  // vuoto, senza la riga di separazione che l'ordine in corso ha. Due footer
  // (`.actions` in corso, `.card-foot` completato/annullato) facevano lo stesso
  // gesto visivo scritto in due posti: uno dei due se l'e' persa.
  // E lo spazio da lasciare in fondo alla card era un 3.6rem scritto a mano,
  // che nessuno poteva ricollegare all'altezza del footer: cambiando quella,
  // la riga finiva sopra l'ultimo piatto.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /\.actions,\n\s*\.card-foot \{ border-top: 1px solid var\(--c-line\); padding-top: var\(--stacco\); \}/,
    "i due footer non condividono piu' la riga di separazione: uno dei due la perdera'");
  // Lo spazio in fondo si SOMMA dai pezzi del footer, non e' un numero a mano.
  assert.match(pag, /padding-bottom: calc\(var\(--cf-bottom\) \+ var\(--cf-h\) \+ var\(--stacco\)/,
    "lo spazio per il footer e' tornato un numero scritto a mano: cambiando l'altezza dei bottoni la riga finisce sopra l'ultimo piatto");
  // Il footer assoluto si allinea al contenuto, non a un rientro suo.
  assert.match(pag, /\.card-foot \{ position: absolute; left: var\(--card-px\); right: var\(--card-px\)/,
    "il footer ha di nuovo un rientro proprio: la sua riga esce piu' larga di quella dei piatti");
  // E i tondi sono alti quanto la riga che li contiene.
  assert.match(pag, /width: var\(--cf-h\); height: var\(--cf-h\); border-radius: 50%/,
    "la misura dei bottoni tondi non e' piu' quella della riga del footer");
});

test("l'ombra dello scontrino segue la manopola del super admin", () => {
  // ⚠️ IL GUASTO (04/10/2026): nel super admin si abbassa l'ombra del tema e
  // ogni riquadro del pannello si alleggerisce — tranne gli scontrini degli
  // ordini, che restano pesanti. La card aveva un `rgba(0,0,0,0.4)` scritto a
  // mano invece della formula che usano tutte le altre card, `0.28 * --sh`.
  // Non e' un dettaglio estetico: e' una manopola che mente, e chi la muove
  // non capisce perche' una pagina sola non obbedisce.
  const pag = leggi("src/pages/admin/orders.astro");
  const blocco = pag.match(/\n\s*\.card \{([\s\S]*?)\n\s*\}/);
  assert.ok(blocco, ".card non e' piu' riconoscibile in orders.astro");
  assert.match(blocco[1], /--ombra: drop-shadow\([^)]*calc\(0\.28 \* var\(--sh, 0\.15\)\)\)\)/,
    "l'ombra della card non segue piu' --sh: la manopola «ombra» del super admin non la tocca");
  assert.match(blocco[1], /filter: var\(--ombra\)/, "la card non usa piu' la propria variabile d'ombra");
  // ⚠️ Resta drop-shadow: box-shadow disegnerebbe un rettangolo, e la sagoma
  // dentellata dello scontrino sparirebbe dietro un'ombra squadrata.
  assert.match(blocco[1], /--ombra: drop-shadow/, "l'ombra e' tornata box-shadow: seguirebbe il rettangolo, non i denti");
  // E le sei animazioni del ritardo citano la variabile invece di ripeterla.
  const nudo = pag.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(nudo, /drop-shadow\(0 4px 10px rgba\(0,\s*0,\s*0/,
    "il valore dell'ombra e' tornato ripetuto dentro le animazioni: cambiandolo in un posto solo, le card in ritardo resterebbero indietro");
  assert.equal((nudo.match(/var\(--ombra\)/g) ?? []).length, 10,
    "le animazioni del ritardo non citano piu' tutte la stessa ombra");
});

test("i bottoni della riga azioni hanno tutti lo stesso raggio", () => {
  // ⚠️ IL GUASTO (04/10/2026): «Rinvia», sull'ordine in attesa del pagamento,
  // era squadrato in mezzo a tre bottoni arrotondati. Il raggio era scritto
  // tre volte — su «Completato», sulla matita e sul cestino — e la quarta
  // volta e' stata dimenticata. Un valore ripetuto quattro volte e' un valore
  // che prima o poi ne ha tre.
  const pag = leggi("src/pages/admin/orders.astro");
  const base = pag.match(/\n\s*\.actions button \{([\s\S]*?)\n\s*\}/);
  assert.ok(base, ".actions button non e' piu' riconoscibile");
  assert.match(base[1], /border-radius: 8px/,
    "il raggio non vive piu' sul bottone generico: il prossimo bottone della riga nascera' squadrato");
  // E nessuno se lo ridichiara per conto suo.
  for (const b of ["btn-done", "btn-cancel", "btn-edit", "btn-resend"]) {
    const regola = pag.match(new RegExp(`\\n\\s*\\.(?:actions )?\\.?${b} \\{([^}]*)\\}`));
    if (regola) {
      assert.doesNotMatch(regola[1], /border-radius/,
        `.${b} ridichiara il proprio raggio invece di prenderlo da .actions button`);
    }
  }
});

test("incassare chiede COME, e lo scrive davvero", () => {
  // ⚠️ IL GUASTO (04/10/2026): «Incassa» scriveva solo lo stato. Il metodo
  // restava `onsite`, e l'icona accanto al prezzo ha tre rami — contanti,
  // carta, e tutto il resto → Stripe. Quindi un ordine incassato in contanti
  // al banco mostrava il marchio Stripe: la card diceva che quei soldi erano
  // arrivati online mentre stavano nel cassetto. E a fine serata, contando la
  // cassa, non si distingueva piu' chi aveva pagato come.
  // Quel tocco e' l'unico momento in cui qualcuno SA come ha pagato il
  // cliente; dopo, nessuno se lo ricorda.
  const pag = leggi("src/pages/admin/orders.astro");
  const api = leggi("src/pages/api/admin/orders.ts");

  // Il pannello chiede, in due tocchi.
  assert.match(pag, /data-act="inc-cash"/, "sparita la scelta «contanti» dall'incasso");
  assert.match(pag, /data-act="inc-card"/, "sparita la scelta «carta» dall'incasso");
  assert.match(pag, /incassaId === o\.id/,
    "la riga «incassato come?» non e' piu' disegnata dallo stato: appiccicata al DOM, sparirebbe al primo aggiornamento automatico della lista");

  // ⚠️ E il secondo tocco fa anche da conferma: per «incassato» NON esiste il
  // ripristino, quindi un tocco storto marcherebbe pagato un ordine mai pagato.
  assert.doesNotMatch(pag, /data-act === "incassa"\)\s*\{\s*cambiaStato/,
    "«Incassa» incassa di nuovo al primo tocco: senza conferma e senza metodo");

  // La regola vera sta sul server: il bottone e' solo un suggerimento.
  assert.match(api, /METODI_CASSA_SCELTA\.includes\(metodoIncasso\)/,
    "l'API accetta un metodo qualsiasi insieme all'incasso");
  assert.match(api, /status === "paid" && daIncassare && METODI/,
    "il metodo si puo' scrivere anche fuori dall'incasso di un ordine nato per la cassa: si riscriverebbe il metodo di un incasso Stripe");
  assert.match(api, /payment_method: metodoIncasso/, "l'API non scrive piu' il metodo scelto");
});

test("un ordine incassato al banco non mostra il marchio Stripe", () => {
  // Le righe incassate PRIMA di questa modifica restano `onsite`: senza un
  // ramo per loro ricadrebbero nel «tutto il resto», che e' Stripe.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /o\.payment_method === "onsite"\s*\n?\s*\?\s*`<span class="pay-ico pay-ico-onsite"/,
    "`onsite` e' tornato a cadere nel ramo Stripe: soldi del cassetto mostrati come incasso online");
});

test("nelle barre a tutta larghezza cede l'etichetta, mai l'importo", () => {
  // ⚠️ IL GUASTO (04/10/2026): «Differenza da pagare · 8,00 €» era un testo
  // unico. Su una card stretta andava a capo, la barra diventava alta il
  // doppio e spingeva giu' i bottoni. Troncare tutta la riga sarebbe stato
  // peggio: la barra avrebbe detto «differenza da pagare» senza dire QUANTO,
  // che e' l'unica cosa che serve sapere. Quindi due pezzi: l'etichetta si
  // tronca, l'importo no — la stessa regola delle righe del carrello.
  const pag = leggi("src/pages/admin/orders.astro");
  const css = pag.match(/\n\s*\.diff-bar \{([^}]*)\}/);
  assert.ok(css, ".diff-bar non e' piu' riconoscibile");
  assert.match(css[1], /flex-wrap: nowrap/, "la barra puo' tornare ad andare a capo");
  assert.match(pag, /\n\s*\.db-lab \{[^}]*text-overflow: ellipsis/,
    "l'etichetta non si tronca piu': tornera' a mandare la riga a capo");
  assert.match(pag, /\n\s*\.db-val \{[^}]*flex: 0 0 auto/,
    "l'importo puo' restringersi: si leggerebbe «differenza da pagare» senza sapere quanto");
  // E le barre si compongono in un posto solo: scritte a mano quattro volte,
  // una perderebbe la divisione fra etichetta e importo.
  const quante = (pag.match(/<div class="diff-bar /g) ?? []).length;
  assert.equal(quante, 1, "le barre sono tornate scritte a mano piu' volte invece di passare da `barra()`");
});

test("il bottone «rimborsa differenza» sta sopra i bottoni classici, su una riga", () => {
  // ⚠️ Stava SOTTO la riga di «Completato / matita / cestino», staccato dal
  // resto dei soldi, e su una card stretta andava a capo diventando alto il
  // doppio. Adesso sta con le altre barre dei soldi, sopra la linea che
  // separa il contenuto dalle azioni, e cede l'etichetta invece dell'importo.
  const pag = leggi("src/pages/admin/orders.astro");
  const iBtn = pag.indexOf("${diffRefundBtn}");
  const iAz = pag.indexOf("${actions}");
  assert.ok(iBtn > 0 && iAz > 0 && iBtn < iAz,
    "«rimborsa differenza» e' tornato sotto i bottoni classici");
  // ⚠️ L'etichetta la scrivono in due — cardHTML e resetConfirm, che la
  // riscrive quando scade la conferma. Se la seconda tornasse a scriverla a
  // mano, dopo aver sfiorato il bottone la riga tornerebbe ad andare a capo.
  assert.match(pag, /const labelDiffRefund = /, "l'etichetta del bottone non ha piu' un posto solo");
  assert.match(pag, /b\.innerHTML = labelDiffRefund\(d\)/,
    "resetConfirm riscrive l'etichetta a mano: dopo il timeout la riga torna a capo");
  assert.equal((pag.match(/tr\("ord\.refundDiff"\)/g) ?? []).length, 1,
    "l'etichetta «rimborsa differenza» e' tornata scritta in piu' posti");
});

test("non si completa un ordine lasciando dei soldi da rendere", () => {
  // ⚠️ IL BUCO (04/10/2026): il bottone «Rimborsa» compare solo sugli ordini
  // `paid`. Completando l'ordine prima di aver reso la differenza, quel
  // bottone spariva e il debito verso il cliente non si vedeva piu' da
  // nessuna parte: restava nel database, invisibile, e nessuno lo avrebbe mai
  // saldato. Nessun errore, nessun avviso — solo un cliente che aspetta sei
  // euro che non arrivano. Adesso «Completato» apre prima il rimborso.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /const daRendere = Math\.max\(0, Math\.round\(Number\(ord\?\.refund_due_cents \?\? 0\)\)\)/,
    "«Completato» non guarda piu' se c'e' una differenza da rendere");
  assert.match(pag, /if \(daRendere > 0\) \{\s*\n\s*apriRimborsoCon\(id, daRendere, true\);/,
    "completare non apre piu' il rimborso: il debito sparisce dalla vista");

  // ⚠️ E deve partire in modo DIFFERENZA. Senza `difference: true` il server
  // non azzera `refund_due_cents`: i soldi escono, il bottone resta, e si
  // rischia di rimborsare due volte.
  assert.match(pag, /\.\.\.\(rfDiff \? \{ difference: true \} : \{\}\)/,
    "il rimborso della differenza parte come rimborso normale: il debito non si azzera e si puo' pagare due volte");
  assert.match(pag, /if \(rfDiff\) ord\.refund_due_cents = Math\.max\(0/,
    "dopo il rimborso il debito non si azzera nella card: il bottone resta su soldi gia' usciti");
});

test("«Incassare» e «Rimborsa» sono la stessa cosa vista dai due lati", () => {
  // Due esiti della stessa modifica — l'ordine cambia, e qualcuno deve dei
  // soldi a qualcun altro. Devono avere lo stesso aspetto e lo stesso posto,
  // altrimenti sembrano due cose senza rapporto.
  const pag = leggi("src/pages/admin/orders.astro");
  const b = pag.match(/\n\s*\.btn-diffrefund \{([\s\S]*?)\n\s*\}/);
  assert.ok(b, ".btn-diffrefund non e' piu' riconoscibile");
  assert.doesNotMatch(b[1], /background: #f0a24b/,
    "«Rimborsa» e' tornato un rettangolo ambra pieno: urla piu' di «Completato», che e' il gesto di ogni giorno");
  assert.match(b[1], /border-radius: 12px/, "«Rimborsa» non ha piu' la forma della barra «Incassare»");
  // Al momento della conferma invece si accende: li' sta per uscire denaro.
  assert.match(pag, /\.btn-diffrefund\.confirm \{ background: #ed6a1c/,
    "la conferma del rimborso non si accende piu': il passaggio in cui escono i soldi non si distingue");
});

test("il supplemento si puo' incassare al banco, e non sparisce se chiudi lo stesso", () => {
  // ⚠️ IL BUCO (04/10/2026): il supplemento — una modifica che alza il totale
  // su un ordine pagato online — si poteva saldare in UN modo solo: il cliente
  // paga il link Stripe. Ma il caso piu' frequente e' che te li dia al banco.
  // Quel denaro entrava nel cassetto e il motore non lo sapeva: la barra
  // «Incassare» restava li' per sempre. E completando l'ordine, spariva.
  const pag = leggi("src/pages/admin/orders.astro");
  const api = leggi("src/pages/api/admin/orders.ts");

  // Si incassa dal pannello, dichiarando il metodo.
  assert.match(pag, /data-act="sup-cash"/, "sparita la scelta «contanti» sul supplemento");
  assert.match(pag, /data-act="sup-card"/, "sparita la scelta «carta» sul supplemento");
  assert.match(api, /const supIncasso = String\(body\.supplement/, "l'API non sa piu' incassare un supplemento al banco");
  assert.match(api, /METODI_CASSA_SCELTA\.includes\(supIncasso\)/, "il supplemento si incassa senza dire come");
  // ⚠️ Due tocchi ravvicinati non devono incassare due volte lo stesso
  // supplemento: il filtro sta nella query, non in un controllo prima.
  assert.match(api, /\.gt\("supplement_due_cents", 0\)/,
    "manca il filtro sul supplemento ancora dovuto: due tocchi lo incasserebbero due volte");

  // ⚠️ E resta VISIBILE sulla card completata, se si e' scelto di chiudere
  // senza incassare. Prima la barra viveva solo su `paid`: completare
  // cancellava dalla vista una somma ancora dovuta.
  assert.match(pag, /const vivo = o\.status === "paid" \|\| o\.status === "done"/,
    "il supplemento e' tornato a vedersi solo sugli ordini in corso: completando, la somma dovuta sparisce dalla card");
});

test("completare con un supplemento in sospeso avverte, ma non blocca", () => {
  // ⚠️ L'asimmetria col rimborso e' voluta. Il rimborso dipende dal
  // ristoratore — preme e i soldi escono — quindi «Completato» lo pretende.
  // Il supplemento no: lo paga il cliente online o lo porta al banco. Bloccare
  // lascerebbe un ordine gia' consegnato per sempre fra gli attivi.
  const pag = leggi("src/pages/admin/orders.astro");
  assert.match(pag, /if \(daIncassare > 0\) \{\s*\n\s*apriSupplemento\(id, daIncassare\);/,
    "completare non avverte piu' del supplemento in sospeso");
  assert.match(pag, /supAnyway\.addEventListener/, "sparita la via d'uscita «completa lo stesso»: l'ordine resterebbe intrappolato");
  assert.match(pag, /tr\("ord\.supAnyway"\)/, "«completa lo stesso» non ha piu' un'etichetta");
});

test("lo stato che disegna le card e' dichiarato una volta, prima di cardHTML", () => {
  // ⚠️ IL GUASTO (04/10/2026, preso da `astro check`): `cardHTML` sta FUORI dal
  // blocco che tiene lo stato della pagina, e leggeva `incassaId`, `incDiffId`
  // e `labelDiffRefund` dall'interno. Tre errori di compilazione, che e' il
  // modo buono di scoprirlo.
  // Il modo cattivo sarebbe stato dichiararli in tutt'e due i posti: nessun
  // errore, e `cardHTML` che legge sempre la copia esterna — vuota — con i
  // bottoni «Contanti/Carta» che non compaiono mai e nessuno che sappia
  // perche'. Per questo si conta che la dichiarazione sia UNA.
  const pag = leggi("src/pages/admin/orders.astro");
  for (const nome of ["incassaId", "incDiffId"]) {
    const quante = (pag.match(new RegExp(`let ${nome}: string \\| null = null;`, "g")) ?? []).length;
    assert.equal(quante, 1, `${nome} e' dichiarato ${quante} volte: cardHTML leggerebbe la copia sbagliata, e la riga di scelta non comparirebbe mai`);
  }
  assert.equal((pag.match(/const labelDiffRefund = /g) ?? []).length, 1, "labelDiffRefund e' dichiarata piu' volte");
  // E stanno PRIMA di chi le usa.
  const iCard = pag.indexOf("function cardHTML(o: Order): string {");
  for (const nome of ["let incassaId", "let incDiffId", "const labelDiffRefund"]) {
    assert.ok(pag.indexOf(nome) < iCard, `${nome} e' finita dopo cardHTML, che la usa`);
  }
});
