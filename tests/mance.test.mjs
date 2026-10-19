/**
 * LE MANCE — spente di ripiego, «Aucun» sempre, e la cifra la decide il server.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { tipoMance, valoriMance, valoriDaPagina, importoMancia, MANCE_RIPIEGO } from "../src/lib/manceRegole.ts";
import { RIPIEGO_ORDINI, RIPIEGO_ORDINI_SCELTA, acceso, manceInSala } from "../src/lib/ordiniRegole.ts";

const nudo = (f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("spente di ripiego: nessun checkout cambia il giorno del merge", () => {
  assert.equal(RIPIEGO_ORDINI.orders_tips, "0");
  assert.equal(acceso(undefined, "orders_tips"), false);
});

test("tipo e valori salvati: storti → ripiego, mai tre bottoni assurdi", () => {
  assert.equal(tipoMance("fixed"), "fixed");
  assert.equal(tipoMance("boh"), "percent");
  assert.deepEqual(valoriMance("percent", "5,10,15"), [5, 10, 15]);
  assert.deepEqual(valoriMance("percent", "5,10"), MANCE_RIPIEGO.percent);
  assert.deepEqual(valoriMance("percent", "5,10,80"), MANCE_RIPIEGO.percent, "oltre 50 %");
  assert.deepEqual(valoriMance("fixed", "100,200,300"), [100, 200, 300]);
  assert.deepEqual(valoriMance("fixed", "x,200,300"), MANCE_RIPIEGO.fixed);
});

test("i valori scritti in Réglages: illeggibile → rifiutato", () => {
  assert.deepEqual(valoriDaPagina("percent", ["5", "10", "15"]), [5, 10, 15]);
  assert.equal(valoriDaPagina("percent", ["5", "10", "7,5"]), null, "percentuali intere");
  assert.equal(valoriDaPagina("percent", ["5", "10", "60"]), null);
  assert.deepEqual(valoriDaPagina("fixed", ["1", "2,50", "3.5"]), [100, 250, 350]);
  assert.equal(valoriDaPagina("fixed", ["1", "2", "150"]), null, "oltre 100 €");
  assert.equal(valoriDaPagina("fixed", ["1", "2"]), null);
});

test("quanto vale la mancia scelta", () => {
  assert.equal(importoMancia(-1, "percent", [5, 10, 15], 2800), 0, "Aucun");
  assert.equal(importoMancia(undefined, "percent", [5, 10, 15], 2800), 0);
  assert.equal(importoMancia(1, "percent", [5, 10, 15], 2800), 280);
  assert.equal(importoMancia(0, "percent", [5, 10, 15], 2850), 143, "arrotondata al centesimo");
  assert.equal(importoMancia(2, "fixed", [100, 200, 300], 2800), 300);
  assert.equal(importoMancia(7, "fixed", [100, 200, 300], 2800), 0, "un indice inventato non e' una mancia");
  assert.equal(importoMancia("1.5", "fixed", [100, 200, 300], 2800), 0);
});

test("il server ricalcola, solo con la carta, e la salva a parte", () => {
  const co = nudo("src/pages/api/checkout.ts");
  // ⚠️ Sul conto aperto la mancia si lascia alla fine (conto-aperto.md).
  assert.match(co, /if \(!inCassa && !sulConto && body\.tip !== undefined && body\.tip !== null\) \{/);
  assert.match(co, /mancia = importoMancia\(body\.tip, m\.tipo, m\.valori, totaleIncassato\)/);
  assert.match(co, /total_cents: totaleIncassato \+ costoCons \+ mancia,/);
  assert.match(co, /\.\.\.\(mancia > 0 \? \{ tip_cents: mancia \} : \{\}\),/);
  // Dal carrello parte solo l'indice del bottone.
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /\.\.\.\(manceAttive && !inCassaOra && manciaScelta >= 0 \? \{ tip: manciaScelta \} : \{\}\),/);
  assert.match(app, /useState\(-1\)/, "Aucun scelto all'apertura");
  assert.match(app, /const manceAttive = mance !== null && !pagaInCassa && !soloConto;/);
});

test("modificare un ordine non toglie la mancia, e Réglages vuole la #86", () => {
  assert.match(nudo("src/pages/api/admin/orders.ts"), /"tip_cents"\)\.eq\("id", id\)\.maybeSingle\(\);[\s\S]{0,80}fuoriPiatti \+=/);
  assert.match(nudo("src/pages/api/admin/settings.ts"), /mappa\.get\("orders_tips"\) === "1"[\s\S]{0,140}"tip_cents"[\s\S]{0,120}err\.tipsMigration/);
});

test("al tavolo: un interruttore della sala, che mai scelto segue Paiements", () => {
  // ⚠️ Vuota = come prima: chi aveva le mance le aveva anche in sala.
  assert.equal(RIPIEGO_ORDINI_SCELTA.orders_table_tips, "");
  assert.equal(manceInSala(undefined, true), true);
  assert.equal(manceInSala("", false), false);
  assert.equal(manceInSala("0", true), false, "la sala le spegne");
  assert.equal(manceInSala("1", false), true, "solo al tavolo");
  assert.equal(manceInSala("boh", true), true);
  const opz = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opz, /sala \? manceInSala\(valori\.get\("orders_table_tips"\), globale\) : globale/);
  // Il checkout e la pagina chiedono la sala quando sono al tavolo.
  assert.match(nudo("src/pages/api/checkout.ts"), /manceDi\(ambitoPub, \{ sala: aTavolo \}\)/);
  assert.match(nudo("src/pages/api/order-options.ts"), /manceDi\(ambito, \{ sala: new URL\(request\.url\)\.searchParams\.get\("sala"\) === "1" \}\)/);
  assert.match(nudo("src/components/OrderApp.tsx"), /inSala \? conSede\("\/api\/order-options\?sala=1"\) : conSede\("\/api\/order-options"\)/);
  // Réglages la mostra risolta, e accenderla vuole la #86 come l'altra.
  const api = nudo("src/pages/api/admin/settings.ts");
  assert.match(api, /orders\.orders_table_tips = manceInSala\(cfg\.get\("orders_table_tips"\), orders\.orders_tips\);/);
  assert.match(api, /mappa\.get\("orders_table_tips"\) === "1"/);
  const pag = readFileSync("src/pages/admin/settings.astro", "utf8");
  assert.match(pag, /id="o-table-tips"/);
  assert.match(pag, /orders_table_tips: \(document\.getElementById\("o-table-tips"\)/);
});
