/**
 * GLI SCRIPT NON SI INCOLLANO NELL'HTML, E GLI INCOLLATI A MANO HANNO IL NONCE
 * (31/10/2026).
 *
 * In build Astro incollava nella pagina gli script senza import sotto i 4 kB;
 * la CSP dell'admin (`script-src 'self' 'nonce-…'`) li bloccava in silenzio.
 * In locale (`npm run dev`) non succede mai: per questo le pillole delle sale
 * funzionavano sul computer e non in produzione.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scriptMaiInline } from "../src/lib/scriptEsterni.ts";

test("la regola: gli script mai incollati, il resto come vuole Vite", () => {
  assert.equal(scriptMaiInline("assets/salle.astro_astro_type_script.js"), false);
  assert.equal(scriptMaiInline("x.mjs"), false);
  assert.equal(scriptMaiInline("logo.svg"), undefined);
  assert.equal(scriptMaiInline("font.woff2"), undefined);
});

test("astro.config.mjs la usa in vite.build.assetsInlineLimit", () => {
  const C = readFileSync("astro.config.mjs", "utf8");
  assert.match(C, /import \{ scriptMaiInline \} from "\.\/src\/lib\/scriptEsterni";/);
  assert.match(C, /vite: \{[\s\S]*?build: \{ assetsInlineLimit: scriptMaiInline \}/);
});

test("ogni <script is:inline> eseguibile dell'admin porta il nonce", () => {
  const file = [];
  const giro = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) giro(p);
      else if (p.endsWith(".astro")) file.push(p);
    }
  };
  giro("src/pages/admin");
  giro("src/components/admin");
  for (const f of file) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<script\b[^>]*\bis:inline\b[^>]*>/g)) {
      const tag = m[0];
      if (/type=["']application\/(ld\+)?json["']/.test(tag)) continue; // dati, non codice
      assert.match(tag, /nonce=\{/, `${f}: ${tag} senza nonce — la CSP dell'admin non lo esegue`);
    }
  }
});
