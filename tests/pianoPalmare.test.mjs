/**
 * LA PIANTINA SUL PALMARE — quali sale, e come stanno su un telefono in piedi.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { saleDelPalmare, pianoVerticale } from "../src/lib/pianoPalmare.ts";

const SEZIONI = JSON.stringify([{ name: "Terrasse", seats: 20 }, { name: "Salle", seats: 40 }, { name: "Cave", seats: 10 }]);
/** Senza margine e senza misura minima: le coordinate si leggono a mano. */
const NUDO = { margine: 0, minLarghezza: 0, minAltezza: 0 };
const T = (id, zone, name, x, y, w = 100, h = 100, shape = "square") => ({ id, zone, name, seats: 4, shape, x, y, w, h });

test("le sale nell'ordine delle sections, senza fantasmi e senza sale vuote", () => {
  const sale = saleDelPalmare({
    righe: [
      T("1", "Salle", "T2", 0, 0), T("2", "Salle", "T10", 200, 0), T("3", "Terrasse", "E1", 0, 0),
      T("4", "Vecchia", "T1", 0, 0), // section cancellata: un fantasma
    ],
    sezioni: SEZIONI,
  });
  assert.deepEqual(sale.map((s) => s.zona), ["Terrasse", "Salle"], "Cave non ha tavoli, Vecchia non esiste");
  assert.deepEqual(sale[1].tavoli.map((t) => t.name), ["T2", "T10"], "ordine numerico, non alfabetico");
});

test("senza sections configurate si tiene tutto, per zona", () => {
  const sale = saleDelPalmare({ righe: [T("1", "B", "1", 0, 0), T("2", "A", "1", 0, 0)], sezioni: "" });
  assert.deepEqual(sale.map((s) => s.zona), ["A", "B"]);
});

test("perimetro e decori della section giusta; JSON rotto = niente, mai un errore", () => {
  const sale = saleDelPalmare({
    righe: [T("1", "Salle", "T1", 10, 10)],
    sezioni: SEZIONI,
    aree: JSON.stringify({ Salle: [[0, 0], [500, 0], [500, 300], [0, 300]], Terrasse: [[0, 0]] }),
    decori: JSON.stringify({ Salle: [{ type: "wall", color: "white", x: 0, y: 0, w: 500, h: 8 }, { type: "sedia", x: 0, y: 0 }] }),
  });
  assert.equal(sale[0].area?.length, 4);
  assert.deepEqual(sale[0].decor.map((d) => d.type), ["wall"], "un tipo sconosciuto non si disegna");
  assert.doesNotThrow(() => saleDelPalmare({ righe: "x", sezioni: "{rotto", aree: "{rotto", decori: 3 }));
});

test("una sala piu' larga che alta si gira: il lato lungo sul lato lungo del telefono", () => {
  // 600 di larghezza, 200 di altezza: in orizzontale.
  const sala = { zona: "Salle", area: null, decor: [], tavoli: [
    { id: "a", name: "A", seats: 2, shape: "square", x: 100, y: 100, w: 100, h: 50 },
    { id: "b", name: "B", seats: 2, shape: "square", x: 600, y: 250, w: 100, h: 50 },
  ] };
  const p = pianoVerticale(sala, NUDO);
  assert.equal(p.ruotata, true);
  assert.equal(p.larghezza, 200);
  assert.equal(p.altezza, 600);
  assert.ok(p.altezza > p.larghezza);
  // In senso orario: A (in alto a sinistra) va in alto a DESTRA, B (in basso
  // a destra) va in basso a SINISTRA. Larghezza e altezza si scambiano.
  const [a, b] = p.tavoli;
  assert.deepEqual([a.x, a.y, a.w, a.h], [150, 0, 50, 100]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [0, 500, 50, 100]);
});

test("una sala gia' in verticale non si gira, si taglia soltanto", () => {
  const sala = { zona: "Salle", area: null, decor: [], tavoli: [
    { id: "a", name: "A", seats: 2, shape: "round", x: 300, y: 100, w: 50, h: 50 },
    { id: "b", name: "B", seats: 2, shape: "round", x: 300, y: 500, w: 50, h: 50 },
  ] };
  const p = pianoVerticale(sala, { ...NUDO, margine: 10 });
  assert.equal(p.ruotata, false);
  assert.deepEqual([p.larghezza, p.altezza], [70, 470]);
  assert.deepEqual([p.tavoli[0].x, p.tavoli[0].y], [10, 10], "la tela si taglia attorno a quello che c'e'");
});

test("il perimetro si gira con i tavoli", () => {
  const sala = { zona: "Salle", decor: [], tavoli: [], area: [[0, 0], [400, 0], [400, 100], [0, 100]] };
  const p = pianoVerticale(sala, NUDO);
  assert.equal(p.ruotata, true);
  assert.deepEqual(p.area, [[100, 0], [100, 400], [0, 400], [0, 0]]);
});

test("una sala piccola non diventa enorme: misura minima, e la sala al centro", () => {
  const sala = { zona: "Terrasse", area: null, decor: [], tavoli: [
    { id: "a", name: "E1", seats: 2, shape: "round", x: 100, y: 100, w: 80, h: 80 },
  ] };
  const p = pianoVerticale(sala, { margine: 20, minLarghezza: 360, minAltezza: 600 });
  assert.deepEqual([p.larghezza, p.altezza], [360, 600]);
  const [t] = p.tavoli;
  assert.deepEqual([t.x + t.w / 2, t.y + t.h / 2], [180, 300], "il tavolo sta al centro della tela");
});
