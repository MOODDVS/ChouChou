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

/* ============================================================
   I SEED — semina per tutti, non i dati di uno
   ============================================================
   Le migrazioni si lanciano su OGNI cliente. Un dato vero finito in un seed
   non si vede il giorno in cui lo scrivi: si vede mesi dopo, sull'
   installazione di qualcun altro, e non da' nessun errore. */

// Domini e indirizzi che POSSONO stare in un .sql: l'azienda e i segnaposto.
const DOMINI_AMMESSI = [
  "moodd.online",
  "example.com",
  "example.be",
  "supabase.co",
  "dominiocliente.be",
  "restaurant.be",
];

/** Le righe di DATI: i commenti SQL raccontano la storia delle decisioni
 *  ("(450 Gradi, 13/09) lo rilancia...") e li' un nome di cliente e' giusto.
 *  In un INSERT no. */
function righeDati(sql) {
  return sql
    .split("\n")
    .map((r, i) => [i + 1, r])
    .filter(([, r]) => r.trim() && !r.trim().startsWith("--"));
}

test("nessun seed porta l'email di un cliente vero", () => {
  const colpevoli = [];
  for (const file of sqlNellaCartella()) {
    const sql = readFileSync(join(CARTELLA, file), "utf8");
    for (const [n, r] of righeDati(sql)) {
      for (const m of r.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        if (!DOMINI_AMMESSI.includes(m[1].toLowerCase())) colpevoli.push(`${file}:${n} ${m[0]}`);
      }
    }
  }
  // ⚠️ Il caso vero: `app_config.sql` seminava kitchen_email =
  // 'info@lamolisana.be'. Ogni installazione nuova mandava i ticket degli
  // ordini a La Molisana — e `app_config` BATTE la variabile d'ambiente,
  // quindi KITCHEN_EMAIL dell'.env non salvava nessuno.
  assert.deepEqual(colpevoli, [], "email di un cliente dentro un seed");
});

test("i seed di settings e app_config non sono UPSERT", () => {
  // ⚠️ Un seed che AGGIORNA riscrive il lavoro di un cliente che gia' lavora,
  // e questi file si rilanciano ogni volta che serve una colonna nuova. Il
  // seed degli orari era `do update set`: rilanciarlo rimetteva a tutti gli
  // orari scritti nel file. Nessun errore, nessuna riga nei log: la gente si
  // presenta in un giorno che il sito dice aperto e trova chiuso.
  // Un seed semina; le riparazioni si fanno dall'admin.
  for (const file of sqlNellaCartella()) {
    const sql = readFileSync(join(CARTELLA, file), "utf8");
    for (const tabella of ["public.settings", "public.app_config"]) {
      let da = 0;
      for (;;) {
        const i = sql.indexOf(`insert into ${tabella}`, da);
        if (i < 0) break;
        da = i + 1;
        const fine = sql.indexOf(";", i);
        const blocco = sql.slice(i, fine < 0 ? sql.length : fine);
        assert.ok(
          !/on conflict[\s\S]*do update/i.test(blocco),
          `${file}: il seed di ${tabella} e' un UPSERT e sovrascrive i dati del cliente`,
        );
      }
    }
  }
});
