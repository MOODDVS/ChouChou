/**
 * Il tetto al corpo delle API pubbliche (audit 12/11/2026): `/api/track` e
 * `/api/contact` leggevano in memoria qualunque corpo, anche di centinaia di MB.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { corpoTroppoGrande, corpoAPezzi, CORPO_PUBBLICO_MAX } from "../src/lib/rateLimit.ts";

test("oltre il tetto le API pubbliche rispondono 413, l'admin e le letture no", () => {
  const troppo = String(CORPO_PUBBLICO_MAX + 1);
  assert.equal(corpoTroppoGrande("/api/track", "POST", troppo), true);
  assert.equal(corpoTroppoGrande("/api/contact", "POST", String(CORPO_PUBBLICO_MAX)), false);
  assert.equal(corpoTroppoGrande("/api/admin/upload", "POST", "50000000"), false, "l'admin carica foto");
  assert.equal(corpoTroppoGrande("/api/menu", "GET", troppo), false);
  assert.equal(corpoTroppoGrande("/api/stripe-webhook", "POST", troppo), false, "firmato da Stripe");
  assert.equal(corpoTroppoGrande("/menu", "POST", troppo), false);
  assert.equal(corpoTroppoGrande("/api/track", "POST", null), false);
  assert.match(readFileSync("src/middleware.ts", "utf8"), /if \(corpoTroppoGrande\(path, context\.request\.method, context\.request\.headers\.get\("content-length"\)\)\)/);
});

test("senza Content-Length (a pezzi) il corpo delle API pubbliche si legge col tetto (audit 26/11/2026)", () => {
  assert.equal(corpoAPezzi("/api/contact", "POST", null), true, "nessuna lunghezza: a pezzi");
  assert.equal(corpoAPezzi("/api/track", "POST", ""), true);
  assert.equal(corpoAPezzi("/api/contact", "POST", "120"), false, "con la lunghezza vale il tetto di prima");
  assert.equal(corpoAPezzi("/api/newsletter-unsubscribe", "POST", "0"), false, "POST vuoto dei client di posta");
  assert.equal(corpoAPezzi("/api/admin/upload", "POST", null), false, "l'admin carica foto");
  assert.equal(corpoAPezzi("/api/stripe-webhook", "POST", null), false, "firmato da Stripe");
  assert.equal(corpoAPezzi("/api/menu", "GET", null), false);
  assert.match(readFileSync("src/middleware.ts", "utf8"), /corpoAPezzi\(path, context\.request\.method, context\.request\.headers\.get\("content-length"\)\)/);
});

test("leggiConTetto: sotto il tetto il corpo intero, sopra null", async () => {
  const { leggiConTetto } = await import("../src/lib/rateLimit.ts");
  const piccola = new Request("http://x/api/track", { method: "POST", body: "ciao" });
  assert.equal(new TextDecoder().decode(await leggiConTetto(piccola, 10)), "ciao");
  const grande = new Request("http://x/api/track", { method: "POST", body: "x".repeat(20) });
  assert.equal(await leggiConTetto(grande, 10), null);
  assert.equal((await leggiConTetto(new Request("http://x/"), 10)).byteLength, 0, "senza corpo");
});
