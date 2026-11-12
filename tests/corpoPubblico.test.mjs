/**
 * Il tetto al corpo delle API pubbliche (audit 12/11/2026): `/api/track` e
 * `/api/contact` leggevano in memoria qualunque corpo, anche di centinaia di MB.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { corpoTroppoGrande, CORPO_PUBBLICO_MAX } from "../src/lib/rateLimit.ts";

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
