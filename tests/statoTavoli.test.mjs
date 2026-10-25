/**
 * GLI STATI DEI TAVOLI SULLA MAPPA DEL PALMARE (25/10/2026).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { statiTavoli } from "../src/lib/statoTavoliRegole.ts";

const DURATE = { perServizio: {}, ripiego: 90 };
const base = (o = {}) => ({
  tavoli: ["T1", "T2", "T3"],
  righe: [],
  conti: [],
  chiamate: [],
  qrDiretti: new Set(),
  adessoHHmm: "20:00",
  durate: DURATE,
  ...o,
});
const seduto = (id, heure, tables, extra = {}) => ({ id, heure, status: "seated", tables, ...extra });
const attesa = (id, heure, tables) => ({ id, heure, status: "confirmed", tables });

test("libero: nessun colore, nessun bordo", () => {
  const s = statiTavoli(base()).get("T1");
  assert.deepEqual(s, { colore: "libero", bordo: false, icone: [], arrivo: null, sforo: null });
});

test("prenotato entro 60 minuti: bordo bianco e l'ora d'arrivo", () => {
  const m = statiTavoli(base({ righe: [attesa("r1", "20:45", ["T1"]), attesa("r2", "21:30", ["T2"])] }));
  assert.equal(m.get("T1").bordo, true);
  assert.equal(m.get("T1").arrivo, "20:45");
  assert.equal(m.get("T2").bordo, false, "oltre l'ora: niente bordo");
});

test("una prenotazione in ritardo da poco tiene il bordo; da troppo no", () => {
  const m = statiTavoli(base({ righe: [attesa("r1", "19:40", ["T1"]), attesa("r2", "19:00", ["T2"])] }));
  assert.equal(m.get("T1").bordo, true);
  assert.equal(m.get("T2").bordo, false);
});

test("seduto dal cameriere: verde senza icone", () => {
  const s = statiTavoli(base({ righe: [seduto("s1", "19:30", ["T1"])] })).get("T1");
  assert.equal(s.colore, "verde");
  assert.deepEqual(s.icone, []);
});

test("conto aperto: arancione da convalidare, verde dopo, sempre col QR", () => {
  const m = statiTavoli(base({ righe: [
    seduto("s1", "19:30", ["T1"], { tab_status: "pending" }),
    seduto("s2", "19:30", ["T2"], { tab_status: "open" }),
  ] }));
  assert.equal(m.get("T1").colore, "arancio");
  assert.deepEqual(m.get("T1").icone, ["qr"]);
  assert.equal(m.get("T2").colore, "verde");
  assert.deepEqual(m.get("T2").icone, ["qr"]);
});

test("un conto di ieri (non fra le righe di oggi) colora lo stesso", () => {
  const s = statiTavoli(base({ conti: [{ id: "c1", tab_status: "open", tab_table_id: "T3", tables: [] }] })).get("T3");
  assert.equal(s.colore, "verde");
  assert.deepEqual(s.icone, ["qr"]);
});

test("QR con pagamento diretto: verde con QR e carta", () => {
  const s = statiTavoli(base({ righe: [seduto("s1", "19:30", ["T1"])], qrDiretti: new Set(["s1"]) })).get("T1");
  assert.deepEqual(s.icone, ["qr", "carta"]);
});

test("rosso: tempo finito e la prossima entro 15 minuti, sugli stessi tavoli", () => {
  // Seduti alle 18:15, 90 minuti: finito alle 19:45. Prossima alle 20:10.
  const m = statiTavoli(base({ righe: [seduto("s1", "18:15", ["T1", "T2"]), attesa("r1", "20:10", ["T2"])] }));
  assert.equal(m.get("T1").colore, "rosso");
  assert.deepEqual(m.get("T1").sforo, { fine: "19:45", prossima: "20:10" });
  assert.equal(m.get("T2").colore, "rosso");
  assert.equal(m.get("T2").bordo, false, "il rosso contiene gia' il bordo");
});

test("tempo finito ma la prossima e' lontana: resta verde (col bordo se entro l'ora)", () => {
  const s = statiTavoli(base({ righe: [seduto("s1", "18:15", ["T1"]), attesa("r1", "20:40", ["T1"])] })).get("T1");
  assert.equal(s.colore, "verde");
  assert.equal(s.bordo, true);
});

test("tempo non ancora finito: niente rosso anche se la prossima e' vicina", () => {
  const s = statiTavoli(base({ righe: [seduto("s1", "19:00", ["T1"]), attesa("r1", "20:10", ["T1"])] })).get("T1");
  assert.equal(s.colore, "verde");
  assert.equal(s.bordo, true);
});

test("seduto da oltre tempo + 20 minuti: non conta piu' (l'admin lo chiude)", () => {
  const s = statiTavoli(base({ righe: [seduto("s1", "17:00", ["T1"])] })).get("T1");
  assert.equal(s.colore, "libero");
});

test("blu: la tavolata ha chiesto il conto, vince su tutto", () => {
  const m = statiTavoli(base({
    righe: [seduto("s1", "18:15", ["T1", "T2"], { tab_status: "open" }), attesa("r1", "20:05", ["T1"])],
    chiamate: [{ table_id: "T2", reason: "bill" }, { table_id: "T3", reason: "call" }],
  }));
  assert.equal(m.get("T1").colore, "blu");
  assert.deepEqual(m.get("T1").icone, ["qr", "addizione"]);
  assert.equal(m.get("T3").colore, "libero", "una chiamata del cameriere non e' il conto");
});

test("seduto oltre il tempo ma con un ordine da incassare: resta occupato (e rosso se arriva qualcuno)", () => {
  // Enzo, 25/10/2026: seduti alle 17:00, ordine aperto, alle 20:00 il tavolo era tornato libero.
  const m = statiTavoli(base({
    righe: [seduto("s1", "17:00", ["T1"]), seduto("s2", "17:00", ["T2"]), attesa("r2", "20:10", ["T2"])],
    conOrdini: new Set(["s1", "s2"]),
  }));
  assert.equal(m.get("T1").colore, "verde");
  assert.equal(m.get("T2").colore, "rosso");
});
