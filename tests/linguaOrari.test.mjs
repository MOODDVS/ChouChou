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

test("chiuso oggi ma ordinabile per i giorni seguenti: lo si dice sopra il carrello e al checkout", () => {
  const app = leggi("src/components/OrderApp.tsx");
  // si accende solo quando /api/slots?days=1 da' dei giorni (mai al tavolo)
  assert.match(app, /setClosedToday\(false\);\n\s+setSoloGiorniSeguenti\(true\);/);
  // (27/11/2026) si chiede SEMPRE, non solo quando la pagina dice «chiuso oggi»
  assert.match(app, /setClosedToday\(chiusoOggiPagina\);\n\s+setSoloGiorniSeguenti\(false\);\n\s+if \(inSala\) return;/);
  // fuori dal carrello: primo figlio di .order-app, messo sopra il carrello
  // solo quando la griglia ha due colonne e il carrello si vede
  assert.match(app, /<div className="order-app" ref=\{appMenuRef\} style=\{avvisoAccanto \? \{ gridTemplateRows: "auto 1fr" \} : undefined\}>/);
  assert.match(app, /setAvvisoAccanto\(colonne === 2 && visibile \? \{ gap: cs\.rowGap \|\| "0px" \} : null\);/);
  assert.match(app, /\{ gridColumn: "2", gridRow: "1", marginBottom: `calc\(1rem - \$\{avvisoAccanto\.gap\}\)` \}/);
  assert.doesNotMatch(app, /\{!closedToday && AvvisoGiorni\(\)\}/);
  assert.match(app, /\{AvvisoGiorni\(true\)\}\n\s+<label className="order-field-label">/);
  // testi del motore in tutte le lingue, non nel dizionario del cliente
  for (const l of ["fr", "en", "it", "nl", "es"]) assert.match(app, new RegExp(`\\n  ${l}: \\{ titolo: "`));
  const css = leggi("src/components/OrderApp.css");
  assert.match(css, /:where\(\.order-giorni-avviso\)/);
  assert.doesNotMatch(css, /grid-column: 1 \/ -1/);
});
