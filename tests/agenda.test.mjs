/**
 * L'AGENDA — gli eventi sono del MARCHIO.
 *
 * Deciso il 16/09/2026. Prima `agenda_events` era «sede»: ogni punto vedeva
 * solo i suoi eventi, e una serata annunciata dal gruppo andava scritta tre
 * volte — tre righe da tenere allineate a mano, che e' il modo in cui due
 * delle tre restano indietro.
 *
 * Ora e' MISTA, come i pop-up e i giorni speciali: il default e' «tutte le
 * sedi», e resta possibile l'evento di un punto solo — la degustazione che
 * fa soltanto Stockel.
 *
 * ⚠️ La direzione dell'errore decide il default, ed e' il ragionamento che
 * vale la pena ricordare: un evento del gruppo che compare ovunque e' quello
 * che ci si aspetta; uno di sede finito su tutte si vede e si corregge in un
 * secondo; uno del gruppo dimenticato in un punto solo NON SI VEDE AFFATTO.
 * Si sbaglia dalla parte che si nota.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLASSIFICA, filtroPer, sedeDaScrivere, appartenenzaDi,
  sede, SEDE_UNICA, tutteLeSedi, applicaFiltro,
} from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";

/* ============================================================
   LA CLASSIFICAZIONE
   ============================================================ */

test("l'agenda e' MISTA, non «sede»", () => {
  assert.equal(CLASSIFICA.agenda_events, "mista");
  assert.equal(appartenenzaDi("agenda_events"), "mista");
});

test("dentro un punto si vedono i suoi eventi E quelli del gruppo", () => {
  // ⚠️ E' la differenza fra «mista» e «sede», ed e' tutta qui: il filtro
  // accetta anche le righe con `location_id` nullo, che sono quelle del
  // marchio. Con «sede» l'evento del gruppo sarebbe invisibile ovunque.
  const f = filtroPer("agenda_events", sede(STOCKEL));
  assert.equal(f.tipo, "sede-o-marchio");
  assert.match(f.espressione, new RegExp(`location_id\\.eq\\.${STOCKEL}`));
  assert.match(f.espressione, /location_id\.is\.null/);
});

test("la condizione arriva davvero alla query, in un pezzo solo", () => {
  const chiamate = [];
  const finta = {
    eq: (...a) => (chiamate.push(["eq", ...a]), finta),
    or: (...a) => (chiamate.push(["or", ...a]), finta),
  };
  applicaFiltro(finta, "agenda_events", sede(STOCKEL));
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0][0], "or", "una mista si filtra con un OR, non con un uguale");
});

test("a sede unica e nell'aggregato non si filtra niente", () => {
  // I quattro clienti a sede unica non devono accorgersi del cambiamento.
  assert.deepEqual(filtroPer("agenda_events", SEDE_UNICA), { tipo: "nessuno" });
  assert.deepEqual(filtroPer("agenda_events", tutteLeSedi()), { tipo: "nessuno" });
});

/* ============================================================
   LA SCRITTURA: il default e' «tutte le sedi»
   ============================================================ */

test("un evento nuovo, senza dire niente, e' del GRUPPO", () => {
  // `condivisa = true` e' quello che passa l'API: vedi il test sul default
  // piu' sotto, che guarda proprio quella riga.
  assert.equal(sedeDaScrivere("agenda_events", sede(STOCKEL), true), null,
    "null = vale per tutte le sedi");
});

test("un evento di un punto solo si puo' ancora fare", () => {
  assert.equal(sedeDaScrivere("agenda_events", sede(STOCKEL), false), STOCKEL);
});

test("a sede unica resta null, come e' sempre stato", () => {
  assert.equal(sedeDaScrivere("agenda_events", SEDE_UNICA, true), null);
  assert.equal(sedeDaScrivere("agenda_events", SEDE_UNICA, false), null);
});

test("dall'aggregato non si crea nessun evento", () => {
  // «Tutte le sedi» e' un modo di GUARDARE, non un posto dove si scrive:
  // altrimenti non si saprebbe di chi e' la riga appena creata.
  assert.throws(() => sedeDaScrivere("agenda_events", tutteLeSedi(), true), /aggregato|tutte/i);
  assert.throws(() => sedeDaScrivere("agenda_events", tutteLeSedi(), false), /aggregato|tutte/i);
});

/* ============================================================
   LE RETI — dove la decisione e' scritta nel codice
   ============================================================ */

test("l'API crea gli eventi per TUTTE le sedi salvo diverso avviso", () => {
  // ⚠️ `!== false` e non `=== true`: la differenza e' il default. Con
  // `=== true` un vecchio schermo che non manda il campo creerebbe eventi
  // di sede senza che nessuno l'abbia chiesto, e il gruppo non li vedrebbe.
  const api = readFileSync("src/pages/api/admin/agenda.ts", "utf8");
  assert.match(api, /const perTutte = body\.all_locations !== false;/);
  assert.match(api, /inserisci\("agenda_events", ambito, v\.valori!, perTutte\)/);
  // Anche il ripiego (cliente senza le colonne i18n) deve passare la scelta:
  // era il punto dove si perde, perche' si scrive una seconda volta.
  assert.match(api, /inserisci\("agenda_events", ambito, senza, perTutte\)/);
});

test("si puo' spostare un evento esistente fra gruppo e punto", () => {
  const api = readFileSync("src/pages/api/admin/agenda.ts", "utf8");
  assert.match(api, /campi\.location_id = body\.all_locations !== false \? null : ambito\.id;/);
});

test("il modale mostra lo stato VERO dell'evento, non il default", () => {
  // ⚠️ Se l'interruttore partisse sempre spuntato, riaprire un evento di
  // sede e salvarlo senza toccare niente lo sposterebbe su tutte. Un
  // salvataggio che non cambia niente non deve cambiare niente.
  const pagina = readFileSync("src/pages/admin/agenda.astro", "utf8");
  assert.match(pagina, /fAllLoc\.checked = ev \? \(ev\.location_id \?\? null\) === null : true;/);
  // E l'interruttore non compare fuori da un punto: li' non c'e' scelta.
  assert.match(pagina, /fAllLocWrap\.style\.display = mostraLoc \? "" : "none";/);
  assert.match(pagina, /\.\.\.\(sedeAttiva \? \{ all_locations: fAllLoc\.checked \} : \{\}\)/);
});

test("l'agenda NON e' piu' fra le tabelle che lo storico riattribuisce", () => {
  // ⚠️ E' la conseguenza che si dimentica. `assegna_storico_sede` riempie
  // `location_id` sulle righe rimaste a NULL. Su una tabella di sede e'
  // giusto — sono orfane. Su una MISTA, NULL vuol dire «di tutto il
  // gruppo»: riempirlo trasformerebbe il calendario del marchio nel
  // calendario di un punto solo, in silenzio e senza ritorno.
  const sql = readFileSync("supabase/locations.sql", "utf8");
  const m = /create or replace function public\.tabelle_di_sede\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
  assert.ok(m, "funzione `tabelle_di_sede()` non trovata");
  const nelSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.equal(nelSql.includes("agenda_events"), false,
    "agenda_events e' tornata nell'elenco: riempire NULL cancella gli eventi di gruppo");
});

// ============================================================
// ORDINE DELLA LISTA — prima cio' che deve ancora succedere.
// ============================================================
test("agendaRegole non importa NIENTE (se no questo test si svuota in silenzio)", () => {
  const src = readFileSync("src/lib/admin/agendaRegole.ts", "utf8");
  const righe = src.split("\n").filter((r) => /^\s*import\s/.test(r));
  assert.deepEqual(righe, [], "agendaRegole.ts ha un import: il file non parte piu' e vitest direbbe «0 test»");
});

test("un evento di piu' giorni e' passato quando FINISCE, non quando comincia", async () => {
  const { eventoPassato } = await import("../src/lib/admin/agendaRegole.ts");
  const mostra = { date_start: "2026-10-01", date_end: "2026-10-20" };
  assert.equal(eventoPassato(mostra, "2026-10-10"), false, "una mostra in corso risulterebbe gia' archiviata");
  assert.equal(eventoPassato(mostra, "2026-10-21"), true);
  // Il giorno stesso non e' passato: la cena di stasera e' ancora da fare.
  assert.equal(eventoPassato({ date_start: "2026-10-03" }, "2026-10-03"), false);
  assert.equal(eventoPassato({ date_start: "2026-10-02" }, "2026-10-03"), true);
  assert.equal(eventoPassato({ date_start: "2026-10-05", date_end: "" }, "2026-10-06"), true, "una fine vuota vale come assente");
});

test("prima i prossimi dal piu' vicino, poi i passati dal piu' recente", async () => {
  const { ordinaEventi } = await import("../src/lib/admin/agendaRegole.ts");
  const lista = [
    { id: "vecchio", date_start: "2026-01-10" },
    { id: "lontano", date_start: "2026-12-24" },
    { id: "ieri", date_start: "2026-10-02" },
    { id: "domani", date_start: "2026-10-04" },
  ];
  assert.deepEqual(
    ordinaEventi(lista, "2026-10-03").map((e) => e.id),
    ["domani", "lontano", "ieri", "vecchio"],
    "chi apre l'agenda deve trovare in cima quello che deve preparare, non la festa dell'anno scorso",
  );
  // La lista ricevuta non si tocca: altrove ci si fida dell'ordine di arrivo.
  assert.equal(lista[0].id, "vecchio");
  assert.deepEqual(ordinaEventi([], "2026-10-03"), []);
});

test("la pagina agenda usa la regola, e con la data del RISTORANTE", () => {
  const pag = readFileSync("src/pages/admin/agenda.astro", "utf8");
  assert.match(pag, /ordinaEventi\(dati\.events/, "la lista torna in ordine di salvataggio: i passati tornano in cima");
  assert.match(pag, /timeZone:\s*TZ_LOCALE/, "«passato» si decide col calendario del tablet invece che con quello del locale");
  assert.match(pag, /eventoPassato\(e,/, "il badge «passato» non viene piu' calcolato: lo storico si confonde con i prossimi");
});
