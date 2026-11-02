/**
 * GLI ELEMENTI DEL PIANO (2/11/2026): tipi, colori, etichette, rotazione, e
 * i decori di prima (solo pianta e muro) che restano validi.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizzaElemento, coloreElemento, disegnoElemento, TIPI_ELEMENTO, COLORI_ELEMENTO } from "../src/lib/elementiSala.ts";

test("i decori di prima restano validi", () => {
  const muro = normalizzaElemento({ id: "d1", type: "wall", color: "black", x: 10, y: 20, w: 200, h: 24 });
  assert.deepEqual(muro, { id: "d1", type: "wall", color: "black", label: "", rotation: 0, x: 10, y: 20, w: 200, h: 24 });
  // la pianta salvata «brown» (il ripiego dell'API di prima) resta verde
  const pianta = normalizzaElemento({ id: "d2", type: "plant", color: "brown", x: 0, y: 0, w: 60, h: 60 });
  assert.equal(coloreElemento(pianta), null);
  assert.equal(coloreElemento({ type: "plant", color: "coral" }), COLORI_ELEMENTO.coral);
});

test("tipo sconosciuto via; etichetta corta; rotazione a 15; colore di ripiego del tipo", () => {
  assert.equal(normalizzaElemento({ type: "astronave" }), null);
  const e = normalizzaElemento({ type: "door", label: "  Ingresso   principale della sala grande ", rotation: 100, color: "fucsia" });
  assert.equal(e.label, "Ingresso principale dell"); // spazi ripuliti, 24 caratteri al massimo
  assert.equal(e.rotation, 105);
  assert.equal(e.color, "wood");
});

test("ogni tipo ha un disegno, e ogni colore lo cambia", () => {
  for (const t of TIPI_ELEMENTO) {
    const a = disegnoElemento(t.k, t.w, t.h, COLORI_ELEMENTO.white).svg;
    const b = disegnoElemento(t.k, t.w, t.h, COLORI_ELEMENTO.black).svg;
    assert.ok(a.length > 20, t.k);
    assert.notEqual(a, b, t.k);
  }
  // la pianta tinta porta il suo filtro
  const p = disegnoElemento("plant", 70, 70, COLORI_ELEMENTO.coral);
  assert.match(p.defs, /<filter id="el-tinta-cb534d"/);
  assert.match(p.svg, /filter="url\(#el-tinta-cb534d\)"/);
  assert.equal(disegnoElemento("plant", 70, 70, null).defs, "");
});

test("il «vuoto»: solo le linee e un velo bianco, su ogni tipo", async () => {
  const { VUOTO } = await import("../src/lib/elementiSala.ts");
  const e = normalizzaElemento({ type: "bar", color: "ghost" });
  assert.equal(e.color, "ghost");
  assert.equal(coloreElemento(e), VUOTO);
  assert.equal(coloreElemento({ type: "plant", color: "ghost" }), VUOTO);
  for (const t of TIPI_ELEMENTO) {
    const { svg } = disegnoElemento(t.k, t.w, t.h, VUOTO);
    if (t.k === "plant") { assert.match(svg, /opacity="0.3"/); continue; }
    assert.match(svg, /fill-opacity="0.0[46]"/, t.k);
    // nessun colore pieno: niente riempimenti esadecimali tranne il bianco del velo
    for (const m of svg.matchAll(/fill="(#[0-9a-f]{6})"/g)) assert.equal(m[1], "#ffffff", t.k);
    // e nessun attributo doppio (un <circle> con due stroke non si disegna)
    for (const tag of svg.match(/<[^>]+>/g)) assert.doesNotMatch(tag, /stroke="[^"]*"[^>]*\sstroke="/, t.k);
  }
});
