/**
 * TOGLIERE DA UN ORDINE DAL PALMARE — solo meno, mai piu' della partenza.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { righeModificabili, applicaTogli, ordineModificabile, dividiModifica } from "../src/lib/admin/modificaOrdineRegole.ts";

const ITEMS = [
  { id: "a", name: "Margherita", qty: 2, price_cents: 1000 },
  { id: "note", name: "NOTE CLIENT", qty: 0, price_cents: 0, notes: "senza glutine" },
  { id: "b", name: "Coca", qty: 1, price_cents: 300 },
];

test("le righe vere, con il loro indice", () => {
  assert.deepEqual(righeModificabili(ITEMS).map((r) => [r.i, r.nome, r.qty]), [[0, "Margherita", 2], [2, "Coca", 1]]);
});

test("togliere: la quantita' scende, la riga a zero sparisce, la nota resta", () => {
  const r = applicaTogli(ITEMS, { 0: 1, 2: 0 });
  assert.equal(r.totale, 1000);
  assert.equal(r.vuoto, false);
  assert.equal(r.cambiato, true);
  assert.deepEqual(r.items.map((x) => [x.id, x.qty]), [["a", 1], ["note", 0]]);
});

test("le righe tolte, con la quantita' tolta: il ticket d'annullo della cucina", () => {
  const r = applicaTogli(ITEMS, { 0: 1, 2: 0 });
  assert.deepEqual(r.tolte.map((x) => [x.id, x.qty]), [["a", 1], ["b", 1]]);
  const tutto = applicaTogli(ITEMS, { 0: 0, 2: 0 });
  assert.equal(tutto.vuoto, true);
  assert.deepEqual(tutto.tolte.map((x) => [x.id, x.qty]), [["a", 2], ["b", 1]]);
  assert.deepEqual(applicaTogli(ITEMS, { 0: 2 }).tolte, [], "niente tolto, niente ticket");
});

test("mai piu' della partenza, mai la nota, mai un numero storto", () => {
  assert.equal(applicaTogli(ITEMS, { 0: 3 }), null, "aggiungere passa da un ordine nuovo");
  assert.equal(applicaTogli(ITEMS, { 1: 0 }), null, "la nota non e' una riga");
  assert.equal(applicaTogli(ITEMS, { 0: 1.5 }), null);
  assert.equal(applicaTogli(ITEMS, { 9: 0 }), null);
  assert.equal(applicaTogli(ITEMS, [1]), null);
});

test("tutto a zero: l'ordine e' vuoto (si annulla); niente cambiato: lo dice", () => {
  assert.equal(applicaTogli(ITEMS, { 0: 0, 2: 0 }).vuoto, true);
  assert.equal(applicaTogli(ITEMS, { 0: 2 }).cambiato, false);
});

test("solo un ordine da incassare si tocca dal palmare", () => {
  assert.equal(ordineModificabile({ status: "pending", payment_method: "onsite" }), true);
  assert.equal(ordineModificabile({ status: "paid", payment_method: "cash" }), false);
  assert.equal(ordineModificabile({ status: "pending", payment_method: "tab" }), false);
});

test("aggiungere col +: cio' che supera la partenza diventa un ordine nuovo", () => {
  const items = [
    { id: "a", name: "Margherita", qty: 2, price_cents: 1000, variant: "grande", notes: "ben cotta" },
    { id: "b", name: "Coca", qty: 1, price_cents: 300 },
  ];
  const d = dividiModifica(items, { 0: 3, 1: 0 });
  assert.deepEqual(d.togli, { 0: 2, 1: 0 });
  assert.deepEqual(d.aggiungi, [{ id: "a", qty: 1, variant: "grande", note: "ben cotta" }]);
  assert.equal(dividiModifica(items, { 0: 51 }), null, "un errore di dito non ordina 51 pizze");
  assert.equal(dividiModifica(items, { 5: 1 }), null);
});
