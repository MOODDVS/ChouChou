// Il modale «nuova / modifica prenotazione» dell'admin (23/11/2026).
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pagina = readFileSync(new URL("../src/pages/admin/reservations.astro", import.meta.url), "utf8");

test("basta il nome: il cognome e' facoltativo", () => {
  assert.match(pagina, /if \(!campo\("m-fname"\)\.value\.trim\(\) && !campo\("m-lname"\)\.value\.trim\(\)\) \{/);
  assert.doesNotMatch(pagina, /if \(!campo\("m-lname"\)\.value\.trim\(\)\) \{\n\s+mMsg\.textContent = tr\("res\.nameRequired"\)/);
});

test("tavoli: solo da persone-2 a persone+2, mai tutto come ripiego, la scelta per prima", () => {
  assert.match(pagina, /const MIN_POSTI = Math\.max\(1, nmPers - 2\);\n\s+const MAX_POSTI = nmPers \+ 2;/);
  assert.match(pagina, /else base = \[\];/);
  assert.doesNotMatch(pagina, /else base = opzioni\.slice\(\);/);
  assert.match(pagina, /\.sort\(\(x, y\) => Number\(nmKeyIds\(y\.ids\) === selKey\) - Number\(nmKeyIds\(x\.ids\) === selKey\)\)/);
  assert.match(pagina, /tr\("res\.tablesNone"\)/);
});
