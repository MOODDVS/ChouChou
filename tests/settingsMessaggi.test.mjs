/**
 * I MESSAGGI D'ERRORE DI /api/admin/settings NELLA LINGUA DELL'ADMIN
 * (2/11/2026): erano scritti a mano in francese, e un admin in inglese
 * leggeva «Couverts invalides pour « Test » (1–500)».
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const API = readFileSync("src/pages/api/admin/settings.ts", "utf8");
const I18N = readFileSync("src/i18n/admin.ts", "utf8");

test("nessun messaggio d'errore scritto a mano: tutti passano da msg()/msgV()", () => {
  assert.doesNotMatch(API, /json\(\{ error: [`"](?!\$\{await msg)/);
  assert.doesNotMatch(API, /SERVIZI_WIDGET\[key\]\.fr/);
});

test("le chiavi nuove esistono in tutte e cinque le lingue, col segnaposto {v}", () => {
  const chiavi = [...API.matchAll(/msgV\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(chiavi.length >= 10);
  for (const k of new Set(chiavi)) {
    const riga = I18N.match(new RegExp(`^\\s*"${k.replace(".", "\\.")}":\\s*\\{(.*)\\},?$`, "m"));
    assert.ok(riga, k);
    for (const l of ["fr", "en", "it", "nl", "es"]) assert.match(riga[1], new RegExp(`${l}: "[^"]*\\{v\\}`), `${k}.${l}`);
  }
});
