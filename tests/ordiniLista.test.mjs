/**
 * Il primo disegno di «Commandes» e il poll leggono gli ordini con LA STESSA
 * query (20/11/2026). Prima la pagina ne aveva una sua, senza le colonne del
 * tavolo: ogni ordine compariva «ONLINE · DA ASPORTO» per 25 secondi, finche'
 * il poll non ridisegnava (Educazione Napoletana, 19/11/2026).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const PAGINA = readFileSync("src/pages/admin/orders.astro", "utf8");
const API = readFileSync("src/pages/api/admin/orders.ts", "utf8");
const LIB = readFileSync("src/lib/admin/ordiniAdmin.ts", "utf8");

test("pagina e API passano tutte e due da elencoOrdiniAdmin", () => {
  assert.match(PAGINA, /ssrOrders = soglia \? await elencoOrdiniAdmin\(ambitoOrd, \{ da: soglia \}\) : null;/);
  assert.match(API, /await elencoOrdiniAdmin\(ambito, daISO && aISO \? \{ da: daISO, a: aISO \} : \{ da: String\(soglia\) \}\)/);
  // nessuna delle due tiene una query sua degli ordini della lista
  const frontmatter = PAGINA.slice(0, PAGINA.indexOf("\n---\n", 4));
  assert.doesNotMatch(frontmatter, /leggi\(\s*"orders"/);
  assert.doesNotMatch(API.slice(API.indexOf("export const GET"), API.indexOf("export const POST")), /leggiOrdini|CAMPI_BASE/);
});

test("la lista porta le colonne del tavolo e il «pronto»", () => {
  assert.match(LIB, /const EXTRA_82 = ", service, table_label, reservation_id";/);
  assert.match(LIB, /const EXTRA_89 = ", ready_at";/);
  assert.match(LIB, /parziale_cents/);
});
