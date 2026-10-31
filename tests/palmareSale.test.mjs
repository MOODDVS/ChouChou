/**
 * LE PILLOLE DELLE SALE SU iPHONE E iPAD (28/10/2026).
 *
 * Su Safari lo scorrimento liscio nativo dentro un contenitore con lo scatto
 * obbligatorio non arrivava alla sala, e lo `scrollIntoView` della pillola lo
 * interrompeva. Qui si tiene fuori la ricaduta: niente scorrimento liscio
 * nativo nel binario, niente `scrollIntoView` nella pagina della mappa.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const P = readFileSync("src/pages/admin/salle.astro", "utf8");
const JS = P.slice(P.indexOf("<script>"), P.lastIndexOf("</script>"));

test("il binario non usa lo scorrimento liscio nativo, e lo scatto si spegne durante il viaggio", () => {
  assert.doesNotMatch(JS, /binario\.scrollTo\(\{[^}]*behavior:\s*(liscio|"smooth")/);
  assert.match(JS, /binario\.style\.scrollSnapType = "none";/);
  assert.match(JS, /binario\.style\.scrollSnapType = "";/);
  assert.match(JS, /requestAnimationFrame\(passo\)/);
});

test("la pillola si centra spostando solo la sua fila; nessuno scorrimento liscio nativo", () => {
  // Lo scrollIntoView liscio interrompeva lo scorrimento su Safari. Resta solo
  // la rete di sicurezza ISTANTANEA sulla sala, mai sulle pillole.
  assert.doesNotMatch(JS, /pillole\[[^\]]*\]\??\.scrollIntoView/);
  assert.doesNotMatch(JS, /scrollIntoView\(\{[^}]*behavior:\s*"smooth"/);
  assert.match(JS, /piante\[i\]\?\.scrollIntoView\(\{ inline: "start", block: "nearest", behavior: "auto" \}\)/);
  assert.match(JS, /filaSale\.scrollLeft = /);
});

test("la sala ha i muri visibili, e la sala scelta e' nel colore d'accento", () => {
  assert.match(P, /\.pm-area \{[^}]*stroke: color-mix\(in srgb, var\(--c-text\) 30%, transparent\)/);
  assert.match(P, /\.sal-sala\[aria-pressed="true"\] \{ background: var\(--c-accent\)/);
});

test("durante il viaggio lo scorrimento non cambia la pillola accesa", () => {
  assert.match(JS, /addEventListener\("scroll", \(\) => \{\s*if \(inViaggio\) return;/);
});
