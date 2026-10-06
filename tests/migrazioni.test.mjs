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

test("nessuna migrazione riscrive dati che qualcuno potrebbe aver cambiato", () => {
  // ⚠️ IL PUNTO (05/10/2026). `TUTTO.sql` serve a installare un cliente nuovo,
  // ma viene anche rilanciato su un database VIVO per rimettersi in pari
  // quando non si ricorda piu' quali migrazioni sono state fatte — ed e' il
  // caso normale con sei clienti. Le CREATE sono idempotenti per abitudine;
  // gli UPDATE no, e un UPDATE che rigira riscrive scelte fatte dal
  // ristoratore mesi dopo. Nessuno va a ricontrollare le sezioni del menu o i
  // testi dei popup dopo aver lanciato uno script.
  //
  // La regola: ogni UPDATE di un seed dice da solo come si accorge di essere
  // il secondo giro — `where <colonna> is null` (migra solo cio' che non lo
  // e' ancora) oppure `not exists (...)` (qui non ha ancora deciso nessuno).
  const files = sqlNellaCartella().filter((f) => f !== USCITA);
  const colpevoli = [];
  for (const f of files) {
    const sql = readFileSync(join(CARTELLA, f), "utf8")
      .replace(/--[^\n]*/g, "")                       // via i commenti: un esempio non e' un comando
      .replace(/\$\$[\s\S]*?\$\$/g, "");              // via i corpi delle funzioni: girano quando li chiama qualcuno
    for (const m of sql.matchAll(/\bupdate\s+(?:public\.)?(\w+)\s+set\b([\s\S]*?);/gi)) {
      const corpo = m[2];
      const protetto = /\bis null\b/i.test(corpo) || /\bnot exists\b/i.test(corpo) || /\bis distinct from\b/i.test(corpo);
      if (!protetto) colpevoli.push(`${f} → update ${m[1]}`);
    }
  }
  assert.deepEqual(colpevoli, [],
    "un UPDATE di migrazione non dice come si accorge di essere il secondo giro: rilanciare il file riscriverebbe scelte del ristoratore");
});

test("ogni tabella nuova porta il suo GRANT al service_role", () => {
  // ⚠️ IL GUASTO DEL 06/10/2026, trovato in sala da 450 Gradi con un ordine
  // pagato davanti. In questi progetti Supabase «Automatically expose new
  // tables» e' SPENTO: una tabella nasce senza privilegi per i ruoli
  // dell'API, e il service_role — la chiave con cui scrive il server — non
  // ci puo' nemmeno fare un insert.
  //
  // Il guasto non si vede da nessuna parte. `accodaTicket` inghiotte i suoi
  // errori di proposito (un ticket mancato e' un fastidio, un ordine non
  // registrato e' una perdita), quindi: la tabella c'e', la stampante
  // risponde, la prova di stampa esce — e dell'ordine vero non arriva
  // niente. L'unica riga che lo diceva stava nei log di Hostinger.
  //
  // `print_tickets` e `page_views` erano nate cosi'. Questa prova e' l'unico
  // posto in cui una terza se ne accorge prima di un cliente.
  const sql = readFileSync("supabase/TUTTO.sql", "utf8");
  const tabelle = [...new Set([...sql.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]))];
  assert.ok(tabelle.length > 20, "l'elenco delle tabelle non si legge piu': regex da rivedere");
  const senza = tabelle.filter(
    (t) => !new RegExp(`grant[^;]*on public\\.${t}\\b[^;]*to[^;]*service_role`, "is").test(sql),
  );
  assert.deepEqual(senza, [], `queste tabelle non danno i privilegi al service_role: il server non ci potra' scrivere, e non lo dira'\n  ${senza.join("\n  ")}`);
});
