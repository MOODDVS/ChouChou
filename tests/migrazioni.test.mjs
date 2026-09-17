/**
 * MIGRAZIONI — che `TUTTO.sql` non resti indietro.
 *
 * Il guasto da evitare: qualcuno aggiunge una migrazione, non rigenera il
 * file cumulativo, e mesi dopo un cliente nuovo viene installato con lo
 * schema incompleto. Non da' errore quel giorno — da' una pagina rotta la
 * prima volta che qualcuno apre quella funzione.
 *
 * Qui non si prova del codice: si prova che tre cose restino d'accordo — la
 * cartella `supabase/`, la tabella di `MIGRATIONS.md` e `TUTTO.sql`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  componi,
  elencoMigrazioni,
  sqlNellaCartella,
  CARTELLA,
  USCITA,
} from "../scripts/genera-tutto.mjs";

test("TUTTO.sql e' aggiornato", () => {
  const suDisco = readFileSync(join(CARTELLA, USCITA), "utf8");
  assert.equal(
    suDisco,
    componi(),
    "TUTTO.sql non corrisponde alle migrazioni: lancia `node scripts/genera-tutto.mjs`",
  );
});

test("ogni .sql della cartella e' elencato in MIGRATIONS.md", () => {
  const elencati = new Set(elencoMigrazioni().map((m) => m.file));
  const mancanti = sqlNellaCartella().filter((f) => !elencati.has(f));
  assert.deepEqual(
    mancanti,
    [],
    "file .sql creati ma mai aggiunti alla tabella di MIGRATIONS.md: non finirebbero in TUTTO.sql e nessun cliente li riceverebbe",
  );
});

test("ogni riga di MIGRATIONS.md punta a un file che esiste", () => {
  const presenti = new Set(sqlNellaCartella());
  const fantasmi = elencoMigrazioni().map((m) => m.file).filter((f) => !presenti.has(f));
  assert.deepEqual(fantasmi, [], "MIGRATIONS.md elenca file che non ci sono");
});

test("i numeri sono progressivi e senza buchi ne' doppioni", () => {
  const n = elencoMigrazioni().map((m) => m.n);
  assert.ok(n.length > 0, "la tabella di MIGRATIONS.md non e' piu' leggibile");
  assert.deepEqual(n, [...n].sort((a, b) => a - b), "i numeri non sono in ordine");
  assert.equal(new Set(n).size, n.length, "due migrazioni con lo stesso numero");
  assert.deepEqual(n, n.map((_, i) => i + 1), "numerazione con un buco");
});

test("TUTTO.sql contiene davvero il corpo di ogni migrazione", () => {
  const tutto = readFileSync(join(CARTELLA, USCITA), "utf8");
  for (const { n, file } of elencoMigrazioni()) {
    assert.ok(tutto.includes(`-- #${n} — ${file}`), `manca l'intestazione di ${file}`);
    // Una riga vera presa dal file, non solo il titolo: il titolo ci sarebbe
    // anche se il corpo fosse vuoto.
    const corpo = readFileSync(join(CARTELLA, file), "utf8")
      .split("\n")
      .find((r) => r.trim() && !r.trim().startsWith("--"));
    if (corpo) assert.ok(tutto.includes(corpo.trim()), `manca il corpo di ${file}`);
  }
});
