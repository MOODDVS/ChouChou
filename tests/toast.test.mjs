/**
 * IL TOAST — che si veda anche quando c'e' una finestra aperta.
 *
 * ⚠️ Difetto vero, 13/10/2026. `.md-overlay` (il velo del modale) sta a
 * `z-index: 400`; il toast, che nel markup sta FUORI dal modale, stava a
 * 200. Ogni messaggio lanciato mentre una finestra era aperta veniva
 * disegnato DIETRO il velo: non «passava veloce», non si vedeva affatto.
 *
 * Si e' scoperto dal test della newsletter — il compositore e' un modale, e
 * un cliente ha concluso che il bottone fosse rotto perche' premendolo non
 * succedeva niente a schermo. Ma le pagine con i modali sono quasi tutte e
 * le chiamate sono oltre duecento: non era il difetto di quel bottone, era
 * il difetto di tutte le finestre dell'admin.
 *
 * ⚠️ E non si vedeva da nessuna prova perche' il comportamento era
 * riscritto in dieci pagine: niente da provare in un posto solo. Adesso c'e'
 * `lib/admin/toast.ts`, e queste prove guardano le due cose che contano —
 * che la regola dica «sopra» quando serve, e che nessuna pagina se la
 * riscriva in casa.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const MOD = readFileSync("src/lib/admin/toast.ts", "utf8");
const CSS = readFileSync("src/styles/toast.css", "utf8");

/* ------------------------------------------------------------------ */
/* LA REGOLA: si chiama, con un finto DOM.                            */
/* ------------------------------------------------------------------ */

/**
 * Il minimo indispensabile per far girare `mostraToast`: il modulo legge
 * `document` e `window` al momento della chiamata, quindi si mettono UNA
 * VOLTA qui e si cambia solo l'interruttore `modaleAperto`. Rattopparli a
 * ogni prova no: due prove in volo insieme se li cancellerebbero a vicenda,
 * e la prova fallirebbe per colpa dell'armatura invece che del codice.
 */
let modaleAperto = false;
globalThis.document = { querySelector: (sel) => (sel.includes("md-overlay") && modaleAperto ? {} : null) };
globalThis.window = { setTimeout: () => 1, clearTimeout: () => {} };

const { mostraToast } = await import("../src/lib/admin/toast.ts");

/** Un elemento finto che tiene conto delle sue classi. */
function elemento() {
  const classi = new Set();
  return {
    classi,
    el: {
      textContent: "",
      classList: {
        add: (c) => classi.add(c),
        remove: (c) => classi.delete(c),
        toggle: (c, si) => (si ? classi.add(c) : classi.delete(c)),
      },
    },
  };
}

test("\u26a0\ufe0f con una finestra aperta il toast va SOPRA", () => {
  const { el, classi } = elemento();
  modaleAperto = true;
  mostraToast(el, "fatto");
  assert.ok(classi.has("is-sopra"), "senza `is-sopra` il messaggio resta dietro il velo del modale");
  assert.ok(classi.has("is-on"));
  assert.ok(classi.has("is-ok"));
  assert.equal(el.textContent, "fatto");
});

test("senza finestre aperte resta in basso, dov'e' sempre stato", () => {
  const { el, classi } = elemento();
  modaleAperto = false;
  mostraToast(el, "fatto");
  assert.equal(classi.has("is-sopra"), false);
  assert.ok(classi.has("is-on"));
});

test("\u26a0\ufe0f chiusa la finestra, il toast torna in basso", () => {
  // Lo stesso elemento serve due messaggi: `is-sopra` non deve restare
  // appiccicato, o il prossimo «Enregistré» uscirebbe in cima allo schermo.
  const { el, classi } = elemento();
  modaleAperto = true;
  mostraToast(el, "dentro la finestra");
  assert.ok(classi.has("is-sopra"));
  modaleAperto = false;
  mostraToast(el, "finestra chiusa");
  assert.equal(classi.has("is-sopra"), false, "`is-sopra` resta addosso all'elemento");
});

test("l'errore e' rosso, e i due stati non convivono", () => {
  const { el, classi } = elemento();
  modaleAperto = false;
  mostraToast(el, "ahi", { errore: true });
  assert.ok(classi.has("is-error"));
  assert.equal(classi.has("is-ok"), false, "verde e rosso insieme: vince l'ultimo del foglio di stile, cioe' il caso");
  mostraToast(el, "ok adesso");
  assert.equal(classi.has("is-error"), false, "il rosso di prima resta appiccicato");
  assert.ok(classi.has("is-ok"));
});

test("un elemento che non c'e' non fa esplodere la pagina", () => {
  mostraToast(null, "niente");
});

/* ------------------------------------------------------------------ */
/* CHE NESSUNO SE LO RISCRIVA IN CASA: si legge il sorgente.          */
/* ------------------------------------------------------------------ */

const PAGINE = readdirSync("src/pages/admin")
  .filter((f) => f.endsWith(".astro"))
  .map((f) => [f, readFileSync(`src/pages/admin/${f}`, "utf8")]);

test("⚠️ nessuna pagina admin si riscrive il comportamento del toast", () => {
  // Erano dieci copie, con cinque durate diverse: ed e' per questo che il
  // difetto di sopra e' campato dieci volte senza che nessuno lo vedesse.
  // Il guscio locale `function toast(...)` resta — sono 209 chiamate — ma
  // dentro deve chiamare il modulo.
  const colpevoli = [];
  for (const [nome, src] of PAGINE) {
    for (const riga of src.split("\n")) {
      // Il segno di una copia: mette `is-on` a mano sull'elemento toast.
      if (/toast(El)?\.classList\.add\("is-on"\)/.test(riga) || /toast(El)?\.className\s*=\s*"toast/i.test(riga)) {
        colpevoli.push(`${nome}: ${riga.trim()}`);
      }
    }
  }
  assert.deepEqual(colpevoli, [], "queste pagine muovono il toast da sole: il prossimo difetto come «dietro il modale» tornera' a essere invisibile");
});

test("⚠️ `is-sopra` non si scrive piu' a mano nel markup", () => {
  // `orders.astro` era l'unica pagina che funzionava, e solo perche' se
  // l'era scritto nel markup: la soluzione giusta in un posto dove nessun
  // altro la vedeva. Adesso la decide il modulo, guardando il DOM.
  const aMano = PAGINE.filter(([, src]) => /class="toast[^"]*is-sopra/.test(src)).map(([n]) => n);
  assert.deepEqual(aMano, [], "`is-sopra` fissato nel markup: su quella pagina il toast sta in alto anche senza finestre aperte");
});

test("la regola guarda lo STATO del DOM, non una variabile da ricordarsi", () => {
  assert.match(MOD, /\.md-overlay:not\(\[hidden\]\)/, "la rilevazione del modale e' cambiata: se non guarda piu' il DOM, qualcuno dovra' ricordarsi di aggiornare uno stato");
  // Senza i commenti: nel modulo `className` e' CITATO, per spiegare
  // perche' non si usa. Una prova che non distingue le due cose fallisce
  // sulla spiegazione invece che sul codice.
  const codice = MOD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codice, /\.className\s*=/, "`className =` cancella le classi che il modulo non conosce");
  assert.match(CSS, /\.toast\.is-sopra[\s\S]*?z-index:\s*2000/, "`is-sopra` non alza piu' il toast sopra il velo del modale (400)");
});
