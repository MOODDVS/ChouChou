/**
 * LA COLONNA «RÉSERVATIONS» — i conti, i servizi del giorno, la voce del menu.
 *
 * ⚠️ I TRE GUASTI CHE QUESTE PROVE TENGONO CHIUSI, trovati tutti e tre
 * leggendo la colonna riga per riga (08/10/2026):
 *
 *  A. I SERVIZI DI UN GIORNO SPECIALE. La colonna filtrava solo per giorno
 *     della settimana; la pagina Réservations sapeva anche del giorno speciale
 *     «aperto», che li scavalca. Un lunedi' di chiusura aperto per
 *     un'occasione mostrava la scatola dei servizi VUOTA mentre il sito
 *     prendeva prenotazioni — e dentro quella scatola c'e' l'interruttore per
 *     chiudere un servizio.
 *  B. I COPERTI. Volevano dire tre cose in tre posti: `confirmed + seated`
 *     nella risposta del server e nella pastiglia della pagina, `done` nella
 *     mail del mattino. Il primo CALA durante la serata (i tavoli si chiudono
 *     da soli) ed e' zero su ogni giorno passato; il secondo, per la stessa
 *     sera, diceva «40 coperti serviti».
 *  C. LA VOCE DEL MENU. La colonna la segnava col `status` grezzo mentre la
 *     pastiglia mostrava lo stato dell'orologio: una confermata in corso
 *     diceva «En cours» e segnava «Confirmée».
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  copertiDelGiorno, copertiAttesi, righeDelGiorno, daConfermare, daFare, fatte, riempimento,
} from "../src/lib/admin/resaConti.ts";
import { serviziDelGiorno, attivoNelGiornoSpeciale } from "../src/lib/admin/giornataRegole.ts";
import { voceStato, voceStatoDi, minutiDa } from "../src/lib/admin/resaStato.ts";

/* Una serata come quella che ha fatto nascere queste prove: tre tavoli
   confermati, uno a tavola, uno gia' chiuso dall'auto-Fini, una richiesta in
   attesa, un annullato e un non presentatosi. */
const SERATA = [
  { status: "confirmed", people: 4 },
  { status: "seated", people: 2 },
  { status: "done", people: 6 },
  { status: "pending", people: 3 },
  { status: "cancelled", people: 8 },
  { status: "noshow", people: 5 },
];

test("B · i coperti della giornata contano anche i tavoli gia' finiti", () => {
  // 4 + 2 + 6: l'auto-Fini gira a `done` ogni tavolo venti minuti dopo la sua
  // finestra. Senza il `done` questo numero si svuota mentre la serata va
  // avanti, e a mezzanotte dice zero per un servizio pieno.
  assert.equal(copertiDelGiorno(SERATA), 12);
  // ⚠️ Fuori gli annullati e i no-show: non sono venuti. E fuori le richieste
  // da confermare: non sono un impegno, hanno il loro numero.
  assert.equal(copertiAttesi(SERATA), 6, "«ancora da servire» e' un'altra domanda");
  assert.equal(daConfermare(SERATA), 1);
});

test("B · il numero e il suo conteggio vengono dalla stessa selezione", () => {
  // «12 coperti · 3 prenotazioni»: le due cifre della pastiglia nascevano da
  // due filtri scritti a mano uno accanto all'altro, e bastava cambiarne uno.
  const righe = righeDelGiorno(SERATA);
  assert.equal(righe.length, 3);
  assert.equal(righe.reduce((s, r) => s + r.people, 0), copertiDelGiorno(SERATA));
});

test("B · un giorno passato non dice zero coperti", () => {
  // La serata di ieri, chiusa: tutto `done`. Era il caso in cui ogni schermo
  // diceva zero — compresa la mail del mattino quando nessuno aveva riaperto
  // la pagina e le righe erano rimaste `confirmed`.
  assert.equal(copertiDelGiorno([{ status: "done", people: 6 }, { status: "done", people: 4 }]), 10);
  assert.equal(copertiDelGiorno([{ status: "confirmed", people: 6 }]), 6);
});

test("B · «da fare» e «chiuse» sono due elenchi che si chiudono esattamente", () => {
  const a = daFare(SERATA), b = fatte(SERATA);
  assert.equal(a.length + b.length, SERATA.length, "nessuna riga puo' sparire da entrambi");
  assert.deepEqual(a.map((r) => r.status), ["confirmed", "seated", "pending"]);
  assert.deepEqual(b.map((r) => r.status), ["done", "cancelled", "noshow"]);
  // ⚠️ Uno stato che non conosciamo resta DA FARE: scritto a mano, i due
  // filtri gemelli lo lasciavano fuori da tutti e due e la riga non si vedeva
  // piu' da nessuna parte, senza un errore.
  const strano = [{ status: "en_attente_de_rappel", people: 2 }];
  assert.equal(daFare(strano).length, 1);
  assert.equal(fatte(strano).length, 0);
});

test("B · niente percentuale senza capienza, e il 100 % si puo' superare", () => {
  assert.equal(riempimento(12, 0), null, "una percentuale su zero posti e' un numero inventato");
  assert.equal(riempimento(12, null), null);
  assert.equal(riempimento(30, 50), 60);
  // Con due servizi la stessa sala si riempie due volte: «140 %» vuol dire che
  // ha girato, e tagliarlo a 100 nasconderebbe le giornate buone.
  assert.equal(riempimento(70, 50), 140);
});

/* --------------------------------------------------------- */

const SERVIZI = [
  { key: "soir", from: "18:30", to: "22:00", days: [5, 6] },
  { key: "midi", from: "12:00", to: "14:00", days: [] },
  { key: "brunch", from: "9:30", to: "11:30", days: [0] },
];

test("A · i servizi del giorno, in ordine di orario", () => {
  // Sabato (6): la sera e il pranzo («days» vuoto = tutti i giorni).
  const sab = serviziDelGiorno(SERVIZI, { dow: 6 });
  assert.deepEqual(sab.map((s) => s.key), ["midi", "soir"], "mezzogiorno prima della sera");
  // ⚠️ In minuti, non per lettere: «9:30» e «12:00» ordinati come testo
  // metterebbero il brunch dopo il pranzo.
  assert.deepEqual(serviziDelGiorno(SERVIZI, { dow: 0 }).map((s) => s.key), ["brunch", "midi"]);
  // Martedi' (2): resta solo il pranzo. Un servizio del sabato elencato di
  // martedi' porta un interruttore che non chiude niente.
  assert.deepEqual(serviziDelGiorno(SERVIZI, { dow: 2 }).map((s) => s.key), ["midi"]);
});

test("A · un giorno speciale «aperto» scavalca i giorni della settimana", () => {
  // Lunedi' (1) di chiusura, aperto per un'occasione con la sola sera: senza
  // questa regola la colonna mostrava la scatola dei servizi VUOTA, e con lei
  // spariva l'interruttore per chiudere il servizio.
  const lun = serviziDelGiorno(SERVIZI, {
    dow: 1, speciale: true, serviziSpeciali: ["soir|18:30-22:00"],
  });
  assert.deepEqual(lun.map((s) => s.key), ["soir"]);
  // Lista `null` = il giorno speciale apre TUTTO.
  assert.equal(serviziDelGiorno(SERVIZI, { dow: 1, speciale: true, serviziSpeciali: null }).length, 3);
  // Le righe vecchie portano la sola chiave, senza orario.
  assert.ok(attivoNelGiornoSpeciale("midi", "12:00", "14:00", ["midi"]));
  assert.ok(!attivoNelGiornoSpeciale("midi", "12:00", "14:00", ["soir|18:30-22:00"]));
});

test("A · una fascia senza orario non entra fra i servizi del giorno", () => {
  // Niente interruttore per una fascia che non ha un quando: il comando
  // scriverebbe una chiusura su un orario che non esiste.
  const rotti = [{ key: "midi", from: "", to: "14:00", days: [] }, { key: "x", days: [] }];
  assert.equal(serviziDelGiorno(rotti, { dow: 3 }).length, 0);
});

/* --------------------------------------------------------- */

test("C · la voce segnata nel menu e' quella che dice la pastiglia", () => {
  // Confermata, tavolo in corso: la pastiglia dice «En cours», e il menu
  // segnava «Confirmée». Chi lo apriva per metterla a tavola vedeva che era
  // gia' fatto e chiudeva senza toccare niente.
  assert.equal(voceStato("confirmed", "encours"), "seated");
  assert.equal(voceStato("confirmed", "future"), "confirmed");
  // ⚠️ «Fini ?» e' una DOMANDA, non una voce: nel menu si segna «Terminée».
  assert.equal(voceStato("confirmed", "passe"), "done");
  assert.equal(voceStato("seated", "passe"), "done");
  // Uno stato ignoto torna la sua parola grezza: nessuna voce si accende, che
  // e' la verita'.
  assert.equal(voceStato("en_attente", "future"), "en_attente");
  assert.equal(voceStato(null, "future"), "");
});

test("C · la voce, dalla riga e dall'orologio del locale", () => {
  const r = { date: "2026-10-08", heure: "19:30", status: "confirmed", service_key: "soir" };
  const ora = (hhmm) => ({ oggi: "2026-10-08", minuti: minutiDa(hhmm) });
  const servizi = [{ key: "soir", hold: 120 }];
  assert.equal(voceStatoDi(r, ora("18:00"), servizi), "confirmed");
  assert.equal(voceStatoDi(r, ora("20:00"), servizi), "seated");
  assert.equal(voceStatoDi(r, ora("21:31"), servizi), "done");
});

/* ---------- le guardie sul codice delle due pagine ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const PAGINA = readFileSync(new URL("../src/pages/admin/reservations.astro", import.meta.url), "utf8");

test("guardia · le due pagine chiedono i conti al modulo, non se li riscrivono", () => {
  for (const [nome, src] of [["Accueil", HOME], ["Réservations", PAGINA]]) {
    assert.ok(/from "\.\.\/\.\.\/lib\/admin\/resaConti"/.test(src), `${nome} importa resaConti`);
    // ⚠️ La somma dei coperti scritta a mano: e' la riga che in tre posti
    // diversi dava tre numeri per la stessa giornata.
    assert.ok(
      !/status === "confirmed" \|\| r\.status === "seated"\)\s*\n?\s*\.reduce/.test(src),
      `${nome} non riconta i coperti a mano`,
    );
  }
});

test("guardia · i servizi del giorno vengono da `serviziDelGiorno`", () => {
  assert.ok(/serviziDelGiorno\(/.test(HOME), "la colonna della Accueil lo usa");
  assert.ok(/serviziDelGiorno\(/.test(PAGINA), "i filtri della pagina lo usano");
  // Il filtro per `days` scritto a mano nella colonna: era il guasto A.
  assert.ok(
    !/\.filter\(\(sv\) => !Array\.isArray\(sv\.days\) \|\| sv\.days\.length === 0 \|\| sv\.days\.includes\(dow\)\)/.test(HOME),
    "nessun filtro per giorno della settimana riscritto nella colonna",
  );
});

test("guardia · «HH:MM → minuti» sta in un posto solo", () => {
  // Erano due: `minutiDa` nel modulo e `minutiDi` dentro lo script della
  // Accueil, con lo stesso corpo e due nomi.
  assert.ok(!/function minutiDi\(/.test(HOME), "niente seconda copia di minutiDa nella Accueil");
});

/* ---------- la pastiglia del conteggio, in testa alla colonna ---------- */

test("guardia · la pastiglia e' verde da uno in su, rossa a locale chiuso", () => {
  /* ⚠️ «0 aujourd'hui» su una giornata di chiusura si legge come «nessuno ha
     prenotato», che e' un'altra cosa e fa venire voglia di controllare. A
     locale chiuso la pastiglia dice «Fermé aujourd'hui», in rosso.
     ⚠️ E chi decide se e' chiuso e' la colonna «Aujourd'hui» (`statoGiorno`):
     una seconda lettura degli orari vorrebbe dire due colonne accanto che
     possono dire il contrario. */
  assert.ok(/function pastigliaGiorno\(/.test(HOME), "una regola sola per le due colonne");
  assert.ok(/pastigliaGiorno\("j-resa-cnt"/.test(HOME) && /pastigliaGiorno\("j-ord-cnt"/.test(HOME),
    "prenotazioni e ordini la usano");
  assert.ok(/oggiChiuso = stato === "ignoto" \? null : stato === "chiuso"/.test(HOME),
    "lo stato arriva da `statoGiorno`, e «ignoto» non e' «chiuso»");
  assert.ok(/el\.className = n > 0 \? "j-pil" : "j-pil n"/.test(HOME), "verde da uno in su");
  assert.ok(/\.j-pil\.ko \{ background: #ed1c24/.test(HOME), "e il rosso delle chiusure");
});
