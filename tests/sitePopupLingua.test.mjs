/**
 * IL POP-UP DEL SITO NELLA LINGUA GIUSTA (27/10/2026).
 *
 * `SitePopup` dava per scontato il francese alla radice. Su un sito con
 * l'inglese alla radice e il francese sotto /fr/ (450 Gradi) le pagine
 * inglesi chiedevano il pop-up francese. La regola si prova con TUTTE E DUE
 * le lingue di base, passandole: lette da `ui.ts` si proverebbe solo il
 * caso del cliente su cui girano i test.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { linguaEPercorso, localizzaLink } from "../src/lib/linguaUrl.ts";

test("sito in francese (fr alla radice, en e it sotto /xx/)", () => {
  const L = ["fr", "en", "it"];
  assert.deepEqual(linguaEPercorso("/", L, "fr"), { lingua: "fr", path: "/" });
  assert.deepEqual(linguaEPercorso("/menu/", L, "fr"), { lingua: "fr", path: "/menu" });
  assert.deepEqual(linguaEPercorso("/en", L, "fr"), { lingua: "en", path: "/" });
  assert.deepEqual(linguaEPercorso("/en/menu", L, "fr"), { lingua: "en", path: "/menu" });
  assert.deepEqual(linguaEPercorso("/it/menu/", L, "fr"), { lingua: "it", path: "/menu" });
  // Una pagina che comincia come una lingua non e' una lingua.
  assert.deepEqual(linguaEPercorso("/entree", L, "fr"), { lingua: "fr", path: "/entree" });
  // Una lingua NON dichiarata non e' un prefisso.
  assert.deepEqual(linguaEPercorso("/nl/menu", L, "fr"), { lingua: "fr", path: "/nl/menu" });

  assert.equal(localizzaLink("/order", "fr", "fr"), "/order");
  assert.equal(localizzaLink("/order", "en", "fr"), "/en/order");
  assert.equal(localizzaLink("/en/order", "en", "fr"), "/en/order");
  assert.equal(localizzaLink("/entree", "en", "fr"), "/en/entree");
  assert.equal(localizzaLink("/", "it", "fr"), "/it");
});

test("sito in inglese (en alla radice, fr sotto /fr/): il caso di 450 Gradi", () => {
  const L = ["en", "fr"];
  assert.deepEqual(linguaEPercorso("/", L, "en"), { lingua: "en", path: "/" });
  assert.deepEqual(linguaEPercorso("/menu", L, "en"), { lingua: "en", path: "/menu" });
  assert.deepEqual(linguaEPercorso("/fr", L, "en"), { lingua: "fr", path: "/" });
  assert.deepEqual(linguaEPercorso("/fr/menu/", L, "en"), { lingua: "fr", path: "/menu" });
  // `/en/` su un sito inglese non e' un prefisso: la lingua di base sta alla radice.
  assert.deepEqual(linguaEPercorso("/en/menu", L, "en"), { lingua: "en", path: "/en/menu" });

  // Le pagine inglesi: nessun prefisso. Le francesi: /fr davanti.
  assert.equal(localizzaLink("/order", "en", "en"), "/order");
  assert.equal(localizzaLink("/order", "fr", "en"), "/fr/order");
  assert.equal(localizzaLink("/fr/order", "fr", "en"), "/fr/order");
});

test("i link che non sono pagine del sito non si toccano", () => {
  for (const u of ["#reserver", "https://example.com/x", "//cdn.example.com/a", "mailto:a@b.c", "tel:+32"]) {
    assert.equal(localizzaLink(u, "fr", "en"), u);
  }
});

test("SitePopup e /api/popup leggono le lingue da i18n/ui, nessuna scritta a mano", () => {
  const C = readFileSync("src/components/SitePopup.astro", "utf8");
  const fm = C.slice(0, C.indexOf("---", 3));
  assert.match(fm, /linguaEPercorso\(Astro\.url\.pathname, Object\.keys\(languages\), defaultLang\)/);
  assert.match(fm, /localizzaLink\(url, lingua, defaultLang\)/);
  assert.doesNotMatch(fm, /["'`]\/(en|it|fr)\b/, "una lingua scritta a mano nel pop-up");
  assert.doesNotMatch(fm, /lingua !== "fr"/);
  const A = readFileSync("src/pages/api/popup.ts", "utf8");
  assert.doesNotMatch(A, /=== "en" \? "en" : "fr"/);
  assert.match(A, /Object\.hasOwn\(languages, chiesta\) \? chiesta : defaultLang/);
});

test("il bottone di chiusura parla la lingua della pagina", () => {
  const C = readFileSync("src/components/SitePopup.astro", "utf8");
  assert.match(C, /const t = useTranslations\(lingua as Lang\);/);
  assert.match(C, /class="sitepop__close"[^>]*aria-label=\{t\("common\.close"\)\}/);
  assert.doesNotMatch(C, /aria-label="(Fermer|Close|Chiudi)"/, "un'etichetta scritta a mano");
  // ⚠️ La chiave sta nei dizionari DEL CLIENTE (`src/i18n/*.json`, merge=ours):
  // se un cliente non l'avesse, il lettore di schermo leggerebbe «common.close».
  for (const f of readdirSync("src/i18n").filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`src/i18n/${f}`, "utf8"));
    assert.ok(String(d["common.close"] ?? "").trim(), `common.close manca in ${f}`);
  }
});
