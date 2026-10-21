/* ==========================================================================
   QUANTO SI PUO' ANCORA RIMBORSARE (23/10/2026).

   Il caso che ha aperto il guasto: due piatti pagati (30 €), una modifica
   toglie un piatto (totale 20, differenza da rendere 10), poi l'ordine si
   annulla. Il rimborso proponeva 20: i 10 del piatto tolto restavano sulla
   carta del ristorante, e nessun bottone li faceva piu' uscire.
   ========================================================================== */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { rimborsabile, entrato } from "../src/lib/admin/ordiniConti.ts";

const leggi = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("pagato e mai toccato: si rende tutto", () => {
  assert.equal(rimborsabile({ total_cents: 3000, refunded_cents: 0 }), 3000);
});

test("modifica al ribasso NON resa, poi annullato: si rende anche il piatto tolto", () => {
  // Pagati 30; tolto un piatto da 10.
  const o = { total_cents: 2000, refund_due_cents: 1000, supplement_due_cents: 0, refunded_cents: 0 };
  assert.equal(rimborsabile(o), 3000);
});

test("modifica al ribasso GIA' resa, poi annullato: resta il prezzo nuovo", () => {
  // La differenza resa salda `refund_due_cents` e non tocca `refunded_cents`.
  const o = { total_cents: 2000, refund_due_cents: 0, supplement_due_cents: 0, refunded_cents: 0 };
  assert.equal(rimborsabile(o), 2000);
  // E l'incasso del giorno e' il prezzo nuovo, non il prezzo meno la differenza.
  assert.equal(entrato({ ...o, status: "paid" }), 2000);
});

test("differenza resa a meta': si rende il prezzo nuovo piu' quello che resta del debito", () => {
  const o = { total_cents: 2000, refund_due_cents: 400, supplement_due_cents: 0, refunded_cents: 0 };
  assert.equal(rimborsabile(o), 2400);
});

test("modifica al rialzo con supplemento NON pagato: il supplemento non si rende", () => {
  // Pagati 30; aggiunto un piatto da 5 non ancora pagato.
  const o = { total_cents: 3500, refund_due_cents: 0, supplement_due_cents: 500, refunded_cents: 0 };
  assert.equal(rimborsabile(o), 3000);
});

test("supplemento pagato: si rende tutto, supplemento compreso", () => {
  const o = { total_cents: 3500, refund_due_cents: 0, supplement_due_cents: 0, refunded_cents: 0 };
  assert.equal(rimborsabile(o), 3500);
});

test("rimborso parziale gia' fatto: resta il resto, e mai sotto zero", () => {
  assert.equal(rimborsabile({ total_cents: 2000, refund_due_cents: 1000, refunded_cents: 1200 }), 1800);
  assert.equal(rimborsabile({ total_cents: 2000, refund_due_cents: 1000, refunded_cents: 3000 }), 0);
  assert.equal(rimborsabile({ total_cents: 2000, refunded_cents: 5000 }), 0);
});

test("la regola e' una sola: server, card, email di annullamento", () => {
  const refund = leggi("src/pages/api/admin/refund.ts");
  assert.match(refund, /const residuo = rimborsabile\(\{/);
  // Una differenza resa non si somma ai rimborsi.
  assert.match(refund, /const nuovoTotale = isDiff \? giaRimborsato : giaRimborsato \+ daRimborsare;/);
  assert.match(refund, /if \(isDiff\) upd\.refund_due_cents = .*\n\s*else upd\.refunded_cents = nuovoTotale;/);
  assert.match(leggi("src/pages/admin/orders.astro"), /const residuo = rimborsabile\(o\);/);
  assert.match(leggi("src/pages/api/admin/orders.ts"), /const residuo = rimborsabile\(\{/);
  // Nessuno torna a fare `totale - rimborsato` per sapere quanto rendere.
  for (const f of ["src/pages/api/admin/refund.ts", "src/pages/admin/orders.astro"]) {
    assert.doesNotMatch(leggi(f), /total_cents\s*(\?\?\s*0\)?)?\s*-\s*(gia|refunded|giaRimborsato)/, f);
  }
});
