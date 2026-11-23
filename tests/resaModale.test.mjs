// Il modale «nuova / modifica prenotazione» dell'admin (23/11/2026).
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pagina = readFileSync(new URL("../src/pages/admin/reservations.astro", import.meta.url), "utf8");

test("basta il nome: il cognome e' facoltativo", () => {
  assert.match(pagina, /if \(!campo\("m-fname"\)\.value\.trim\(\) && !campo\("m-lname"\)\.value\.trim\(\)\) \{/);
  assert.doesNotMatch(pagina, /if \(!campo\("m-lname"\)\.value\.trim\(\)\) \{\n\s+mMsg\.textContent = tr\("res\.nameRequired"\)/);
});

test("tavoli: col tavolo scelto solo quello + «Cambia»; «Cambia» apre persone-2..+2 e basta", () => {
  assert.match(pagina, /if \(selKey && !nmTavApri\) \{/);
  assert.match(pagina, /class="nm-cambia nm-cambia-man">\$\{tr\("res\.change"\)\}/);
  assert.match(pagina, /const MIN_POSTI = Math\.max\(1, nmPers - 2\);\n\s+const MAX_POSTI = nmPers \+ 2;/);
  assert.match(pagina, /\.filter\(\(o\) => \(o\.posti >= MIN_POSTI && o\.posti <= MAX_POSTI\) \|\| nmKeyIds\(o\.ids\) === selKey\)/);
  // niente piu' «+N» per vedere tutto
  assert.doesNotMatch(pagina, /class="nm-tv-piu"/);
  assert.doesNotMatch(pagina, /nmTavTutti/);
  // scelto un tavolo l'elenco si richiude
  assert.match(pagina, /nmTavApri = nmTavSel\.size === 0;/);
});
