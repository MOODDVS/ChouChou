/**
 * LO STATO CHE SI VEDE — una regola, due schermi.
 *
 * ⚠️ IL GUASTO CHE QUESTE PROVE TENGONO CHIUSO (07/10/2026, Educazione
 * Napoletana). La stessa prenotazione diceva «En cours» nella pagina
 * Réservations e «Confirmée» nella colonna della Accueil. Non erano due dati:
 * era la stessa riga letta da due codici che non la pensavano uguale. Nessun
 * errore, nessun log — due schermi, due verita', e quella sbagliata stava su
 * quello che resta aperto tutta la sera.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  fase, statoMostrato, statoDi, holdDi, holdR, minutiDa, HOLD_RIPIEGO,
} from "../src/lib/admin/resaStato.ts";

const SERVIZI = [{ key: "midi", hold: 75 }, { key: "soir", hold: 120 }];
const OGGI = "2026-10-07";
const ora = (hhmm, oggi = OGGI) => ({ oggi, minuti: minutiDa(hhmm) });
const RESA = { date: OGGI, heure: "19:30", status: "confirmed", service_key: "soir" };

test("una confermata il cui tavolo e' in corso non dice piu' «confermata»", () => {
  // ⚠️ Nessuno in sala va a premere «à table» quando il cliente si siede: se
  // lo stato mostrato fosse solo la colonna `status`, tutta la sera la
  // colonna direbbe «Confirmée» per tavoli occupati.
  assert.equal(statoDi(RESA, ora("18:00"), SERVIZI), "confirmed", "prima dell'ora non e' in corso");
  assert.equal(statoDi(RESA, ora("19:30"), SERVIZI), "seated", "all'ora esatta deve diventare «in corso»");
  assert.equal(statoDi(RESA, ora("20:45"), SERVIZI), "seated", "dentro la durata resta in corso");
  // 19:30 + 120 minuti = 21:30: da li' in poi e' una DOMANDA, non un fatto.
  assert.equal(statoDi(RESA, ora("21:30"), SERVIZI), "fini", "a finestra passata si deve chiedere «Fini ?»");
});

test("«fini» non e' «done»: l'uno lo chiede l'orologio, l'altro l'ha deciso qualcuno", () => {
  // ⚠️ Confonderli vorrebbe dire chiudere da soli una prenotazione che nessuno
  // ha chiuso — e una prenotazione chiusa esce dalla colonna.
  assert.equal(statoDi({ ...RESA, status: "done" }, ora("19:00"), SERVIZI), "done");
  assert.notEqual(statoDi(RESA, ora("23:00"), SERVIZI), "done");
});

test("l'arrivo messo A MANO non lo tocca l'orologio", () => {
  // Chi preme «à table» sa qualcosa che l'orologio non sa: il cliente e'
  // arrivato in anticipo, o in ritardo. Resta «in corso» comunque.
  const seduto = { ...RESA, status: "seated" };
  assert.equal(statoDi(seduto, ora("18:00"), SERVIZI), "seated", "l'arrivo a mano e' stato cancellato dall'ora");
  assert.equal(statoDi(seduto, ora("21:30"), SERVIZI), "fini");
});

test("gli stati che non seguono l'orologio restano quelli che sono", () => {
  for (const st of ["pending", "noshow", "cancelled", "done"]) {
    assert.equal(statoDi({ ...RESA, status: st }, ora("23:59"), SERVIZI), st, st);
  }
});

test("uno stato IGNOTO non diventa «confermata»", () => {
  // ⚠️ IL RIPIEGO CHE C'ERA: ogni stato fuori elenco ricadeva su «Confirmée».
  // Un'etichetta inventata e' peggio di una brutta — il giorno che arriva uno
  // stato nuovo (`waiting`, `late`), una riga da gestire si leggerebbe come
  // una riga a posto.
  assert.equal(statoMostrato("waiting", "encours"), null);
  assert.equal(statoMostrato("", "future"), null);
  assert.equal(statoMostrato(null, "future"), null);
});

test("la durata del tavolo viene dal SERVIZIO, non da un numero fisso", () => {
  // Un pranzo da 75 minuti e una cena da 120: con un ripiego unico, «Fini ?»
  // uscirebbe mezz'ora prima a pranzo o mezz'ora dopo a cena.
  assert.equal(holdDi("midi", SERVIZI), 75);
  assert.equal(holdDi("soir", SERVIZI), 120);
  assert.equal(holdDi("brunch", SERVIZI), HOLD_RIPIEGO, "un servizio che non c'e' usa il ripiego");
  assert.equal(holdDi("midi", null), HOLD_RIPIEGO);
  // ⚠️ Una durata assurda in configurazione non deve diventare una finestra di
  // zero minuti, cioe' ogni prenotazione «finita» appena creata.
  assert.equal(holdDi("x", [{ key: "x", hold: 0 }]), HOLD_RIPIEGO);
  assert.equal(holdDi("x", [{ key: "x", hold: 9999 }]), HOLD_RIPIEGO);
  // Il prolungo del tavolo si somma alla durata del servizio.
  assert.equal(holdR({ service_key: "midi", extra_minutes: 30 }, SERVIZI), 105);
  assert.equal(holdR({ service_key: "midi", extra_minutes: null }, SERVIZI), 75);
});

test("il giorno conta prima dell'ora", () => {
  assert.equal(fase({ ...RESA, date: "2026-10-08" }, ora("23:00"), SERVIZI), "future");
  assert.equal(fase({ ...RESA, date: "2026-10-06" }, ora("00:10"), SERVIZI), "passe");
});

test("un'ora illeggibile non chiude la prenotazione", () => {
  // ⚠️ Il verso sbagliato la farebbe sparire dalla colonna per un dato storto,
  // senza che nessuno l'abbia toccata. «Future» la lascia dov'e', visibile.
  assert.equal(fase({ ...RESA, heure: "" }, ora("20:00"), SERVIZI), "future");
  assert.equal(fase({ ...RESA, heure: "pippo" }, ora("20:00"), SERVIZI), "future");
  assert.equal(minutiDa("19:30"), 19 * 60 + 30);
  assert.equal(minutiDa(null), -1);
});

test("le due pagine usano la stessa regola, non una copia", () => {
  // ⚠️ E' questa la prova che tiene chiuso il guasto: finche' la regola sta in
  // un file solo le due pagine non possono divergere. Il giorno che qualcuno
  // la riscrive dentro una pagina «per non importare niente», si ricomincia.
  const HOME = readFileSync("src/pages/admin/index.astro", "utf8");
  const PAGINA = readFileSync("src/pages/admin/reservations.astro", "utf8");
  for (const [nome, testo] of [["Accueil", HOME], ["Réservations", PAGINA]]) {
    assert.match(testo, /from "\.\.\/\.\.\/lib\/admin\/resaStato"/,
      `${nome} non prende piu' lo stato dal modulo condiviso`);
    assert.doesNotMatch(testo, /adesso >= inizio \+ hold/,
      `${nome} si e' riscritta la regola dell'orologio: le due pagine possono tornare a dire due cose`);
  }
  // E la pastiglia della Accueil non stampa piu' `status` cosi' com'e'.
  assert.doesNotMatch(HOME, /badgeResa\(String\(/,
    "la Accueil e' tornata a passare alla pastiglia la sola colonna `status`");
});
