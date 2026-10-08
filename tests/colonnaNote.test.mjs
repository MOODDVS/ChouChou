/**
 * LA LAVAGNETTA — la colonna «Notes», e la mail che la racconta.
 *
 * ⚠️ I GUASTI CHE QUESTE PROVE TENGONO CHIUSI, trovati leggendo la colonna
 * riga per riga (08/10/2026):
 *
 *  A. LA MAIL DEL MATTINO non mostrava mai una nota in ritardo. Prendeva «le
 *     ultime sei note aperte» dalla piu' NUOVA, e le note scadute sono per
 *     definizione le piu' vecchie: erano esattamente quelle escluse. E'
 *     l'unico momento della giornata in cui il ristoratore guarda la
 *     lavagnetta prima di aprire il pannello.
 *  B. IL CONTO DEL MESE confrontava una chiave-giorno del fuso del locale con
 *     un istante UTC: una nota scritta il primo del mese all'una di notte
 *     cadeva nel mese prima. La correzione del fuso era a meta', e il
 *     commento sopra diceva che era finita.
 *  C. L'ATTESA DELLA PIU' VECCHIA si contava a fette di ventiquattro ore: una
 *     nota di ieri sera diceva «0 giorni» per tutta la giornata di oggi.
 *  D. «giorniTra» esisteva in due moduli con lo stesso corpo e un `+ 1` di
 *     differenza — durata di una chiusura contro distanza fra due date.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  tagDi, inRitardo, daFare, etichette, conEtichetta, filtroValido,
  contoDelMese, chiLeFa, attesaPiuVecchia, perLaMail,
} from "../src/lib/admin/noteRegole.ts";
import { giorniPassati, piuGiorni } from "../src/lib/giorni.ts";
import { giorniTra } from "../src/lib/admin/giorniSpecialiRegole.ts";

/* Il fuso del locale, come lo fa la pagina. */
const chiave = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
const ADESSO = Date.parse("2026-10-08T09:00:00+02:00");

test("A · una nota in ritardo e' in ritardo solo se c'e' ancora da farla", () => {
  const scaduta = { due_at: "2026-10-07T12:00:00+02:00", done: false };
  assert.equal(inRitardo(scaduta, ADESSO), true);
  // ⚠️ Su una nota gia' spuntata sarebbe un rimprovero per un lavoro finito.
  assert.equal(inRitardo({ ...scaduta, done: true }, ADESSO), false);
  assert.equal(inRitardo({ due_at: "2026-10-09T12:00:00+02:00", done: false }, ADESSO), false);
  assert.equal(inRitardo({ done: false }, ADESSO), false, "senza scadenza non c'e' ritardo");
  // Una data illeggibile non e' un ritardo: in rosso manderebbe a cercare una
  // scadenza che non esiste.
  assert.equal(inRitardo({ due_at: "domani", done: false }, ADESSO), false);
});

test("A · la mail scrive le scadute, non le appena scritte", () => {
  const note = [
    { content: "nuova di stamattina", created_at: "2026-10-08T07:00:00Z" },
    { content: "nuova di ieri", created_at: "2026-10-07T07:00:00Z" },
    { content: "scaduta da una settimana", created_at: "2026-09-01T07:00:00Z", due_at: "2026-10-01T10:00:00Z" },
    { content: "scaduta ieri", created_at: "2026-09-20T07:00:00Z", due_at: "2026-10-07T10:00:00Z" },
    { content: "scade domani", created_at: "2026-09-25T07:00:00Z", due_at: "2026-10-09T10:00:00Z" },
    { content: "altra nuova", created_at: "2026-10-06T07:00:00Z" },
    { content: "ancora una", created_at: "2026-10-05T07:00:00Z" },
    { content: "fatta", created_at: "2026-10-08T08:00:00Z", done: true },
  ];
  const scelte = perLaMail(note, ADESSO).map((n) => n.content);
  // Le due scadute davanti, la piu' vecchia per prima; poi quella che scade;
  // poi le altre dalla piu' recente.
  assert.deepEqual(scelte, [
    "scaduta da una settimana", "scaduta ieri", "scade domani",
    "nuova di stamattina", "nuova di ieri", "altra nuova",
  ]);
  // ⚠️ Prima erano le sei piu' NUOVE: le due scadute non comparivano.
  assert.ok(!perLaMail(note, ADESSO).some((n) => n.done), "una nota fatta non si annuncia");
  assert.equal(perLaMail(note, ADESSO, 2).length, 2);
  assert.deepEqual(perLaMail([], ADESSO), []);
});

test("B · il mese comincia nel fuso del locale, da tutte e due le parti", () => {
  // `2026-09-30T23:00:00Z` e' il primo ottobre all'una di notte a Bruxelles:
  // per lettere sta prima di «2026-10-01», e cadeva nel mese sbagliato.
  const note = [
    { created_at: "2026-09-30T23:00:00Z", done: true, done_by: "Marco" },
    { created_at: "2026-10-05T10:00:00Z", done: false },
    { created_at: "2026-09-28T10:00:00Z", done: true, done_by: "Sara" },
  ];
  const m = contoDelMese(note, "2026-10-01", chiave);
  assert.equal(m.totali, 2, "la nota dell'una di notte e' di ottobre");
  assert.equal(m.fatte, 1);
});

test("B · chi le chiude si conta su «done_by», e senza nome non si conta", () => {
  const note = [
    { created_at: "2026-10-02T10:00:00Z", done: true, done_by: "Marco" },
    { created_at: "2026-10-03T10:00:00Z", done: true, done_by: "Marco" },
    { created_at: "2026-10-04T10:00:00Z", done: true, done_by: "Sara" },
    // ⚠️ Spuntata prima della migrazione #79: nessun nome. Una riga «senza
    // nome · 7» in una classifica di squadra si legge come una persona.
    { created_at: "2026-10-05T10:00:00Z", done: true, done_by: "" },
    // Scritta da Luca ma spuntata da nessuno: `author` non c'entra.
    { created_at: "2026-10-06T10:00:00Z", done: false, done_by: null },
  ];
  assert.deepEqual(chiLeFa(note, "2026-10-01", chiave), [
    { chi: "Marco", quante: 2 }, { chi: "Sara", quante: 1 },
  ]);
  assert.deepEqual(chiLeFa([], "2026-10-01", chiave), []);
});

test("C · l'attesa si conta in giorni di calendario, e sotto un giorno si tace", () => {
  const oggi = "2026-10-08";
  // Scritta ieri alle 23:30 di Bruxelles: con le fette da ventiquattro ore
  // diceva «0 giorni» fino alle 23:30 di oggi.
  assert.equal(attesaPiuVecchia([{ created_at: "2026-10-07T21:30:00Z" }], oggi, chiave), 1);
  // ⚠️ `null` e non «0 giorni»: una riga che occupa posto per dire che va
  // tutto bene.
  assert.equal(attesaPiuVecchia([{ created_at: "2026-10-08T06:00:00Z" }], oggi, chiave), null);
  assert.equal(attesaPiuVecchia([{ created_at: "2026-09-08T06:00:00Z" }], oggi, chiave), 30);
  // Le note GIA' FATTE non aspettano piu' nessuno.
  assert.equal(attesaPiuVecchia([{ created_at: "2026-01-01T06:00:00Z", done: true }], oggi, chiave), null);
  assert.equal(attesaPiuVecchia([], oggi, chiave), null);
});

test("D · distanza e durata sono due domande, e il «+1» si vede", () => {
  // Dal 3 al 5 sono passati due giorni…
  assert.equal(giorniPassati("2026-10-03", "2026-10-05"), 2);
  // …ma una chiusura dal 3 al 5 dura TRE giorni, perche' il 3 e il 5 sono
  // chiusi. Erano due funzioni con lo stesso corpo in due moduli.
  assert.equal(giorniTra("2026-10-03", "2026-10-05"), 3);
  assert.equal(giorniPassati("2026-10-05", "2026-10-03"), -2);
  assert.equal(giorniTra("2026-10-05", "2026-10-03"), 1, "un periodo a rovescio vale un giorno");
  // ⚠️ A mezzogiorno UTC: dal 24 al 26 ottobre 2026 c'e' il cambio dell'ora,
  // e due mezzanotti distano 25 ore — la divisione secca darebbe 1.
  assert.equal(giorniPassati("2026-10-24", "2026-10-26"), 2);
  assert.equal(piuGiorni("2026-10-24", 2), "2026-10-26");
  assert.equal(giorniPassati("domani", "2026-10-26"), 0, "una data rotta non inventa un numero");
});

test("le etichette: niente doppioni, e un filtro che non esiste piu' si spegne", () => {
  const note = [
    { tags: ["important", "Fornitore"] },
    { tags: ["fornitore"] },
    { tags: null },
    // ⚠️ `tags` arriva dal database: rotto, la nota deve comparire senza
    // etichette, non far cadere il disegno di tutta la colonna.
    { tags: "important" },
  ];
  assert.deepEqual(etichette(note), ["important", "Fornitore"]);
  assert.deepEqual(tagDi({ tags: "important" }), []);
  assert.deepEqual(tagDi({ tags: [" x ", "", null, "y"] }), ["x", "y"]);
  // Il filtro non guarda le maiuscole: due pastiglie uguali sarebbero due
  // filtri che fanno la stessa cosa.
  assert.equal(conEtichetta(note, "FORNITORE").length, 2);
  assert.equal(conEtichetta(note, "").length, 4, "filtro vuoto = tutte");
  assert.equal(filtroValido(note, "fornitore"), "fornitore");
  assert.equal(filtroValido(note, "scomparsa"), "", "un filtro su un'etichetta che non c'e' piu' si spegne");
});

test("la pastiglia conta le note da fare", () => {
  const note = [{ done: true }, { done: false }, { done: null }, {}];
  assert.equal(daFare(note).length, 3);
});

/* ---------- le guardie sul codice ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const MAIL = readFileSync(new URL("../src/lib/admin/dailyBrief.ts", import.meta.url), "utf8");

test("guardia · la colonna e la mail chiedono le stesse regole al modulo", () => {
  for (const [nome, src] of [["Accueil", HOME], ["mail", MAIL]]) {
    assert.ok(/noteRegole/.test(src), `${nome} importa noteRegole`);
  }
  // Il conto del mese sul `created_at` grezzo, e l'attesa a fette di
  // ventiquattro ore: erano le due righe sbagliate.
  assert.ok(!/created_at\) >= inizioMese/.test(HOME), "il mese non si confronta piu' col timestamp grezzo");
  assert.ok(!/Date\.now\(\) - new Date\(piuVecchia/.test(HOME), "l'attesa non si conta piu' in millisecondi");
});

test("guardia · la spunta legge la riga che torna dal server", () => {
  // ⚠️ Una nota RICORRENTE non si chiude: il server la riapre con la scadenza
  // del giro dopo. Buttando via la risposta, lo schermo la mostrava spuntata e
  // barrata, e al primo ricaricamento cambiava tutto da solo.
  assert.ok(/j\?\.note\) Object\.assign\(n, j\.note\)/.test(HOME), "la risposta del PUT si legge");
});
