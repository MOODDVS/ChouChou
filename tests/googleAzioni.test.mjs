/**
 * I bottoni della scheda Google — «Prenota», «Ordina» (6/11/2026).
 * Place Actions API: il link «preferito» va in cima; quelli dei fornitori
 * non si toccano da qui.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  locationDi, tipoValido, uriValido, nomeDellaScheda, normalizza, ordina, cimaDi, apiSpenta, linkPrenotaSuggerito,
} from "../src/lib/admin/googleAzioniRegole.ts";

const L = "locations/123";
const az = (o) => ({ name: `${L}/placeActionLinks/${o.id ?? "x"}`, tipo: "DINING_RESERVATION", uri: "https://a.be", preferito: false, nostro: true, modificabile: true, ...o });

test("dal percorso salvato alla location dell'API", () => {
  assert.equal(locationDi("accounts/9/locations/123"), "locations/123");
  assert.equal(locationDi("locations/123"), "locations/123");
  assert.equal(locationDi(""), "");
  assert.equal(locationDi("accounts/9"), "");
});

test("tipi, link e nomi: solo quello che si aspetta", () => {
  assert.ok(tipoValido("DINING_RESERVATION"));
  assert.ok(!tipoValido("APPOINTMENT"));
  assert.ok(uriValido("https://villa77.be/reservation?ref=google"));
  assert.ok(!uriValido("http://villa77.be"));
  assert.ok(!uriValido("javascript:alert(1)"));
  assert.ok(!uriValido("https://a:b@villa77.be"));
  assert.ok(nomeDellaScheda(`${L}/placeActionLinks/abc`, L));
  assert.ok(!nomeDellaScheda("locations/999/placeActionLinks/abc", L), "il link di un'altra scheda");
  assert.ok(!nomeDellaScheda(`${L}/placeActionLinks/abc/../x`, L));
  assert.ok(!nomeDellaScheda(`${L}/placeActionLinks/abc`, ""));
});

test("da Google: nostro = MERCHANT, preferito e modificabile solo se Google lo dice", () => {
  const a = normalizza({ name: "n", placeActionType: "DINING_RESERVATION", uri: "https://x", isPreferred: true, providerType: "MERCHANT", isEditable: true });
  assert.deepEqual(a, { name: "n", tipo: "DINING_RESERVATION", uri: "https://x", preferito: true, nostro: true, modificabile: true });
  const f = normalizza({ providerType: "AGGREGATOR_3P" });
  assert.equal(f.nostro, false);
  assert.equal(f.modificabile, false);
  assert.equal(f.preferito, false);
});

test("in ordine: per tipo, il preferito per primo", () => {
  const o = ordina([az({ id: 1, tipo: "FOOD_TAKEOUT" }), az({ id: 2 }), az({ id: 3, preferito: true })]);
  assert.deepEqual(o.map((a) => a.name.slice(-1)), ["3", "2", "1"]);
});

test("chi sta in cima", () => {
  assert.equal(cimaDi([], "DINING_RESERVATION"), "vuoto");
  assert.equal(cimaDi([az({ preferito: true })], "DINING_RESERVATION"), "nostro");
  assert.equal(cimaDi([az({ preferito: true, nostro: false })], "DINING_RESERVATION"), "fornitore");
  assert.equal(cimaDi([az({}), az({ nostro: false })], "DINING_RESERVATION"), "conteso");
  assert.equal(cimaDi([az({})], "DINING_RESERVATION"), "solo-nostri");
});

test("API spenta e link suggerito", () => {
  assert.ok(apiSpenta("My Business Place Actions API has not been used in project 123 before or it is disabled."));
  assert.ok(!apiSpenta("Request contains an invalid argument."));
  assert.equal(linkPrenotaSuggerito("https://chouchou.be/admin/google", true), "https://chouchou.be/reservation?ref=google");
  assert.equal(linkPrenotaSuggerito("https://villa77.be", false), "https://villa77.be/reservation-embed?ref=google");
  assert.equal(linkPrenotaSuggerito("http://localhost:4321", true), "");
});

test("l'API: tutto in POST, i fornitori non si toccano, il nome si controlla", async () => {
  const api = readFileSync("src/pages/api/admin/google/azioni.ts", "utf8");
  assert.doesNotMatch(api, /export const (DELETE|PATCH|PUT)/, "DELETE/PATCH dal browser: il WAF di Hostinger li blocca");
  assert.match(api, /if \(!nomeDellaScheda\(name, location\)\)/);
  assert.match(api, /if \(!questa\.modificabile\) return json/);
  assert.match(api, /if \(!uriValido\(uri\)\)/);
  const { API_PAGINA } = await import("../src/lib/admin/permessiRegole.ts");
  assert.equal(API_PAGINA["google/azioni"], "google");
});
