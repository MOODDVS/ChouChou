/**
 * NIENTE TESTO BIANCO FISSO NELL'ADMIN (18/11/2026, Enzo).
 *
 * L'admin ha un tema per cliente, e ce ne sono di CHIARI (Mare e Monti: card
 * quasi bianca). Un `color: #fff` scritto per il fondo scuro li' sparisce: il
 * logo Stripe sulla card ordine e il numero delle varianti nel menu non si
 * vedevano piu'. Il testo prende `var(--c-text)` / `var(--c-muted)` /
 * `var(--c-bg)` (su un fondo accento), o un colore che si legge su tutti e due.
 *
 * Il controllo guarda le regole CSS su una riga: se mettono un colore chiaro
 * fisso SENZA un fondo nella stessa regola, il fondo e' quello del tema → errore.
 * Le pagine di login stanno sopra una foto: li' il bianco e' giusto.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOPRA_FOTO = new Set(["src/pages/admin/login.astro", "src/pages/admin/reset-password.astro"]);

function file(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? file(p) : /\.(astro|css)$/.test(n) ? [p] : [];
  });
}

const CHIARO = /(?<![-\w])color:\s*(#fff\b|#ffffff\b|white\b|rgba\(\s*255,\s*255,\s*255)/i;

test("nessun testo bianco fisso sul fondo del tema", () => {
  const colpe = [];
  for (const f of [...file("src/pages/admin"), ...file("src/components/admin")]) {
    if (SOPRA_FOTO.has(f.replaceAll("\\", "/"))) continue;
    readFileSync(f, "utf8").split("\n").forEach((riga, i) => {
      for (const m of riga.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const corpo = m[2];
        if (CHIARO.test(corpo) && !/background|fill:/.test(corpo)) colpe.push(`${f}:${i + 1} ${m[1].trim()}`);
      }
    });
  }
  assert.deepEqual(colpe, [], "testo bianco senza fondo: usare var(--c-text) o simili");
});
