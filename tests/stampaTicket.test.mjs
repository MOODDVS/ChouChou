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
