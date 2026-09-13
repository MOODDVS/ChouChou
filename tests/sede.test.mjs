// Multi-sede: le regole di filtro, provate senza database.
// `sedeRegole.ts` non importa niente apposta — cosi' questi test girano
// sulla funzione VERA, non su una copia che puo' divergere.
import assert from "node:assert/strict";
import { test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CLASSIFICA,
  SEDE_UNICA,
  sede,
  tutteLeSedi,
  filtroPer,
  sedeDaScrivere,
  applicaFiltro,
  appartenenzaDi,
} from "../src/lib/admin/sedeRegole.ts";

const JOURDAN = "11111111-2222-3333-4444-555555555555";
const TUTTE_LE_TABELLE = Object.keys(CLASSIFICA);
const di = (a) => TUTTE_LE_TABELLE.filter((t) => CLASSIFICA[t] === a);

/* ============================================================
   IL TEST CHE CONTA: coi quattro clienti attuali non cambia NIENTE.
   ============================================================ */
test("sede unica: nessun filtro, su nessuna tabella", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    assert.deepEqual(
      filtroPer(tabella, SEDE_UNICA),
      { tipo: "nessuno" },
      `${tabella} verrebbe filtrata anche a sede unica`
    );
  }
});

test("sede unica: la query esce identica a com'e' entrata", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    const chiamate = [];
    const finta = {
      eq: (...a) => (chiamate.push(["eq", ...a]), finta),
      or: (...a) => (chiamate.push(["or", ...a]), finta),
    };
    const uscita = applicaFiltro(finta, tabella, SEDE_UNICA);
    assert.equal(uscita, finta, `${tabella}: query sostituita`);
    assert.deepEqual(chiamate, [], `${tabella}: aggiunta una condizione`);
  }
});

/* ============================================================
   Con le sedi accese
   ============================================================ */
test("le tabelle del marchio non si filtrano mai", () => {
  for (const tabella of di("marchio")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), { tipo: "nessuno" });
    assert.deepEqual(filtroPer(tabella, tutteLeSedi()), { tipo: "nessuno" });
  }
});

test("le tabelle della sede si filtrano con l'uguaglianza", () => {
  for (const tabella of di("sede")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), { tipo: "sede", valore: JOURDAN });
  }
  const chiamate = [];
  const finta = { eq: (...a) => (chiamate.push(["eq", ...a]), finta), or: (...a) => (chiamate.push(["or", ...a]), finta) };
  applicaFiltro(finta, "orders", sede(JOURDAN));
  assert.deepEqual(chiamate, [["eq", "location_id", JOURDAN]]);
});

test("le tabelle miste vedono la sede E il marchio", () => {
  for (const tabella of di("mista")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), {
      tipo: "sede-o-marchio",
      espressione: `location_id.eq.${JOURDAN},location_id.is.null`,
    });
  }
  const chiamate = [];
  const finta = { eq: (...a) => (chiamate.push(["eq", ...a]), finta), or: (...a) => (chiamate.push(["or", ...a]), finta) };
  applicaFiltro(finta, "menu_items", sede(JOURDAN));
  assert.deepEqual(chiamate, [["or", `location_id.eq.${JOURDAN},location_id.is.null`]]);
});

test("l'aggregato non filtra, ma va chiesto per nome", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    assert.deepEqual(filtroPer(tabella, tutteLeSedi()), { tipo: "nessuno" });
  }
  // «tutte» e «unica» rendono lo stesso filtro ma NON sono la stessa cosa:
  // uno e' lo stato dell'installazione, l'altro una richiesta esplicita.
  assert.notDeepEqual(tutteLeSedi(), SEDE_UNICA);
});

/* ============================================================
   Le difese
   ============================================================ */
test("una tabella non classificata e' un errore, non un caso non filtrato", () => {
  assert.throws(() => filtroPer("tabella_inventata", sede(JOURDAN)), /non classificata/);
  assert.throws(() => appartenenzaDi("orders_v2"), /non classificata/);
});

test("un id di sede non valido viene rifiutato (finisce dentro un filtro testuale)", () => {
  for (const cattivo of ["", "tutte", "1; drop", "location_id.is.null", "11111111-2222-3333-4444-55555555555"]) {
    assert.throws(() => sede(cattivo), /non valido/, `accettato: ${JSON.stringify(cattivo)}`);
  }
  assert.equal(sede(JOURDAN).id, JOURDAN);
});

/* ============================================================
   Scrittura
   ============================================================ */
test("che location_id si scrive", () => {
  // Marchio: sempre NULL, anche stando dentro una sede.
  assert.equal(sedeDaScrivere("clients", sede(JOURDAN)), null);
  // Sede unica: NULL, che per un punto solo e' la verita'.
  assert.equal(sedeDaScrivere("orders", SEDE_UNICA), null);
  // Dentro una sede: la sede.
  assert.equal(sedeDaScrivere("orders", sede(JOURDAN)), JOURDAN);
  // Mista: decide chi crea.
  assert.equal(sedeDaScrivere("special_days", sede(JOURDAN), false), JOURDAN);
  assert.equal(sedeDaScrivere("special_days", sede(JOURDAN), true), null);
  // `condivisa` non ha effetto dove non c'e' niente da scegliere.
  assert.equal(sedeDaScrivere("orders", sede(JOURDAN), true), JOURDAN);
});

test("non si scrive nell'aggregato", () => {
  assert.throws(() => sedeDaScrivere("orders", tutteLeSedi()), /sola lettura/);
  assert.throws(() => sedeDaScrivere("clients", tutteLeSedi()), /sola lettura/);
});

/* ============================================================
   La rete: una tabella usata e non dichiarata sarebbe senza regola
   ============================================================ */
test("ogni tabella letta nel codice e' classificata", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");

  const usate = new Set();
  const re = /supabaseAdmin\s*\.from\(\s*"([a-z_]+)"\s*\)/g;
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    for (const m of testo.matchAll(re)) usate.add(m[1]);
  }

  assert.ok(usate.size > 25, `trovate solo ${usate.size} tabelle: la ricerca non funziona`);
  const mancanti = [...usate].filter((t) => !CLASSIFICA[t]).sort();
  assert.deepEqual(
    mancanti,
    [],
    `tabelle usate ma non dichiarate in CLASSIFICA: ${mancanti.join(", ")}`
  );
});
