/**
 * Il nome della richiesta per il 301 nudo → www e l'HSTS (26/11/2026).
 * Da Astro 7.4 `request.url` dice `localhost` se il nome non e' in
 * `security.allowedDomains`: si legge l'header Host.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

test("redirectWww e HSTS leggono l'header Host, non request.url", () => {
  const src = readFileSync("src/middleware.ts", "utf8");
  assert.match(src, /if \(hostDellaRichiesta\(context\.request\) !== hostApex\) return next\(\);/);
  assert.match(src, /const host = hostDellaRichiesta\(context\.request\);/);
  assert.match(src, /context\.redirect\(`https:\/\/\$\{hostWww\}\$\{url\.pathname\}\$\{url\.search\}`, 301\)/, "il 301 va sempre al www configurato, in https");
});
