/**
 * LE SALE DEL PALMARE SU iPHONE E iPAD (28 e 31/10/2026).
 *
 * Con lo scorrimento del browser (scroll-snap) le pillole non cambiavano
 * sala su Safari, nemmeno dopo due correzioni. Dal 31/10 non scorre niente:
 * la sala visibile e' una variabile CSS e lo swipe lo legge la pagina.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const P = readFileSync("src/pages/admin/salle.astro", "utf8");
const JS = P.slice(P.indexOf("<script>"), P.lastIndexOf("</script>"));
const TESTA = readFileSync("src/components/admin/PalmareHead.astro", "utf8");

test("niente scorrimento: la sala la sposta un transform, non lo scroll", () => {
  assert.doesNotMatch(P, /scroll-snap/);
  assert.doesNotMatch(JS, /scrollTo\(|scrollIntoView|binario\.scrollLeft/);
  assert.match(P, /\.pm-binario \{[^}]*overflow: hidden; touch-action: pan-y;/);
  assert.match(P, /transform: translateX\(calc\(var\(--sala, 0\) \* -100% \+ var\(--trascina, 0px\)\)\)/);
  assert.match(JS, /binario\.style\.setProperty\("--sala", String\(i\)\)/);
});

test("le pillole cambiano sala; lo swipe e' degli eventi pointer e non apre un tavolo", () => {
  assert.match(JS, /pillole\.forEach\(\(b, i\) => b\.addEventListener\("click", \(\) => mostra\(i\)\)\)/);
  assert.match(JS, /addEventListener\("pointermove"/);
  assert.match(JS, /Math\.abs\(dx\) > 10 && Math\.abs\(dx\) > Math\.abs\(dy\)/);
  assert.match(JS, /if \(trascinato\) \{ e\.preventDefault\(\); e\.stopPropagation\(\);/);
});

test("la sala ha i muri visibili, e la sala scelta e' nel colore d'accento", () => {
  assert.match(P, /\.pm-area \{[^}]*stroke: color-mix\(in srgb, var\(--c-text\) 30%, transparent\)/);
  assert.match(TESTA, /\.pm-scelta\[aria-pressed="true"\] \{ background: var\(--c-accent\)/);
  assert.match(P, /class="pm-scelta sal-sala"/);
});

test("i filtri di Commandes sono le stesse pillole delle sale, scritte una volta", () => {
  const O = readFileSync("src/pages/admin/salle/orders.astro", "utf8");
  assert.match(O, /class="pm-scelte or-filtri"/);
  assert.match(O, /class="pm-scelta or-filtro"/);
  assert.doesNotMatch(O, /\.or-filtro\s*\{/);
  assert.doesNotMatch(P, /\.sal-sala\s*\{/);
});

test("nel palmare niente zoom: viewport, doppio tocco, due dita", () => {
  assert.match(TESTA, /maximum-scale=1, user-scalable=no/);
  assert.match(TESTA, /html \{ touch-action: manipulation;/);
  assert.match(TESTA, /addEventListener\("gesturestart", no, \{ passive: false \}\)/);
});

test("la navigazione del palmare: etichette corte (max 5 lettere, poi il punto), piu' in basso", () => {
  const I = readFileSync("src/i18n/admin.ts", "utf8");
  for (const k of ["salle", "orders", "notif", "shifts"]) {
    const riga = I.match(new RegExp(`"sal\\.navb\\.${k}": \\{([^}]*)\\}`));
    assert.ok(riga, k);
    for (const [, l, v] of riga[1].matchAll(/(\w+): "([^"]*)"/g)) assert.ok(v.replace(/\.$/, "").length <= 5, `${k}.${l} = ${v}`);
  }
  const N = readFileSync("src/components/admin/PalmareNav.astro", "utf8");
  assert.match(N, /--sal-nav-bottom: max\(8px, calc\(env\(safe-area-inset-bottom\) - 8px\)\)/);
  assert.match(N, /bottom: var\(--sal-nav-bottom\);/);
  assert.match(N, /aria-label=\{v\.nome\}/);
  assert.doesNotMatch(P, /--sal-nav-bottom:/);
});
