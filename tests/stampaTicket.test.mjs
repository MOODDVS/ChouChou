/**
 * IL TICKET DI CUCINA — le regole che non devono cambiare da sole.
 *
 * ⚠️ Un ticket che non esce non fa rumore. Non c'e' un errore a schermo, non
 * c'e' un'email che torna indietro: in cucina semplicemente non arriva niente,
 * e l'ordine si scopre quando il cliente si presenta al banco. Per questo le
 * regole stanno in un file puro e sono guardate qui.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  RIPIEGO_STAMPA, CHIAVI_STAMPA, accesoStampa, stampaAttiva,
  daStampare, attesaTentativo, MAX_TENTATIVI, ticketCucina,
} from "../src/lib/stampaRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");

test("chi non ha la stampante si comporta come ieri", () => {
  // ⚠️ La stampa automatica spenta di ripiego: un cliente che non ha comprato
  // la stampante non deve trovarsi una coda che accumula righe mai stampate.
  assert.equal(RIPIEGO_STAMPA.print_auto, "0");
  assert.equal(RIPIEGO_STAMPA.print_printer_id, "");
  assert.equal(accesoStampa(undefined), false);
  assert.equal(accesoStampa("0"), false);
  assert.equal(accesoStampa("1"), true);
  assert.deepEqual([...CHIAVI_STAMPA].sort(), ["print_auto", "print_printer_id"]);
});

test("volere la stampa non basta: ci vuole la stampante", () => {
  // ⚠️ Stessa trappola dei pagamenti: l'interruttore dice che il ristoratore
  // la vuole, il numero dice che esiste. Acceso senza numero vuol dire mettere
  // in coda ticket che nessuno stampera' mai, e nessuno se ne accorge.
  assert.equal(stampaAttiva("1", "89508"), true);
  assert.equal(stampaAttiva("1", ""), false, "acceso senza stampante: la coda si riempie a vuoto");
  assert.equal(stampaAttiva("1", "   "), false);
  assert.equal(stampaAttiva("0", "89508"), false);
});

test("anche l'ordine da incassare va in cucina", () => {
  // ⚠️ IL GUASTO CHE QUESTA PROVA TIENE CHIUSO: «pagato» non e' la domanda
  // giusta. Un ordine preso dal sito e da pagare al ritiro resta `pending`,
  // ma la cucina lo deve preparare lo stesso. Guardando solo `paid`, quei
  // clienti aspetterebbero una pizza che nessuno ha iniziato.
  assert.equal(daStampare("paid", "card"), true);
  assert.equal(daStampare("pending", "onsite"), true, "l'ordine da incassare non arriva piu' in cucina");
  // Il carrello abbandonato (link di pagamento mai pagato) invece NO: non e'
  // un ordine, e stamparlo vorrebbe dire preparare cibo che nessuno ritira.
  assert.equal(daStampare("pending", "link"), false, "si stampa un carrello abbandonato: cibo preparato per nessuno");
  assert.equal(daStampare("pending", null), false);
  assert.equal(daStampare("cancelled", "card"), false);
  assert.equal(daStampare("done", "card"), false);
});

test("i tentativi si allargano invece di martellare", () => {
  // La causa piu' comune e' la stampante spenta o senza carta: dura minuti.
  const attese = Array.from({ length: MAX_TENTATIVI }, (_, i) => attesaTentativo(i + 1));
  for (let i = 1; i < attese.length; i++) {
    assert.ok(attese[i] > attese[i - 1], `il tentativo ${i + 1} non aspetta piu' del precedente: si martella il servizio di stampa`);
  }
  assert.ok(attese[0] <= 15, "il primo rilancio tarda troppo: un ordine va in cucina subito");
  const totale = attese.reduce((a, b) => a + b, 0);
  assert.ok(totale >= 1200, "si smette di riprovare troppo presto: nessuno fa in tempo a rimettere la carta");
  // Fuori scala non deve lanciare: una riga con tentativi storti non puo'
  // fermare tutta la coda.
  assert.equal(attesaTentativo(0), attese[0]);
  assert.equal(attesaTentativo(99), attese[attese.length - 1]);
  assert.equal(attesaTentativo(NaN), attese[0]);
});

test("il ticket di cucina non e' uno scontrino", () => {
  const righe = ticketCucina({
    insegna: "450 Gradi",
    numero: "4f21a8c3",
    ora: "19:30",
    cliente: "Vincenzo Santamaria",
    telefono: "+32 487544480",
    note: "Suonare al citofono 2",
    daIncassare: true,
    piatti: [
      { qty: 2, nome: "Pizza Margherita", variante: "33 cm", nota: "senza basilico" },
      { qty: 1, nome: "Calzone farcito" },
    ],
  });
  const testo = righe.map((r) => r.testo).join("\n");

  // ⚠️ In testa DI CHI e' l'ordine. In una cucina che prepara per due marchi
  // (o per due punti) e' la prima domanda, prima di «che cosa contiene».
  assert.equal(righe[0].testo, "450 GRADI");
  assert.equal(righe[0].taglia, "gigante");

  // ⚠️ L'ora due volte, e non e' una svista: sul ferma-comande si vede solo
  // la prima riga di ogni ticket, il resto lo copre quello davanti. Piccola
  // in alto per sapere quale va in forno adesso, grossa sotto per chi ce
  // l'ha in mano.
  assert.match(righe[1].testo, /RITIRO 19:30/);
  assert.equal(righe[1].taglia, "piccolo");
  const grossa = righe.filter((r) => r.testo === "19:30" && r.taglia === "gigante");
  assert.equal(grossa.length, 1, "l'ora grossa non c'e' piu', o ce n'e' piu' d'una");

  // Niente prezzi, niente email: sono righe che coprono quelle che contano.
  assert.doesNotMatch(testo, /€|EUR|\d+,\d{2}/, "sul ticket di cucina sono comparsi dei prezzi");
  assert.doesNotMatch(testo, /@/, "sul ticket di cucina e' comparsa un'email");

  // I piatti ci sono tutti, con quantita', formato e nota.
  assert.match(testo, /2x Pizza Margherita/);
  assert.match(testo, /33 cm/);
  assert.match(testo, /senza basilico/, "la nota del piatto non c'e' piu': e' il punto in cui si sbaglia un ordine");
  assert.match(testo, /1x Calzone farcito/);

  // ⚠️ «Da incassare» PRIMA dei piatti: chi prepara passa il sacchetto a chi
  // sta in cassa, e deve saperlo prima di consegnarlo.
  const iIncasso = testo.indexOf("DA INCASSARE");
  const iPiatti = testo.indexOf("2x Pizza Margherita");
  assert.ok(iIncasso > 0 && iIncasso < iPiatti, "«da incassare» e' finito dopo i piatti: si consegna un sacchetto non pagato");

  // L'ora grossa e il cliente stanno DOPO i piatti: il ticket si legge
  // dall'alto, e in cima c'e' il lavoro.
  assert.ok(testo.lastIndexOf("19:30") > iPiatti, "l'ora grossa e' tornata sopra i piatti");
  assert.ok(testo.indexOf("Vincenzo Santamaria") > iPiatti);

  // La nota del piatto non e' mai piccola.
  const nota = righe.find((r) => r.testo.includes("senza basilico"));
  assert.notEqual(nota.taglia, "piccolo", "la nota del piatto e' diventata piccola: e' la riga che fa sbagliare l'ordine");
});

test("fra un piatto e l'altro c'e' aria, in fondo all'elenco no", () => {
  // ⚠️ Una riga vuota dopo OGNI piatto allarga il ticket senza separare
  // niente: l'ultima non ha un piatto sotto da cui staccarsi. A fine serata
  // sono centimetri di carta, e un ticket piu' lungo si legge peggio.
  const righe = ticketCucina({
    insegna: "450 Gradi", numero: "4F2A", ora: "19:45", cliente: "Marco Rossi",
    piatti: [{ qty: 1, nome: "Margherita" }, { qty: 2, nome: "Diavola" }, { qty: 3, nome: "Acqua" }],
  });
  const i = righe.findIndex((r) => r.testo === "1x Margherita");
  assert.equal(righe[i + 1].testo, "", "manca l'aria fra il primo piatto e il secondo");
  assert.equal(righe[i + 2].testo, "2x Diavola");
  assert.equal(righe[i + 3].testo, "");
  assert.equal(righe[i + 4].testo, "3x Acqua");
  // Dopo l'ultimo piatto c'e' la riga di chiusura, non un'altra riga vuota.
  assert.equal(righe[i + 5].linea, true, "dopo l'ultimo piatto e' rimasta una riga vuota che non separa niente");
});

test("il disegno del ticket vive nel cliente, non nel motore", () => {
  // ⚠️ Ogni ristorante vuole il suo ticket: chi il logo, chi il telefono
  // grande perche' richiama sempre, chi l'ora in cima. Finche' il disegno
  // stava in `lib/stampaRegole.ts`, cambiarlo voleva dire modificare il
  // MOTORE dentro il cliente: funziona una volta, poi litiga a ogni merge
  // finche' qualcuno risolve il conflitto nel verso sbagliato e il
  // ristorante si ritrova il ticket di qualcun altro.
  //
  // La cucitura e' `config/ticket.ts`, come `config/client.ts`: cio' che e'
  // del cliente vive in `config/`, e il motore non lo tocca piu'.
  const rotta = leggi("src/pages/api/print/[token].ts");
  assert.match(rotta, /from "\.\.\/\.\.\/\.\.\/config\/ticket"/, "la rotta non prende piu' il disegno dal cliente");
  assert.doesNotMatch(rotta, /componiTesto\(ticketCucina\(/, "la rotta e' tornata a stampare il disegno del motore, saltando quello del cliente");

  const mio = leggi("src/config/ticket.ts");
  assert.match(mio, /export function disegnaTicket/, "il file del cliente non esporta piu' il disegno");
});

test("senza insegna il ticket comincia dalla riga di servizio", () => {
  // Un cliente che non vuole il nome in testa non deve ritrovarsi una riga
  // vuota grande come un titolo.
  const righe = ticketCucina({ numero: "4F2A", ora: "19:45", cliente: "Marco Rossi", piatti: [{ qty: 1, nome: "Margherita" }] });
  assert.match(righe[0].testo, /^#4F2A/);
  assert.equal(righe[0].taglia, "piccolo");
});

test("un ordine pagato non puo' avere due ticket automatici", () => {
  // ⚠️ IL GUASTO: lo stesso ordine viene visto piu' volte — webhook Stripe
  // ripetuto, modifica, ricarica — e ogni volta si proverebbe a mettere in
  // coda lo stesso ticket. In cucina due comande uguali sono due pizze.
  // La protezione non puo' stare nel codice che inserisce: deve stare nel
  // database, perche' due richieste possono arrivare nello stesso istante.
  const sql = leggi("supabase/076_print_tickets.sql");
  assert.match(sql, /create unique index[\s\S]*?print_tickets \(order_id, kind\)[\s\S]*?where origin = 'auto'/,
    "l'indice unico sui ticket automatici non c'e' piu': lo stesso ordine puo' uscire due volte in cucina");
  // E le ristampe a mano devono restare possibili quante se ne vogliono.
  assert.match(sql, /origin[\s\S]*?check \(origin in \('auto', 'manual'\)\)/,
    "sparita la distinzione fra ticket automatico e ristampa: o si bloccano le ristampe, o si perde la protezione dal doppione");
});

test("lo stato «stampato» lo decide la stampante, non noi", () => {
  // ⚠️ Senza uno stato intermedio non si distingue «spedito» da «uscito»: o si
  // perdono ticket (segnati fatti e mai stampati), o si stampano doppi.
  const sql = leggi("supabase/076_print_tickets.sql");
  assert.match(sql, /check \(status in \('queued', 'sent', 'printed', 'failed'\)\)/,
    "gli stati della coda sono cambiati: servono tutti e quattro per sapere se un ticket e' davvero uscito");
  assert.match(sql, /printed_at/, "sparita l'ora di stampa: non si puo' piu' dire quando il ticket e' uscito");
});

// ============================================================
// DALL'ORDINE AL TICKET, E LA SERRATURA DELLA PAGINA PUBBLICA
// ============================================================
import { ordineDaRiga } from "../src/lib/stampaRegole.ts";
import { firmaProva, leggiProva, sembraProva, VALIDITA_PROVA_S } from "../src/lib/printToken.ts";

const RIGA = {
  id: "9a1b2c3d-0000-4000-8000-00000000"+"4f2a",
  status: "pending",
  payment_method: "onsite",
  customer_name: "Marco Rossi",
  customer_phone: "0472 11 22 33",
  items: [
    { id: "p1", name: "Pizza Margherita — 33 cm", base_name: "Pizza Margherita", variant_label: "33 cm", qty: 2 },
    { id: "p2", name: "Bruschette", qty: 1, notes: "sans ail" },
    { id: "note", name: "NOTE CLIENT", qty: 0, notes: "Je passe avec 10 min de retard" },
  ],
};

test("la nota dell'ordine si legge dove e' scritta davvero", () => {
  // ⚠️ La riga della nota ha `name` = «NOTE CLIENT» e il testo vero in
  // `notes`. Prendere `name` stamperebbe NOTE CLIENT su ogni ticket e
  // butterebbe via la nota — che spesso e' un'allergia.
  const o = ordineDaRiga(RIGA, "19:45");
  assert.equal(o.note, "Je passe avec 10 min de retard");
  assert.equal(o.piatti.length, 2, "la riga della nota e' finita tra i piatti");
  assert.equal(o.piatti[0].nome, "Pizza Margherita", "il nome porta dentro il formato: finirebbe due volte sul ticket");
  assert.equal(o.piatti[0].variante, "33 cm");
  assert.equal(o.piatti[1].nota, "sans ail");
});

test("il numero del ticket si legge a voce al banco", () => {
  // Il database non ha un numero d'ordine: solo un id lungo. Quattro cifre
  // sono quello che una persona riesce a dire e un'altra a ritrovare.
  assert.equal(ordineDaRiga(RIGA, "19:45").numero, "4F2A");
});

test("«da incassare» e' una domanda sui soldi, non sullo stato", () => {
  // ⚠️ Un ordine telefonico pagato al ritiro resta `pending` fino al banco:
  // quella fascia nera e' l'unica cosa che impedisce di consegnarlo senza
  // farsi pagare. Un ordine gia' pagato non deve mostrarla, se no si incassa
  // due volte.
  assert.equal(ordineDaRiga(RIGA, "19:45").daIncassare, true);
  assert.equal(ordineDaRiga({ ...RIGA, status: "paid" }, "19:45").daIncassare, false);
  assert.equal(ordineDaRiga({ ...RIGA, payment_method: "link" }, "19:45").daIncassare, false);
});

test("il biglietto della stampa di prova scade da solo", () => {
  // ⚠️ Un token che non scade e' un indirizzo pubblico che fa uscire carta da
  // una stampante vera, per sempre: basta ritrovarlo in una cronologia.
  const t0 = Date.now();
  const tok = firmaProva("", "segreto-di-prova", t0);
  assert.ok(sembraProva(tok));
  assert.deepEqual(leggiProva(tok, "segreto-di-prova", t0 + 1000), { sede: "" });
  assert.equal(leggiProva(tok, "segreto-di-prova", t0 + (VALIDITA_PROVA_S + 2) * 1000), null, "il biglietto non scade");
});

test("un biglietto ritoccato o firmato da altri non apre niente", () => {
  const t0 = Date.now();
  const tok = firmaProva("abc", "segreto-di-prova", t0);
  assert.equal(leggiProva(tok, "un-altro-segreto", t0), null, "un segreto diverso apre lo stesso");
  assert.equal(leggiProva(tok.slice(0, -2) + "xy", "segreto-di-prova", t0), null, "la firma non e' verificata");
  assert.equal(leggiProva(tok, "", t0), null, "senza segreto il biglietto vale: la serratura non c'e'");
  assert.deepEqual(leggiProva(tok, "segreto-di-prova", t0), { sede: "abc" });
});

test("la pagina del ticket non filtra per sede quando cerca il token", () => {
  // ⚠️ Stessa trappola dell'annullo pubblico: il token E' l'autorizzazione.
  // Filtrando per sede, la stampa funzionerebbe solo per il primo punto e per
  // gli altri non uscirebbe niente — senza nessun errore da nessuna parte.
  const rotta = leggi("src/pages/api/print/[token].ts");
  assert.match(rotta, /leggi\("print_tickets", tutteLeSedi\(\)/, "il token si cerca su tutte le sedi, non su quella selezionata");
  assert.match(rotta, /ambitoDiRiga\(riga\.location_id/, "l'ordine si legge nell'ambito della SUA riga");
  assert.match(rotta, /text\/plain/, "il ticket deve uscire come testo: un tipo binario lo fa scaricare invece di stamparlo");
  assert.match(rotta, /status: "sent"/, "la riga non passa piu' per `sent`: si perderebbe la differenza tra consegnato e stampato");
  assert.doesNotMatch(rotta, /status: "printed"/, "«stampato» lo dice la stampante, non noi");
});

test("le chiavi del servizio di stampa non escono dal server", () => {
  // ⚠️ IL PRECEDENTE (04/10/2026): uno script mascherava solo le chiavi che
  // conosceva e ha stampato in chiaro quelle delle station, che stavano nella
  // risposta. Le station sono state rifatte da zero. Qui l'elenco lo chiede
  // il SERVER e di ritorno escono nomi e numeri: una chiave nel pannello
  // sarebbe una chiave nel browser, cioe' dappertutto.
  const lib = leggi("src/lib/bizprint.ts");
  const api = leggi("src/pages/api/admin/printers.ts");
  assert.doesNotMatch(api, /BIZPRINT_(PUBLIC|SECRET)_KEY/, "la rotta tocca le chiavi: devono restare in bizprint.ts");
  assert.match(lib, /secretKey\|publicKey\|key\|token\|apiKey/, "la maschera non copre piu' tutti i nomi di campo");
  for (const f of [lib, api]) {
    assert.doesNotMatch(f, /console\.(log|error|warn)\([^)]*\bsec\b/, "una chiave finisce nei log del server");
  }
});

test("solo il super admin tocca le stampanti", () => {
  // La stampante la collega MOODD quando installa: un numero scelto a caso dal
  // ristoratore e' un ticket che non esce, e nessuno che sappia perche'.
  // ⚠️ Si contano i VERBI, non un numero scritto a mano. Il primo test diceva
  // «devono essere due»: col PUT dell'installazione sono diventati tre, e un
  // numero fisso avrebbe chiesto solo di essere aggiornato. Legato ai verbi,
  // una rotta nuova senza controllo lo fa fallire — che e' il suo mestiere.
  const api = leggi("src/pages/api/admin/printers.ts");
  const verbi = api.match(/export const (GET|POST|PUT|PATCH|DELETE):\s*APIRoute/g) ?? [];
  assert.ok(verbi.length >= 2, "la rotta delle stampanti non esporta piu' niente?");
  assert.equal((api.match(/isSuperUser\(staff\)/g) ?? []).length, verbi.length,
    `${verbi.length} verbi esportati ma non altrettanti controlli: uno di loro e' aperto a chiunque`);
  assert.match(api, /nonAutorizzato\(\)/);
});

test("«inviato» non e' «stampato», nemmeno nella prova", () => {
  // ⚠️ Il lavoro passa per il cloud, per il tablet e per la stampante: puo'
  // morire in ognuno dei tre. Dire «stampato» quando sappiamo solo di aver
  // spedito e' il modo di perdere ticket credendoli fatti.
  const lib = leggi("src/lib/bizprint.ts");
  assert.match(lib, /ok` vuol dire SPEDITO/, "e' sparito l'avvertimento: qualcuno leggera' ok come «stampato»");
  assert.doesNotMatch(lib, /printed/, "bizprint.ts non deve decidere cosa e' stampato");
});

test("le chiavi della stampa sono classificate: se no la scrittura esplode", () => {
  // ⚠️ IL GUASTO (05/10/2026, in produzione): si sceglieva la stampante, si
  // salvava, e riaprendo la scheda era «aucune». `scriviConfig` LANCIA su una
  // chiave non dichiarata in CLASSIFICA_CONFIG — ed e' giusto che lo faccia,
  // e' il solo momento in cui qualcuno sta guardando. Ma nessuno guardava: la
  // scheda non leggeva l'esito di quella PATCH e diceva «salvato» lo stesso.
  // Due difetti sovrapposti, e il secondo nascondeva il primo.
  const reg = leggi("src/lib/admin/sedeRegole.ts");
  for (const k of CHIAVI_STAMPA) {
    assert.match(reg, new RegExp(`\\n\\s*${k}:\\s*"(sede|marchio)"`), `${k} non e' in CLASSIFICA_CONFIG: scriverla lancia`);
  }
  // ⚠️ Si chiede che la stampante passi dalla porta che GUARDA l'esito, non
  // che esista una certa variabile: la prima stesura pretendeva `if (!rp.ok)`
  // ed e' diventata rossa il giorno in cui quelle righe sono state raccolte
  // in `patchSede` — cioe' il giorno in cui il controllo e' stato esteso a
  // tutte le altre scritture. Un test sulla FORMA si rompe quando il codice
  // migliora.
  const sup = leggi("src/pages/admin/super.astro");
  assert.match(
    sup,
    /await patchSede\(\{\s*\n?\s*id,\s*\n?\s*printer_id:/,
    "il salvataggio della stampante non passa piu' da patchSede: tornerebbe una scrittura di cui nessuno legge l'esito",
  );
  assert.match(sup, /if \(!r\.ok\) throw new Error/, "patchSede non lancia piu' su errore");
});

test("il biglietto di prova non sembra un file", () => {
  // ⚠️ `/api/print/p.XXX.YYY` sembra un nome di file con un'estensione, e fra
  // un proxy, un server statico e una regola di cache c'e' sempre qualcuno
  // disposto a trattarlo come tale invece di passarlo alla rotta.
  const tok = firmaProva("", "segreto-di-prova");
  assert.doesNotMatch(tok, /\./, "il token contiene un punto: prima o poi qualcuno lo servira' come file");
  assert.ok(tok.startsWith("~"), "il biglietto non si distingue piu' dal token di una riga della coda");
  assert.match(leggi("src/pages/api/print/[token].ts"), /\^\[A-Za-z0-9~/, "la rotta non accetta piu' il separatore del biglietto");
});

test("l'indirizzo del ticket parte in https, o il tablet lo rifiuta", () => {
  // ⚠️ IL GUASTO (05/10/2026, visto sul tablet): dietro Hostinger il TLS
  // finisce sul proxy e il server Node vede una richiesta `http`, quindi
  // spediva `http://restohub.moodd.online/...`. Android rifiuta il traffico in
  // chiaro — «CLEARTEXT communication not permitted» — e il lavoro restava
  // «inviato» senza che uscisse mai carta: nessun errore da nessuna parte, e
  // l'unico posto dove si poteva leggere il motivo era lo schermo del tablet.
  // ⚠️ La regola vive in `indirizzoPubblico.ts`, non piu' nella rotta: era la
  // stessa domanda che si facevano le email e la coda, e ognuno se la
  // rispondeva per conto suo. La prova se l'era risposta con `http`.
  const ind = leggi("src/lib/indirizzoPubblico.ts");
  assert.match(ind, /PUBLIC_SITE_URL/, "non parte piu' dalla verita' configurata, la stessa delle email");
  assert.match(ind, /x-forwarded-proto/, "lo schema non arriva piu' dal proxy");
  assert.match(ind, /\? "https"|\: "https"|"https"\)/, "sparito il ripiego su https: si tornerebbe a spedire http");
  assert.match(ind, /localhost\|127/, "in sviluppo si spedirebbe https su localhost, che non risponde");
  const api = leggi("src/pages/api/admin/printers.ts");
  // E l'indirizzo torna indietro: un lavoro «inviato» che non stampa deve
  // lasciare qualcosa da guardare.
  assert.match(api, /json\(\{ ok: true, jobId: r\.jobId, url \}\)/, "l'indirizzo spedito non torna piu' al pannello");
});

test("il ticket parte dallo stesso punto dell'avviso alla cucina", () => {
  // ⚠️ Due punti diversi vorrebbero dire un ordine annunciato per email e non
  // stampato, o il contrario — e nessuno dei due si vede finche' qualcuno non
  // se ne lamenta. Dove parte `inviaNotifiche` parte `accodaTicket`.
  for (const f of ["src/lib/confermaOrdine.ts", "src/pages/api/admin/orders.ts"]) {
    const src = leggi(f);
    assert.match(src, /void accodaTicket\(/, `${f}: il ticket non parte piu' da qui`);
    assert.match(src, /inviaNotifiche\(/, `${f}: e' sparito l'avviso alla cucina`);
  }
});

test("la stampa non puo' far fallire un ordine", () => {
  // ⚠️ Un ticket che non esce e' un fastidio; un ordine che non si registra
  // perche' la stampante e' spenta e' una perdita. Si chiama con `void`, come
  // le email, e ogni errore muore qui dentro.
  const coda = leggi("src/lib/stampaCoda.ts");
  assert.match(coda, /\} catch \(e\) \{/, "accodaTicket puo' propagare un errore a chi registra l'ordine");
  assert.match(coda, /Promise<void>/, "accodaTicket rende qualcosa: qualcuno si mettera' ad aspettarla");
});

test("il doppio ticket lo impedisce il database, non un controllo", () => {
  // ⚠️ Un ordine pagato puo' essere visto piu' volte (webhook ripetuto,
  // ritorno dal pagamento, modifica). Un «esiste gia'?» fatto nel codice non
  // basta: due richieste possono arrivare nello stesso istante e passarlo
  // tutte e due. In cucina due comande uguali sono due pizze.
  const coda = leggi("src/lib/stampaCoda.ts");
  assert.match(coda, /23505/, "sparita la gestione dell'indice unico: il doppione tornerebbe un errore rosso");
  assert.doesNotMatch(coda, /select\("id"\)[\s\S]{0,80}eq\("order_id"/, "e' tornato un controllo «esiste gia'?» al posto dell'indice");
});

test("la coda non dichiara stampato cio' che ha solo spedito", () => {
  // `sent` vuol dire «il servizio ha chiesto il ticket», e lo scrive la rotta
  // pubblica quando il tablet la apre davvero. Se lo scrivesse la coda, un
  // lavoro partito e mai stampato sembrerebbe uscito.
  const coda = leggi("src/lib/stampaCoda.ts");
  assert.doesNotMatch(coda, /status: "(sent|printed)"/, "la coda si e' messa a decidere cosa e' uscito dalla stampante");
  assert.match(coda, /status: "queued"/);
});

test("l'indirizzo del ticket ha una risposta sola", () => {
  // ⚠️ Era la stessa domanda in tre posti: le email, la prova di stampa, la
  // coda. La prova se la costruiva da sola e ci ha messo dentro `http`.
  const coda = leggi("src/lib/stampaCoda.ts");
  const api = leggi("src/pages/api/admin/printers.ts");
  for (const [f, src] of [["stampaCoda", coda], ["printers", api]]) {
    assert.match(src, /indirizzoPubblico\(/, `${f}: non usa piu' l'indirizzo dichiarato`);
    assert.doesNotMatch(src, /new URL\(request\.url\)\.origin/, `${f}: se lo ricostruisce di nuovo da solo`);
  }
  // Un lavoro automatico non ha nessuna richiesta sottomano: deve poter
  // rispondere lo stesso, o non accodare niente invece di accodare un
  // indirizzo che non esiste.
  assert.match(coda, /if \(!base\)/, "senza indirizzo la coda accoda lo stesso: cinque tentativi verso il nulla");
});

// ============================================================
// PIU' STAMPANTI: CHI STAMPA COSA
// ============================================================
import { dividiTicket, leggiDestinazioni, categorieDoppie, idStampante, MAX_DESTINAZIONI } from "../src/lib/stampaRegole.ts";

const PIATTI = [
  { qty: 2, nome: "Pizza Margherita", categoria: "Pizze" },
  { qty: 3, nome: "Eau p", categoria: "Bibite" },
  { qty: 1, nome: "Tiramisu", categoria: "Dolci" },
  { qty: 1, nome: "Piatto sparito", categoria: null },
];
const DEST = [
  { nome: "Bar", cat: ["Bibite"], printer: "222" },
  { nome: "Forno", cat: ["Pizze"], printer: "333" },
];

test("quello che nessuno ha chiesto esce dalla principale", () => {
  // ⚠️ E' la regola che impedisce a un piatto di finire NEL NULLA: una
  // categoria nuova, una rinominata, un piatto cancellato dal menu. Un ticket
  // sulla stampante sbagliata si vede; uno che non esce no.
  const g = dividiTicket(PIATTI, DEST, "111");
  assert.equal(g[0].chiave, "", "la principale non e' piu' la prima: il numero di parte cambierebbe a ogni ordine");
  assert.deepEqual(g[0].piatti.map((p) => p.nome), ["Tiramisu", "Piatto sparito"]);
  assert.deepEqual(g.map((x) => x.chiave), ["", "Bar", "Forno"], "l'ordine dei gruppi non segue piu' la configurazione");
  assert.equal(g.find((x) => x.chiave === "Forno").printer, "333");
});

test("nessun ticket vuoto, nessuna stampa pagata per un'intestazione", () => {
  const soloPizze = dividiTicket([{ qty: 1, nome: "Margherita", categoria: "Pizze" }], DEST, "111");
  assert.equal(soloPizze.length, 1, "e' nato un gruppo senza piatti");
  assert.equal(soloPizze[0].chiave, "Forno");
});

test("una destinazione senza stampante non fa sparire i suoi piatti", () => {
  // Una riga a meta' (nome e categorie, ma nessuna stampante) non e' una
  // destinazione: i suoi piatti devono tornare sulla principale, non
  // svanire.
  const g = dividiTicket(PIATTI, [{ nome: "Bar", cat: ["Bibite"], printer: "" }], "111");
  assert.equal(g.length, 1);
  assert.ok(g[0].piatti.some((p) => p.nome === "Eau p"), "le bibite sono sparite");
});

test("una categoria su due stampanti sono due comande, cioe' due pizze", () => {
  assert.deepEqual(categorieDoppie([{ cat: ["Pizze", "Bibite"] }, { cat: ["Bibite"] }]), ["Bibite"]);
  assert.deepEqual(categorieDoppie([{ cat: ["Pizze"] }, { cat: ["Bibite"] }]), []);
  // E se ci finisse lo stesso, la prima riga vince: un piatto, un ticket.
  const g = dividiTicket(PIATTI, [
    { nome: "A", cat: ["Pizze"], printer: "1" },
    { nome: "B", cat: ["Pizze"], printer: "2" },
  ], "111");
  assert.equal(g.filter((x) => x.piatti.some((p) => p.nome === "Pizza Margherita")).length, 1);
});

test("una configurazione storta non impedisce all'ordine di stamparsi", () => {
  // ⚠️ `leggiDestinazioni` non lancia mai: una riga rotta nel database non
  // deve bloccare la stampa, deve solo far cadere tutto sulla principale.
  assert.deepEqual(leggiDestinazioni("{non json"), []);
  assert.deepEqual(leggiDestinazioni(null), []);
  assert.deepEqual(leggiDestinazioni('[{"nome":"Bar","cat":[],"printer":"9"}]'), [], "una riga senza categorie non e' una destinazione");
  assert.deepEqual(leggiDestinazioni('[{"nome":"Bar","cat":["Bibite"],"printer":""}]'), [], "una riga senza stampante non e' una destinazione");
  assert.equal(leggiDestinazioni('[{"nome":"Bar","cat":["Bibite"],"printer":"9"}]').length, 1);
});

test("un ticket parziale lo dice, e dice cosa manca", () => {
  // ⚠️ Chi prepara legge un foglio che SEMBRA tutto l'ordine ed e' un terzo.
  // Senza il conteggio nessuno si accorge che una delle altre stampanti non
  // ha stampato.
  const base = { numero: "4F2A", ora: "19:45", cliente: "Marco Rossi", piatti: [{ qty: 1, nome: "Margherita" }] };
  const righe = ticketCucina({
    ...base,
    parte: { n: 1, su: 3, altri: [{ nome: "Bar", righe: 3 }, { nome: "Forno", righe: 2 }] },
  });
  const testo = righe.map((r) => r.testo).join("\n");
  assert.match(testo, /1\/3/, "il ticket non dice piu' che e' una parte");
  assert.match(testo, /3x Bar/, "non dice cosa esce dalle altre stampanti");
  // Con una stampante sola quella riga non deve comparire: sarebbe rumore.
  const sola = ticketCucina({ ...base, parte: { n: 1, su: 1, altri: [] } });
  assert.doesNotMatch(sola.map((r) => r.testo).join("\n"), /1\/1/);
});

test("l'indice unico della coda conta anche la stampante", () => {
  // ⚠️ IL GUASTO EVITATO: l'indice della #76, su (order_id, kind), vietava il
  // secondo e il terzo ticket dello stesso ordine — cioe' proprio le bibite
  // al bar. Si scopre qui, o in servizio quando il bar non riceve niente.
  const sql = leggi("supabase/077_print_tickets_dest.sql");
  assert.match(sql, /add column if not exists dest/i);
  assert.match(sql, /\(order_id, kind, dest\) where origin = 'auto'/);
  assert.match(sql, /drop index if exists print_tickets_auto_unico/i, "il vecchio indice resta accanto al nuovo: due regole sullo stesso fatto");
  // ⚠️ Si controlla che la coda usi la COSTANTE, non la stringa scritta a
  // mano: il nome della chiave e' dichiarato in `stampaRegole` e basta. Il
  // primo test che ho scritto pretendeva il contrario — cioe' puniva proprio
  // la regola che chiedo dappertutto.
  const coda = leggi("src/lib/stampaCoda.ts");
  assert.match(coda, /CHIAVE_DESTINAZIONI/, "la coda non legge piu' le destinazioni");
  assert.doesNotMatch(coda, /"print_destinazioni"/, "il nome della chiave e' scritto a mano: due posti, e un giorno uno dei due cambia");
});

test("una lettura che non riesce lo dice, invece di far sparire le cose", () => {
  // ⚠️ IL DIFETTO: `chiediCategorie` accendeva il flag «gia' chieste» PRIMA
  // della risposta e non ne guardava l'esito. Un 403 o un 500 lasciavano
  // l'elenco vuoto e il flag acceso: le caselle delle categorie non
  // comparivano MAI PIU' fino al ricarico, e niente diceva perche'. Stessa
  // cosa per la configurazione della stampa in Intégrations, dove un errore
  // si leggeva come «niente di configurato» — cioe' come se nessuno avesse
  // mai salvato.
  const sup = leggi("src/pages/admin/super.astro");

  const cat = sup.slice(sup.indexOf("async function chiediCategorie"));
  const corpoCat = cat.slice(0, cat.indexOf("\n        }"));
  assert.match(corpoCat, /if \(!r\.ok\)/, "chiediCategorie non guarda piu' l'esito");
  assert.match(corpoCat, /categorieChieste = false/, "senza rimettere il flag, non si riprova piu' fino al ricarico");
  assert.match(corpoCat, /erroreCategorie = /, "l'errore non viene piu' conservato: non resterebbe niente da mostrare");

  // E l'errore si VEDE: un elenco vuoto senza spiegazione sembra un guasto
  // del pannello, e «il menu non ha categorie» non e' «la lista non e'
  // arrivata» — si riparano in due posti diversi.
  assert.match(
    sup,
    /erroreCategorie \|\| L\.catVuote/,
    "la riga di destinazione non distingue piu' «nessuna categoria» da «non sono arrivate»",
  );

  const inst = sup.slice(sup.indexOf("async function caricaStampaInstallazione"));
  assert.match(
    inst.slice(0, inst.indexOf("\n        }")),
    /if \(!r\.ok\)/,
    "la configurazione della stampa di Intégrations torna a leggere un errore come «non configurato»",
  );
});

test("il numero di una stampante e' un numero, ovunque lo si legga", () => {
  // ⚠️ La regola c'era solo per la stampante PRINCIPALE: quelle dentro le
  // destinazioni passavano come stringhe qualunque. Lo stesso dato con due
  // regole diverse a seconda della casella in cui era stato scritto — e un
  // ticket mandato a una stampante che non esiste non esce e non lo dice.
  for (const buono of ["1", "95656", "000123"]) assert.equal(idStampante(buono), buono);
  assert.equal(idStampante("  42  "), "42", "gli spazi di chi incolla non sono un errore");
  for (const cattivo of ["", "   ", "Ice", "95656a", "12 34", "-1", "1e3", "1234567890123", null, undefined, {}]) {
    assert.equal(idStampante(cattivo), "", `${JSON.stringify(cattivo)} non e' un numero di stampante`);
  }

  // E la regola vale anche dentro le destinazioni: una riga con la stampante
  // scritta male non e' una destinazione, come una senza.
  assert.deepEqual(
    leggiDestinazioni('[{"nome":"Bar","cat":["Bibite"],"printer":"Ice"}]'),
    [],
    "una stampante scritta a mano passava come buona",
  );

  // Chi decide dove va il ticket usa la stessa regola, in scrittura e in
  // lettura: in un database vivo c'e' quello che ci hanno scritto prima.
  for (const f of ["src/lib/stampaConfig.ts", "src/lib/stampaCoda.ts", "src/pages/api/print/[token].ts"]) {
    assert.match(readFileSync(f, "utf8"), /idStampante\(/, `${f}: non usa la regola comune`);
  }
});

test("una configurazione gonfiata non diventa la configurazione", () => {
  // Nessun tetto: un corpo malformato poteva riempire la chiave di righe che
  // nessuno rileggera' mai. Un ristorante ne usa tre o quattro.
  const tante = JSON.stringify(
    Array.from({ length: MAX_DESTINAZIONI + 15 }, (_, i) => ({ nome: `D${i}`, cat: [`C${i}`], printer: "9" })),
  );
  assert.equal(leggiDestinazioni(tante).length, MAX_DESTINAZIONI);

  // La stessa categoria due volte NELLA STESSA RIGA non vuol dire niente:
  // faceva scattare «categoria doppia», che parla di due righe, davanti a
  // chi ne ha una sola.
  const r = leggiDestinazioni('[{"nome":"Bar","cat":["Bibite","Bibite"],"printer":"9"}]');
  assert.deepEqual(r[0].cat, ["Bibite"]);
  assert.deepEqual(categorieDoppie(r), [], "una riga sola non puo' essere in conflitto con se stessa");
});
