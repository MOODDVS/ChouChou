/**
 * LA SCHEDA DEL TAVOLO SUL PALMARE — le regole pure.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { tavoloDellaRiga, tavoliDelleRiga, prossimaPrenotazione } from "../src/lib/admin/schedaTavoloRegole.ts";

const T = "11111111-1111-1111-1111-111111111111";

test("una prenotazione sta sul tavolo per `tables` o per il tavolo del conto", () => {
  assert.equal(tavoloDellaRiga({ tables: [T] }, T), true);
  assert.equal(tavoloDellaRiga({ tables: JSON.stringify([T]) }, T), true, "jsonb letto come testo");
  assert.equal(tavoloDellaRiga({ tables: [], tab_table_id: T }, T), true, "il conto partito da qui e unito altrove");
  assert.equal(tavoloDellaRiga({ tables: ["altro"] }, T), false);
  assert.equal(tavoloDellaRiga({ tables: "{rotto" }, T), false);
  assert.equal(tavoloDellaRiga({}, T), false);
});

test("la prossima prenotazione: la piu' vicina, solo chi deve arrivare, mai un no-show di ore fa", () => {
  const righe = [
    { heure: "12:00", people: 2, first_name: "Vecchia", last_name: "", status: "confirmed" },
    { heure: "13:30", people: 4, first_name: "Marc", last_name: "Dupont", status: "confirmed" },
    { heure: "13:00", people: 2, first_name: "Seduta", last_name: "", status: "seated" },
    { heure: "20:00", people: 6, first_name: "Sera", last_name: "", status: "pending" },
    { heure: "13:10", people: 3, first_name: "Annullata", last_name: "", status: "cancelled" },
  ];
  assert.deepEqual(prossimaPrenotazione(righe, "13:05"), { heure: "13:30", persone: 4, nome: "Marc Dupont" });
  // Un ritardatario di un quarto d'ora e' ancora «in arrivo».
  assert.equal(prossimaPrenotazione([{ heure: "12:45", status: "confirmed", people: 2 }], "13:00")?.heure, "12:45");
  // Di ore fa no.
  assert.equal(prossimaPrenotazione([{ heure: "12:00", status: "confirmed", people: 2 }], "15:00"), null);
  assert.equal(prossimaPrenotazione(righe, "ora"), null);
});

test("la scheda legge e basta: niente invii mandati in cucina guardando un tavolo", () => {
  const src = readFileSync("src/lib/admin/schedaTavolo.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /rilasciaInviiScaduti\(/);
  assert.doesNotMatch(src, /\b(aggiorna|inserisci|cancella)\(/);
  // Lo stesso riassunto del tablet di Commandes, non una copia.
  assert.match(src, /riassumiConti\(ambito, \[mioConto\]\)/);
});

test("i tavoli uniti di una prenotazione: array o testo JSON, mai un errore", () => {
  assert.deepEqual(tavoliDelleRiga(["a", "b"]), ["a", "b"]);
  assert.deepEqual(tavoliDelleRiga('["a","b"]'), ["a", "b"]);
  assert.deepEqual(tavoliDelleRiga(null), []);
  assert.deepEqual(tavoliDelleRiga("{rotto"), []);
});

test("la scheda dice tutti i tavoli del gruppo, e la testa segue la combinazione scelta", () => {
  const pag = readFileSync("src/pages/admin/salle/table.astro", "utf8");
  assert.match(pag, /const nomiTavoli = s\?\.gruppo \? s\.gruppo\.nomi\.join\(" \+ "\)/);
  assert.match(pag, /const aggiornaBottone = \(\) => \{\s*aggiornaTesta\(\);/);
});

test("il timer dell'isola: minuti, poi ore, mai negativo", async () => {
  const { tempoSeduti } = await import("../src/lib/admin/schedaTavoloRegole.ts");
  const ora = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(tempoSeduti("2026-10-23T11:52:00Z", ora), "8 min");
  assert.equal(tempoSeduti("2026-10-23T10:55:00Z", ora), "1 h 05");
  assert.equal(tempoSeduti("2026-10-23T12:10:00Z", ora), "0 min", "orologio del telefono avanti");
  assert.equal(tempoSeduti(null, ora), "0 min");
});
