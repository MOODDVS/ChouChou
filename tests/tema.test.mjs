import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  rgb, luminanza, distanza, variabiliTema,
  NOMI_VARIABILI, CHIAVI_COLORE, SOGLIA_CHIARO, SOGLIA_SIMILI,
} from "../src/lib/admin/temaColori.ts";

// ⚠️ Questo file si carica SOLO perche' `temaColori.ts` non importa niente.
// Il giorno che qualcuno ci aggiunge un import che arriva a `db.ts`, vitest
// non dara' errore: dira' "0 test", cioe' verde. Il test qui sotto lo
// impedisce — e' lo stesso presidio di `ordiniRegole`.
test("temaColori non importa NIENTE (se no questo file non parte)", () => {
  const src = readFileSync("src/lib/admin/temaColori.ts", "utf8");
  const righe = src.split("\n").filter((r) => /^\s*import\s/.test(r));
  assert.deepEqual(righe, [], "temaColori.ts ha un import: il test si svuota in silenzio");
});

test("rgb legge solo #rrggbb", () => {
  assert.deepEqual(rgb("#e30613"), [227, 6, 19]);
  assert.deepEqual(rgb("#E30613"), [227, 6, 19]);
  assert.equal(rgb("#fff"), null, "le 3 cifre non sono il formato del tema");
  assert.equal(rgb("red"), null);
  assert.equal(rgb("rgb(227,6,19)"), null);
  assert.equal(rgb(""), null);
  assert.equal(rgb(null), null);
  assert.equal(rgb(undefined), null);
  assert.equal(rgb(123), null);
});

test("la luminanza pesa il verde piu' del blu", () => {
  assert.equal(luminanza("#000000"), 0);
  assert.equal(luminanza("#ffffff"), 1);
  // Un blu pieno e' SCURO: con una media semplice uscirebbe 0.33 e si
  // prenderebbe il testo nero addosso.
  assert.ok(luminanza("#0000ff") < 0.2, "il blu pieno deve risultare scuro");
  assert.ok(luminanza("#00ff00") > 0.5, "il verde pieno deve risultare chiaro");
  assert.equal(luminanza("nonvalido"), null);
});

test("header scuro -> testo bianco; header chiaro -> testo della pagina", () => {
  const scuro = Object.fromEntries(variabiliTema({ header: "#e30613", bg: "#ffffff", text: "#1c1f21", muted: "#6b7075" }));
  assert.equal(scuro["--c-htext"], "#ffffff", "su una barra rossa il testo deve schiarirsi");
  assert.match(scuro["--c-hmuted"], /^rgba\(255,255,255/);
  assert.equal(scuro["--c-bg"], "#ffffff", "il fondo pagina non viene toccato");

  const chiaro = Object.fromEntries(variabiliTema({ header: "#f7f7f7", bg: "#ffffff", text: "#1c1f21", muted: "#6b7075" }));
  assert.equal(chiaro["--c-htext"], "#1c1f21", "su una barra chiara vale il testo della pagina");
  assert.equal(chiaro["--c-hmuted"], "#6b7075");
});

test("senza header si guarda il fondo pagina", () => {
  // E' la stessa catena di ripiego dei CSS: var(--c-header, var(--c-bg)).
  const v = Object.fromEntries(variabiliTema({ bg: "#0c2a30", text: "#e9efef", muted: "#86a0a4" }));
  assert.equal(v["--c-htext"], "#ffffff");
  assert.equal(v["--c-header"], undefined, "una chiave non salvata non si inventa");
});

test("la voce attiva si schiarisce quando l'accent sparirebbe nell'header", () => {
  // Il caso BROS: header rosso, accent bordeaux. Due rossi scuri vicini.
  const bros = Object.fromEntries(variabiliTema({
    header: "#e30613", accent: "#840008", bg: "#ffffff", text: "#1c1f21", muted: "#6b7075",
  }));
  assert.equal(bros["--c-accent"], "#840008", "l'accent della pagina resta quello scelto");
  assert.equal(bros["--c-hactive"], "#ffffff", "ma la pillola dentro la barra rossa diventa bianca");
  assert.equal(bros["--c-hactive-text"], "#1c1f21", "e il testo dentro la pillola bianca torna scuro");

  // Tema RestoHub di sempre: header quasi nero, accent corallo. Si vedono
  // benissimo, quindi la pillola resta corallo e non deve cambiare niente.
  const def = Object.fromEntries(variabiliTema({
    header: "#04161b", accent: "#cb534d", bg: "#0c2a30", text: "#e9efef", muted: "#86a0a4",
  }));
  assert.equal(def["--c-hactive"], "#cb534d", "il tema di sempre non deve cambiare aspetto");
  assert.equal(def["--c-hactive-text"], "#ffffff");
});

test("il testo secondario si schiarisce sui colori saturi, non sui quasi-neri", () => {
  // ⚠️ Il contrasto non dipende dal colore ma da quanto e' scuro il fondo.
  // Su BROS il bianco al 72% diventava un rosa slavato e le voci del menu non
  // si leggevano; sul quasi-nero di sempre lo stesso 72% e' giusto, ed e' cio'
  // che distingue la voce attiva dalle altre. Se questo test cade, uno dei due
  // casi si e' rotto per sistemare l'altro.
  const bros = Object.fromEntries(variabiliTema({ header: "#e30613", bg: "#ffffff", text: "#1c1f21", muted: "#6b7075" }));
  assert.equal(bros["--c-hmuted"], "rgba(255,255,255,0.92)", "sul rosso il testo secondario deve farsi quasi bianco");

  const sempre = Object.fromEntries(variabiliTema({ header: "#04161b", bg: "#0c2a30", text: "#e9efef", muted: "#86a0a4" }));
  assert.equal(sempre["--c-hmuted"], "rgba(255,255,255,0.72)", "sul quasi-nero NON deve cambiare: i clienti di oggi stanno li'");
});

test("distanza: uguali 0, estremi 1", () => {
  assert.equal(distanza("#000000", "#000000"), 0);
  assert.equal(distanza("#000000", "#ffffff"), 1);
  assert.equal(distanza("#e30613", "nonvalido"), null);
  assert.ok(distanza("#e30613", "#840008") < SOGLIA_SIMILI, "i due rossi di BROS contano come vicini");
});

test("i valori malformati non entrano nel CSS", () => {
  const v = variabiliTema({
    accent: "rosso", hover: "#GGGGGG", bg: "#fff", header: 42, card: null, text: "#1c1f21",
  });
  const nomi = v.map(([k]) => k);
  assert.deepEqual(nomi.filter((n) => n === "--c-accent"), []);
  assert.deepEqual(nomi.filter((n) => n === "--c-hover"), []);
  assert.deepEqual(nomi.filter((n) => n === "--c-bg"), [], "le 3 cifre non bastano");
  assert.deepEqual(nomi.filter((n) => n === "--c-card"), []);
  assert.ok(nomi.includes("--c-text"), "quello buono passa");
});

test("un tema vuoto non dichiara niente", () => {
  assert.deepEqual(variabiliTema({}), []);
});

test("NOMI_VARIABILI copre tutto quello che la funzione puo' scrivere", () => {
  // Se qualcuno aggiunge una variabile e dimentica l'elenco, nel browser
  // quella resta appiccicata al <html> quando si cambia tema.
  const prodotte = new Set(variabiliTema({
    accent: "#840008", hover: "#b00510", bg: "#ffffff", header: "#e30613", card: "#ffffff",
    input: "#f6f7f8", line: "#e4e6e8", muted: "#6b7075", text: "#1c1f21",
  }).map(([k]) => k));
  for (const n of prodotte) {
    assert.ok(NOMI_VARIABILI.includes(n), `${n} non e' in NOMI_VARIABILI`);
  }
  assert.equal(CHIAVI_COLORE.length, 10, "le chiavi scelte a mano sono dieci (con l'isola dei link)");
  assert.ok(SOGLIA_CHIARO > 0 && SOGLIA_CHIARO < 1);
});

test("header e nav usano le variabili derivate, non quelle della pagina", () => {
  // ⚠️ Il difetto non si vede in un test unitario: si vede guardando una barra
  // rossa con il testo nero. Qui si verifica che i CSS chiedano la variabile
  // giusta, perche' e' l'unico posto dove la domanda viene fatta.
  const h = readFileSync("src/components/admin/AdminHeader.astro", "utf8");
  const blocco = h.split("<style")[1] ?? "";
  assert.ok(!/color:\s*var\(--c-text\)/.test(blocco), "l'header usa ancora il testo della pagina");
  assert.ok(!/color:\s*var\(--c-muted\)/.test(blocco), "l'header usa ancora il muted della pagina");
  assert.match(blocco, /var\(--c-htext,/);

  const n = readFileSync("src/components/admin/AdminNav.astro", "utf8");
  // Dal 7/11/2026 l'isola ha le sue derivate (`--c-n*`), con quelle della
  // barra come ripiego.
  assert.match(n, /background:\s*var\(--c-nactive, var\(--c-hactive,/, "la pillola attiva non passa dalle derivate");
  assert.match(n, /color:\s*var\(--c-nactive-text, var\(--c-hactive-text,/);
});

test("server e browser applicano lo stesso tema", () => {
  // cssTema (SSR) e AdminNav (client) devono passare dalla stessa funzione:
  // se uno dei due torna a scriversi le variabili per conto suo, il primo
  // paint e l'aggiornamento mostrano due temi diversi.
  const boot = readFileSync("src/lib/admin/adminBoot.ts", "utf8");
  assert.match(boot, /variabiliTema\(theme\)/, "cssTema non usa piu' variabiliTema");
  const nav = readFileSync("src/components/admin/AdminNav.astro", "utf8");
  assert.match(nav, /variabiliTema\(tema\)/, "AdminNav non usa piu' variabiliTema");
  assert.match(nav, /NOMI_VARIABILI/, "AdminNav non azzera piu' le variabili del tema vecchio");
});

test("l'isola dei link: senza colore suo segue la barra, con un colore suo ha i suoi testi", async () => {
  const { variabiliTema } = await import("../src/lib/admin/temaColori.ts");
  const mappa = (t) => Object.fromEntries(variabiliTema(t));
  // Il caso di L'Arte della Pizza: barra nera, pagina bianca, testo nero.
  const base = { accent: "#f37c21", bg: "#ffffff", header: "#000000", text: "#000000", muted: "#6b6b6b" };
  const v = mappa(base);
  assert.equal(v["--c-htext"], "#ffffff", "testo nero sulla barra nera");
  assert.equal(v["--c-ntext"], "#ffffff", "l'isola senza colore suo segue la barra");
  assert.equal(v["--c-nav"], undefined, "non si dichiara un colore che nessuno ha scelto");
  // Isola bianca sotto una barra nera: testo scuro nell'isola, bianco in alto.
  const w = mappa({ ...base, nav: "#ffffff" });
  assert.equal(w["--c-nav"], "#ffffff");
  assert.equal(w["--c-ntext"], "#000000");
  assert.equal(w["--c-htext"], "#ffffff");
  assert.equal(w["--c-nactive"], "#f37c21");
});

test("Réglages: l'anteprima calcola anche le derivate (niente nero su nero mentre si sceglie)", () => {
  const sup = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.match(sup, /for \(const \[nome, valore\] of variabiliTema\(tema\)\) root\.style\.setProperty\(nome, valore\);/);
  assert.match(sup, /for \(const nome of NOMI_VARIABILI\) root\.style\.removeProperty\(nome\);/);
  for (const f of ["src/components/admin/AdminNav.astro", "src/components/admin/PalmareNav.astro"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /background: var\(--c-nav, var\(--c-header, var\(--c-bg\)\)\)/, `${f}: l'isola non usa --c-nav`);
    assert.match(src, /var\(--c-nactive, var\(--c-hactive,/, `${f}: la pillola attiva non usa le derivate dell'isola`);
  }
});
