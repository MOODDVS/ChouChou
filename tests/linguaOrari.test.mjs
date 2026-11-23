// Emerse su Educazione Napoletana (23/11/2026).
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("gli orari parlano la lingua vera se il dizionario del cliente la dichiara", () => {
  const sp = leggi("src/components/SlotPicker.tsx");
  assert.match(sp, /import \{ useTranslations, languages, defaultLang, type Lang \} from "\.\.\/i18n\/ui";/);
  assert.match(sp, /useTranslations\(Object\.hasOwn\(languages, scelta\) \? \(scelta as Lang\) : defaultLang\)/);
  assert.doesNotMatch(sp, /lang\?: "fr" \| "en"/);
  const app = leggi("src/components/OrderApp.tsx");
  assert.doesNotMatch(app, /lang=\{lang === "en" \? "en" : "fr"\}/);
});

test("useTranslations del motore ripiega su una lingua che il dizionario non ha", () => {
  const ui = leggi("src/i18n/ui.ts");
  assert.match(ui, /const d = dictionaries\[lang\] \?\? dictionaries\[defaultLang\];/);
});

test("la sync avvisa quando il motore porta un componente che il cliente ha gia' come suo", () => {
  const sh = leggi("scripts/sync-clienti.sh");
  assert.match(sh, /git diff --name-only --diff-filter=A "\$\{base:-HEAD\}" "engine\/\$BRANCH" -- src\/components/);
  assert.match(sh, /case "\$f" in src\/components\/site\/\*\) continue ;; esac/);
});
