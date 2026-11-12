/**
 * IL DIZIONARIO DELL'ADMIN NEL BROWSER — una lingua sola (audit 12/11/2026).
 *
 * Prima ogni pagina admin scaricava `i18n/admin.ts` intero: 2900 testi in 5
 * lingue, 167 KB compressi, per usarne una. Ora gli script delle pagine
 * importano `adminClient.ts`, e le stringhe arrivano da
 * `/api/i18n/admin-<lingua>.<impronta>.js`, in cache finche' non cambiano.
 * ⚠️ Basta UN import di `admin.ts` in uno script del browser per rimettere
 * tutto nel pacchetto, senza nessun errore: questo test lo impedisce.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { adminT, dizionarioDi, ADMIN_LANG_CODES } from "../src/i18n/admin.ts";

const astro = [];
const giro = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) giro(p);
    else if (p.endsWith(".astro")) astro.push(p);
  }
};
giro("src");

test("nessuno script del browser importa il dizionario intero", () => {
  for (const f of astro) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/<script(?![^>]*is:inline)(?![^>]*type="application)[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.doesNotMatch(m[1], /from\s+["'](?:\.\.\/)+i18n\/admin["']/, `${f}: importa i18n/admin nel browser — usare i18n/adminClient`);
    }
  }
});

test("il dizionario di una lingua ha tutte le chiavi, col ripiego di adminT", () => {
  for (const l of ADMIN_LANG_CODES) {
    const d = dizionarioDi(l);
    const t = adminT(l);
    assert.ok(Object.keys(d).length > 2000);
    for (const k of ["nav.home", "common.delete", "err.forbidden"]) assert.equal(d[k], t(k));
  }
});

test("le pagine caricano le stringhe prima dei loro script", () => {
  const head = readFileSync("src/components/admin/AdminHead.astro", "utf8");
  assert.match(head, /<script is:inline src=\{i18nUrl\} nonce=\{nonce\}><\/script>/);
  for (const p of ["src/pages/admin/login.astro", "src/pages/admin/reset-password.astro"]) {
    assert.match(readFileSync(p, "utf8"), /<script is:inline src=\{urlDizionario\(lang\)\} nonce=\{nonce\}><\/script>/);
  }
  const client = readFileSync("src/i18n/adminClient.ts", "utf8");
  assert.doesNotMatch(client, /from\s+["']\.\/admin["']/, "adminClient non deve importare admin.ts");
});

test("lo script anti-zoom porta il nonce (la CSP dell'admin lo bloccava)", () => {
  assert.match(readFileSync("src/components/NoZoom.astro", "utf8"), /<script is:inline nonce=\{nonce\}>/);
});
