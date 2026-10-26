/**
 * DIVIDERE IL CONTO PER PERSONA (il palmare, 26/10/2026).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { quoteRestanti } from "../src/lib/pagamentiSedutaRegole.ts";

test("71,50 € in 4: le prime per difetto, l'ultima prende i centesimi", () => {
  assert.deepEqual(quoteRestanti(7150, 4), [1787, 1787, 1788, 1788]);
});

test("la somma e' sempre il resto, mai un centesimo in piu' o in meno", () => {
  for (const [l, n] of [[1, 3], [100, 3], [9999, 7], [7150, 1], [5, 5]]) {
    const q = quoteRestanti(l, n);
    assert.equal(q.length, n);
    assert.equal(q.reduce((a, b) => a + b, 0), l);
  }
});

test("dopo un pagamento si ricalcola sul resto: chi ha pagato non cambia", () => {
  // 4 persone, la prima paga 17,87: le altre tre si dividono 53,63.
  assert.deepEqual(quoteRestanti(7150 - 1787, 3), [1787, 1788, 1788]);
  assert.deepEqual(quoteRestanti(0, 0), []);
});
