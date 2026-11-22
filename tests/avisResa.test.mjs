// L'email «votre avis» delle prenotazioni (22/11/2026): si spegne e si
// sceglie da quante stelle si va su Google, in Impostazioni › Réservations.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("l'email legge le due impostazioni: spenta non parte, la soglia decide Google", () => {
  const n = leggi("src/lib/notifications.ts");
  assert.match(n, /appConfigEq\("reservation_review_enabled", ambito\)/);
  assert.match(n, /if \(String\(acc\?\.value \?\? ""\)\.trim\(\) === "0"\) return null;/);
  assert.match(n, /star >= sogliaGoogle \? reviewUrl : feedbackUrl\(star\)/);
});

test("le chiavi passano dal salvataggio, sono della sede e spegnere annulla le programmate", () => {
  const api = leggi("src/pages/api/admin/settings.ts");
  assert.match(api, /"reservation_review_enabled",/);
  assert.match(api, /"reservation_review_min_stars",/);
  assert.match(api, /n < 1 \|\| n > 5\) return json\(\{ error: await msg\("err\.reviewStars"\) \}, 400\)/);
  assert.match(api, /=== "0"\) \{\n      void annullaReviewProgrammate\(ambitoPut\);/);
  const sede = leggi("src/lib/admin/sedeRegole.ts");
  assert.match(sede, /reservation_review_enabled: "sede",/);
  assert.match(sede, /reservation_review_min_stars: "sede",/);
  const pagina = leggi("src/pages/admin/settings.astro");
  assert.match(pagina, /reservation_review_enabled: rReviewOn\.checked \? "1" : "0",/);
  assert.match(pagina, /reservation_review_min_stars: String\(rSogliaGoogle\),/);
});

test("Réservations: interruttori a destra, la scelta sotto, niente doppie linee (22/11/2026)", () => {
  const pagina = leggi("src/pages/admin/settings.astro");
  // l'interruttore e' figlio diretto del campo (non piu' dentro .dyn-col)
  for (const id of ["r-autoaccept", "r-planmode", "r-autotables", "r-opts-on", "r-review-on", "r-zonechoice"]) {
    assert.match(pagina, new RegExp(`</label>\\n\\s+<label class="switch"><input type="checkbox" id="${id}"`));
  }
  assert.match(pagina, /\.field\.field--sotto > \.field-sotto \{ flex: 1 0 100%; \}/);
  assert.match(pagina, /\.section \.field\.field:has\(\+ hr\.rgroup-sep\) \{ border-bottom: 0; padding-bottom: 0; \}/);
});
