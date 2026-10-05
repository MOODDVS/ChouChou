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
  // ⚠️ Chi legge ha trenta secondi e le mani sporche: l'ora deve essere la
  // riga piu' grande, e la prima.
  assert.equal(righe[0].testo, "19:30");
  assert.equal(righe[0].taglia, "gigante");
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
  // La nota del piatto non e' mai piccola.
  const nota = righe.find((r) => r.testo.includes("senza basilico"));
  assert.notEqual(nota.taglia, "piccolo", "la nota del piatto e' diventata piccola: e' la riga che fa sbagliare l'ordine");
});

test("un ordine pagato non puo' avere due ticket automatici", () => {
  // ⚠️ IL GUASTO: lo stesso ordine viene visto piu' volte — webhook Stripe
  // ripetuto, modifica, ricarica — e ogni volta si proverebbe a mettere in
  // coda lo stesso ticket. In cucina due comande uguali sono due pizze.
  // La protezione non puo' stare nel codice che inserisce: deve stare nel
  // database, perche' due richieste possono arrivare nello stesso istante.
  const sql = leggi("supabase/print_tickets.sql");
  assert.match(sql, /create unique index[\s\S]*?print_tickets \(order_id, kind\)[\s\S]*?where origin = 'auto'/,
    "l'indice unico sui ticket automatici non c'e' piu': lo stesso ordine puo' uscire due volte in cucina");
  // E le ristampe a mano devono restare possibili quante se ne vogliono.
  assert.match(sql, /origin[\s\S]*?check \(origin in \('auto', 'manual'\)\)/,
    "sparita la distinzione fra ticket automatico e ristampa: o si bloccano le ristampe, o si perde la protezione dal doppione");
});

test("lo stato «stampato» lo decide la stampante, non noi", () => {
  // ⚠️ Senza uno stato intermedio non si distingue «spedito» da «uscito»: o si
  // perdono ticket (segnati fatti e mai stampati), o si stampano doppi.
  const sql = leggi("supabase/print_tickets.sql");
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
  const api = leggi("src/pages/api/admin/printers.ts");
  assert.equal((api.match(/isSuperUser\(staff\)/g) ?? []).length, 2, "GET e POST devono controllare tutti e due");
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
  const sup = leggi("src/pages/admin/super.astro");
  assert.match(sup, /if \(!rp\.ok\)/, "la scheda e' tornata a non guardare l'esito del salvataggio della stampante");
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
