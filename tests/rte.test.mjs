/**
 * L'EDITOR DI TESTO RICCO — il markup, e che stia in un posto solo.
 *
 * ⚠️ Era dentro `agenda.astro`. Quando la newsletter ha avuto bisogno dello
 * stesso editor (13/10/2026), copiarlo avrebbe prodotto due editor che si
 * somigliano oggi e si allontanano al primo difetto corretto in uno solo dei
 * due — la strada che aveva gia' prodotto sei teste SEO diverse.
 *
 * ⚠️ Quello che NON si prova qui: i tasti. `document.execCommand` vuole una
 * selezione viva in un browser vero, e una finta non proverebbe niente. Si
 * prova il markup (che e' una stringa) e si guarda il sorgente per le due
 * regole che un difetto riaprirebbe: l'incolla ripulito e `mousedown`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { markupRte } from "../src/lib/admin/rte.ts";

const TITOLI = {
  bold: "Gras", italic: "Italique", h2: "Titre", h3: "Sous-titre",
  link: "Lien", unlink: "Retirer le lien", promptLink: "URL du lien :",
};
const MOD = readFileSync("src/lib/admin/rte.ts", "utf8");

test("i sei tasti ci sono, col loro titolo tradotto", () => {
  const html = markupRte({ titoli: TITOLI, segnaposto: "Scrivi…" });
  for (const cmd of ["bold", "italic", "h2", "h3", "link", "unlink"]) {
    assert.match(html, new RegExp(`data-cmd="${cmd}"`), `manca il tasto ${cmd}`);
  }
  assert.match(html, /title="Gras"/);
  assert.match(html, /aria-label="Retirer le lien"/, "un tasto con la sola icona non ha nome per chi legge con la voce");
  assert.match(html, /data-ph="Scrivi…"/);
  assert.match(html, /contenteditable="true"/);
});

test("⚠️ il riquadro si annuncia come un campo di testo", () => {
  // Un `contenteditable` non e' un `<input>`: una `<label for>` non lo
  // raggiunge. Senza `role` e `aria-label` si annuncia come un riquadro
  // senza nome.
  const html = markupRte({ titoli: TITOLI, segnaposto: "…", aria: "Message" });
  assert.match(html, /role="textbox"/);
  assert.match(html, /aria-multiline="true"/);
  assert.match(html, /aria-label="Message"/);
});

test("⚠️ i titoli con le virgolette non rompono il markup", () => {
  // I titoli sono tradotti: una virgoletta in una lingua chiuderebbe
  // l'attributo e il resto del tag finirebbe in pagina come testo.
  const html = markupRte({
    titoli: { ...TITOLI, bold: 'Gras "fort"' },
    segnaposto: 'Scrivi "qui" <adesso>',
  });
  assert.match(html, /title="Gras &quot;fort&quot;"/);
  assert.match(html, /data-ph="Scrivi &quot;qui&quot; &lt;adesso&gt;"/);
  assert.doesNotMatch(html, /data-ph="[^"]*"[^>]*<adesso/);
});

test("i `data-*` servono a chi monta piu' di un editor (l'agenda, uno per lingua)", () => {
  const html = markupRte({ titoli: TITOLI, segnaposto: "…", classi: "f-lx", dati: { lang: "nl" } });
  assert.match(html, /class="rte-ed f-lx"/);
  assert.match(html, /data-lang="nl"/);
});

/* ------------------------------------------------------------------ */
/* LE DUE REGOLE CHE UN DIFETTO RIAPRIREBBE.                          */
/* ------------------------------------------------------------------ */

test("⚠️ i tasti si agganciano a `mousedown`, non a `click`", () => {
  // Con `click` il riquadro perde il fuoco PRIMA dell'evento, e con lui la
  // selezione: il grassetto si applicherebbe a niente. E' il difetto che si
  // nota solo provando a usare l'editor con il mouse.
  assert.match(MOD, /addEventListener\("mousedown"/, "i tasti sono passati a `click`: la selezione si perde");
  assert.match(MOD, /e\.preventDefault\(\)/, "senza preventDefault il fuoco se ne va comunque");
});

test("⚠️ l'incolla passa dalla lista bianca", () => {
  // Un testo copiato da Word porta dentro `<span style>`, `<font>` e a volte
  // mezzo foglio di stile Microsoft. Il server ripulisce comunque, ma troppo
  // tardi: a schermo sembrava a posto e l'email usciva diversa.
  assert.match(MOD, /addEventListener\("paste"/, "l'incolla non viene piu' intercettato");
  assert.match(MOD, /pulisciHtml\(/, "l'incolla non passa piu' dalla lista bianca");
});

test("⚠️ l'Invio produce paragrafi, non `<div>`", () => {
  // `<div>` non e' nella lista bianca: il testo arriverebbe nell'email
  // tutto attaccato, senza che niente si lamenti.
  assert.match(MOD, /defaultParagraphSeparator", false, "p"/);
});

test("⚠️ nessuna pagina si riscrive l'editor in casa", () => {
  const colpevoli = [];
  for (const f of readdirSync("src/pages/admin").filter((x) => x.endsWith(".astro"))) {
    const src = readFileSync(`src/pages/admin/${f}`, "utf8");
    if (/execCommand/.test(src)) colpevoli.push(`${f}: chiama execCommand da sola`);
    if (/class="rte-b"/.test(src)) colpevoli.push(`${f}: si costruisce la barra dei tasti`);
    if (/^\s*\.rte[-\s{]/m.test(src)) colpevoli.push(`${f}: si riscrive lo stile .rte`);
  }
  assert.deepEqual(colpevoli, [], "l'editor e' tornato a vivere in due posti");
});
