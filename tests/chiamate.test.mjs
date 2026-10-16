/**
 * «Appeler le serveur» — le regole pure (`src/lib/chiamateRegole.ts`).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  decidiChiamata, aperteNellaFinestra, chiaveChiamata, etichettaChiamata,
  FINESTRA_CHIAMATE_MIN, MASSIMO_APERTE, ATTESE_CHIAMATA, attesaChiamata,
} from "../src/lib/chiamateRegole.ts";

const ADESSO = Date.parse("2026-10-16T19:30:00Z");
const fa = (sec) => new Date(ADESSO - sec * 1000).toISOString();
const c = (id, table_id, sec) => ({ id, table_id, table_label: table_id.toUpperCase(), created_at: fa(sec) });

test("nessuna chiamata aperta: si registra", () => {
  assert.deepEqual(decidiChiamata([], "t:t4", ADESSO), { tipo: "nuova" });
});

test("lo stesso tavolo che tocca due volte: e' gia' fatto, e dice quanto manca", () => {
  // Attesa 5 minuti, chiamato 30 secondi fa → mancano 270 secondi.
  assert.deepEqual(decidiChiamata([c("a", "t4", 30)], "t:t4", ADESSO, 5), { tipo: "gia", id: "a", restanti: 270 });
});

test("passata l'attesa scelta, lo stesso tavolo puo' richiamare: e' il promemoria", () => {
  assert.deepEqual(decidiChiamata([c("a", "t4", 3 * 60 + 1)], "t:t4", ADESSO, 3), { tipo: "nuova" });
  assert.equal(decidiChiamata([c("a", "t4", 3 * 60 + 1)], "t:t4", ADESSO, 5).tipo, "gia");
});

test("una chiamata gia' sbrigata fa contare l'attesa lo stesso", () => {
  // Il cameriere tocca «ci vado» dopo 20 secondi: il timer del cliente non si azzera.
  const sbrigata = { ...c("a", "t4", 20), status: "done" };
  assert.equal(decidiChiamata([sbrigata], "t:t4", ADESSO, 5).tipo, "gia");
});

test("il tetto conta solo le chiamate ancora da sbrigare", () => {
  const tante = Array.from({ length: MASSIMO_APERTE }, (_, i) => ({ ...c(String(i), `t${i}`, 200), status: "done" }));
  assert.deepEqual(decidiChiamata(tante, "t:nuovo", ADESSO), { tipo: "nuova" });
});

test("l'attesa: solo i valori dell'elenco, mai oltre la finestra, 5 di ripiego", () => {
  assert.deepEqual([...ATTESE_CHIAMATA], [1, 3, 5, 10]);
  for (const m of ATTESE_CHIAMATA) assert.ok(m <= FINESTRA_CHIAMATE_MIN, `${m} min: oltre la finestra il doppione non si trova piu'`);
  assert.equal(attesaChiamata("3"), 3);
  assert.equal(attesaChiamata("10"), 10);
  assert.equal(attesaChiamata(""), 5);
  assert.equal(attesaChiamata("0"), 5);
  assert.equal(attesaChiamata("60"), 5);
  assert.equal(attesaChiamata(undefined), 5);
});

test("un altro tavolo non e' un doppione", () => {
  assert.deepEqual(decidiChiamata([c("a", "t4", 10)], "t:t5", ADESSO), { tipo: "nuova" });
});

test("oltre il tetto la sede smette di registrare", () => {
  const tante = Array.from({ length: MASSIMO_APERTE }, (_, i) => c(String(i), `t${i}`, 200));
  assert.deepEqual(decidiChiamata(tante, "t:nuovo", ADESSO), { tipo: "troppe" });
});

test("le chiamate fuori finestra non contano e non si mostrano", () => {
  const vecchia = c("v", "t4", FINESTRA_CHIAMATE_MIN * 60 + 5);
  assert.deepEqual(aperteNellaFinestra([vecchia], ADESSO), []);
  const tante = Array.from({ length: MASSIMO_APERTE }, (_, i) => c(String(i), `t${i}`, FINESTRA_CHIAMATE_MIN * 60 + 5));
  assert.deepEqual(decidiChiamata(tante, "t:t1", ADESSO), { tipo: "nuova" });
});

test("dalla piu' vecchia alla piu' nuova, e una data rotta si scarta", () => {
  const righe = [c("b", "t2", 10), c("a", "t1", 100), { id: "x", table_id: "t9", table_label: "T9", created_at: "boh" }];
  assert.deepEqual(aperteNellaFinestra(righe, ADESSO).map((r) => r.id), ["a", "b"]);
});

test("senza tavoli il doppione si riconosce dal nome, senza maiuscole", () => {
  const marc = { id: "m", table_id: null, table_label: "", caller_name: "Marc", created_at: fa(20) };
  assert.equal(chiaveChiamata(marc), "n:marc");
  assert.equal(decidiChiamata([marc], chiaveChiamata({ caller_name: " marc " }), ADESSO).tipo, "gia");
  assert.deepEqual(decidiChiamata([marc], chiaveChiamata({ caller_name: "Julie" }), ADESSO), { tipo: "nuova" });
});

test("il tavolo e il nome non si confondono", () => {
  // Un tavolo che si chiama «Marc» e una persona che si chiama Marc sono due chiavi.
  assert.notEqual(chiaveChiamata({ table_id: "marc" }), chiaveChiamata({ caller_name: "marc" }));
});

test("sul tablet: il tavolo se c'e', se no il nome", () => {
  assert.equal(etichettaChiamata({ table_label: "T4", caller_name: "" }), "T4");
  assert.equal(etichettaChiamata({ table_label: "", caller_name: "Marc" }), "Marc");
});
