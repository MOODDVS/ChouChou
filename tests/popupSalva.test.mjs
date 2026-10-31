/**
 * IL POP-UP SI SALVA DAVVERO (31/10/2026).
 *
 * Modificare un pop-up esistente salvava solo l'interruttore attivo/spento:
 * l'API riconosceva «l'interruttore» dall'assenza di `title`, che il modale
 * multilingua non manda piu'. E le pagine proprie di un sito venivano scartate
 * da un elenco scritto a mano.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const API = readFileSync("src/pages/api/admin/popups.ts", "utf8");
const PANNELLO = readFileSync("src/pages/admin/marketing.astro", "utf8");

test("l'interruttore e' SOLO { id, active }: una modifica completa non ci passa", () => {
  assert.doesNotMatch(API, /body\.title === undefined/);
  assert.match(API, /Object\.keys\(body\)\.every\(\(k\) => k === "id" \|\| k === "active"\)/);
  // Il pannello: l'interruttore manda proprio quello, il modale molto di piu'.
  assert.match(PANNELLO, /JSON\.stringify\(\{ id, active: sw\.checked \}\)/);
  assert.match(PANNELLO, /title_i18n: raccogliI18n\("\.f-tx"\)/);
});

test("le pagine valide sono quelle del sito del cliente, non un elenco di fabbrica", () => {
  assert.match(API, /import \{ SITE_PAGES \} from "\.\.\/\.\.\/\.\.\/config\/sitePages";/);
  assert.match(API, /const PAGINE_VALIDE = SITE_PAGES\.length \? SITE_PAGES\.map\(\(p\) => p\.k\) : DI_FABBRICA;/);
});
