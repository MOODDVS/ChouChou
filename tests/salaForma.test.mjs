/**
 * LA FORMA DELLA SALA (1/11/2026): angoli, muri diagonali e muri curvi.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizzaArea, tracciatoSala, muroSala, puntiIngombro, aggiungiAngolo, TELA, SALA_DI_SEMPRE } from "../src/lib/salaForma.ts";

test("i piani di prima (quattro angoli, senza curva) restano validi e uguali", () => {
  const vecchio = [[0, 0], [1000, 0], [1000, 600], [0, 600]];
  assert.deepEqual(normalizzaArea(vecchio), vecchio);
  assert.equal(tracciatoSala(normalizzaArea(vecchio)), "M0 0 L1000 0 L1000 600 L0 600 L0 0 Z");
});

test("normalizza: interi, dentro la tela, curva solo se c'e', 3–80 punti", () => {
  assert.deepEqual(normalizzaArea([[0.4, 0], [5000, -9000, 0], [10, 20, 33.6]]), [[0, 0], [TELA.x1, TELA.y0], [10, 20, 34]]);
  assert.equal(normalizzaArea([[0, 0], [1, 1]]), null);
  assert.equal(normalizzaArea(Array.from({ length: 81 }, (_, i) => [i, i])), null);
  assert.equal(normalizzaArea([[0, 0], [1, "x"], [2, 2]]), null);
  assert.equal(normalizzaArea("no"), null);
});

test("un muro curvo verso fuori: la pancia esce dalla sala, in qualunque verso girino i punti", () => {
  // muro destro (1000,0)→(1000,600) curvo di 100: la pancia a x=1100
  const orario = [[0, 0], [1000, 0, 100], [1000, 600], [0, 600]];
  const m = muroSala(orario, 1);
  assert.deepEqual([m.px, m.py], [1100, 300]);
  assert.match(tracciatoSala(orario), /L1000 0 Q1200 300 1000 600/);
  // stessa sala coi punti al contrario: il muro (1000,600)→(1000,0) parte dal punto 1
  const antiorario = [[0, 600], [1000, 600, 100], [1000, 0], [0, 0]];
  assert.deepEqual([muroSala(antiorario, 1).px, muroSala(antiorario, 1).py], [1100, 300]);
  // curva negativa: verso dentro
  assert.equal(muroSala([[0, 0], [1000, 0, -50], [1000, 600], [0, 600]], 1).px, 950);
});

test("l'ingombro conta anche la pancia degli archi", () => {
  const xs = puntiIngombro([[0, 0], [1000, 0, 100], [1000, 600], [0, 600]]).map((p) => p[0]);
  assert.equal(Math.max(...xs), 1100);
});

test("un angolo nuovo a meta' muro: sul muro dritto e sull'arco", () => {
  const r = aggiungiAngolo(SALA_DI_SEMPRE, 2); // muro in basso (1000,600)→(0,600)
  assert.equal(r.nuovo, 3);
  assert.deepEqual(r.punti, [[0, 0], [1000, 0], [1000, 600], [500, 600], [0, 600]]);
  const c = aggiungiAngolo([[0, 0], [1000, 0, 100], [1000, 600], [0, 600]], 1);
  assert.deepEqual(c.punti[2], [1100, 300, 50]);
  assert.deepEqual(c.punti[1], [1000, 0, 50]);
});
