/**
 * I QR DELLA SALA — unico, per sezione, per tavolo, e quali si stampano (`src/lib/qrRegole.ts`,
 * `src/lib/qrSvg.ts`, Réglages > Cuisine, pagina `/table`).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  linkSezione, linkTavolo, tavoliDellaZona, sezioniConTavoli,
  sceltaQr, sceltaQrDaSalvare, cartonciniScelti, MAX_SCELTA_QR,
} from "../src/lib/qrRegole.ts";
import { qrSvg } from "../src/lib/qrSvg.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const BASE = "https://resto.be/table?sede=schaerbeek";

test("la scelta: si legge da JSON o da oggetto, e una illeggibile e' vuota", () => {
  assert.deepEqual(sceltaQr('{"sezioni":["Salle"],"tavoli":["a","b"]}'), { sezioni: ["Salle"], tavoli: ["a", "b"] });
  assert.deepEqual(sceltaQr({ sezioni: [" Salle ", "Salle", "", 3], tavoli: "a" }), { sezioni: ["Salle"], tavoli: [] });
  assert.deepEqual(sceltaQr("boh"), { sezioni: [], tavoli: [] });
  assert.deepEqual(sceltaQr(undefined), { sezioni: [], tavoli: [] });
  const tanti = Array.from({ length: MAX_SCELTA_QR + 50 }, (_, i) => `t${i}`);
  assert.equal(sceltaQr({ tavoli: tanti }).tavoli.length, MAX_SCELTA_QR);
  assert.equal(sceltaQrDaSalvare({ sezioni: ["Salle"], altro: 1 }), '{"sezioni":["Salle"],"tavoli":[]}');
});

test("i cartoncini: l'unico sempre, poi le sezioni e i tavoli scelti, solo se esistono", () => {
  const tavoli = [
    { id: "1", name: "T1", zone: "Salle" },
    { id: "2", name: "T2", zone: "Salle" },
    { id: "3", name: "E1", zone: "1er étage" },
  ];
  const scelta = { sezioni: ["1er étage", "Sparita"], tavoli: ["2", "zzz"] };
  const c = cartonciniScelti(BASE, tavoli, scelta, true);
  assert.deepEqual(c.map((x) => [x.genere, x.titolo]), [["unico", ""], ["sezione", "1er étage"], ["tavolo", "T2"]],
    "una sezione rinominata o un tavolo cancellato non fanno un cartoncino verso il niente");
  assert.equal(c[0].link, BASE);
  assert.equal(c[2].link, linkTavolo(BASE, "2"));
  assert.equal(c[2].sotto, "Salle");
  // Scelta vuota: solo l'unico.
  assert.deepEqual(cartonciniScelti(BASE, tavoli, { sezioni: [], tavoli: [] }, true).map((x) => x.genere), ["unico"]);
  // ⚠️ Senza scelta del tavolo, solo l'unico, qualunque cosa sia salvata.
  assert.deepEqual(cartonciniScelti(BASE, tavoli, scelta, false).map((x) => x.genere), ["unico"]);
});

test("i link partono da quello della sede e ci aggiungono il loro pezzo", () => {
  assert.equal(linkSezione(BASE, "1er étage"), "https://resto.be/table?sede=schaerbeek&zone=1er+%C3%A9tage");
  assert.equal(linkTavolo(BASE, "abc-123"), "https://resto.be/table?sede=schaerbeek&table=abc-123");
  // Sede unica: nessun `?` di partenza.
  assert.equal(linkTavolo("https://resto.be/table", "x"), "https://resto.be/table?table=x");
});

test("la sezione del QR filtra i tavoli; una sezione sparita non svuota la griglia", () => {
  const tavoli = [
    { id: "1", name: "T1", zone: "Salle" },
    { id: "2", name: "T2", zone: "Salle" },
    { id: "3", name: "E1", zone: "1er étage" },
  ];
  assert.deepEqual(tavoliDellaZona(tavoli, "1er étage").map((t) => t.id), ["3"]);
  assert.deepEqual(tavoliDellaZona(tavoli, "").map((t) => t.id), ["1", "2", "3"]);
  assert.deepEqual(tavoliDellaZona(tavoli, "Terrasse").map((t) => t.id), ["1", "2", "3"],
    "un cartoncino di una sezione cancellata deve far ordinare lo stesso");
  assert.deepEqual(sezioniConTavoli(tavoli), ["Salle", "1er étage"]);
});

test("il QR e' un SVG solo, bianco e nero, con un path solo", () => {
  const svg = qrSvg(linkTavolo(BASE, "febda8b7-145c-453d-a896-99da9f940f9e"));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.equal((svg.match(/<path /g) ?? []).length, 1, "un elemento per modulo farebbe migliaia di nodi in stampa");
  assert.match(svg, /shape-rendering="crispEdges"/);
});

test("la pagina del tavolo legge ?zone= e filtra con la regola", () => {
  // Il contenuto della pagina sta nel blocco del motore (`PaginaTavolo`).
  const pag = leggi("src/components/PaginaTavolo.astro");
  assert.match(pag, /tavoli=\{tavoliDellaZona\(tavoli, zonaDaUrl\)\}/);
});

test("Réglages: tre generatori, le pillole accese sono la scelta salvata, «Générer» la salva", () => {
  const api = leggi("src/pages/api/admin/settings.ts");
  // I tavoli arrivano con l'id: e' quello che si salva.
  assert.match(api, /tavoliQr\.map\(\(t\) => \(\{ id: t\.id, sezione: t\.zone, nome: t\.name, link: linkTavolo\(linkTavoloBase, t\.id\) \}\)\)/);
  assert.match(api, /qr_scelta: sceltaQr\(cfg\.get\("orders_table_qr_sel"\)\),/);
  // Il vecchio «tipo» non c'e' piu'.
  assert.doesNotMatch(nudo("src/pages/api/admin/settings.ts"), /qr_modo|orders_table_qr_mode/);
  const set = leggi("src/pages/admin/settings.astro");
  // I nomi li scrive il ristoratore: mai in innerHTML.
  assert.match(set, /t\.textContent = testo;/);
  // All'apertura, le pillole dalla scelta salvata.
  assert.match(set, /pillola\(z\.nome, z\.nome, sezSalvate\.has\(z\.nome\)\)/);
  assert.match(set, /pillola\(t\.id, t\.nome, tavSalvati\.has\(t\.id\)\)/);
  // «Générer»: prima salva (sezioni e tavoli insieme), poi apre Assets.
  const i = set.indexOf("const vaiAiQr = async");
  assert.ok(i > 0);
  const corpo = set.slice(i, set.indexOf("};", i));
  assert.match(corpo, /fetch\("\/api\/admin\/qr", \{\s*method: "PUT"/);
  assert.match(corpo, /body: JSON\.stringify\(\{ sezioni: spuntate\(boxSez\), tavoli: spuntate\(boxTav\) \}\)/);
  assert.ok(corpo.indexOf("await fetch") < corpo.indexOf('location.href = "/admin/assets?tab=qr"'), "aperta prima del salvataggio, la scheda leggerebbe la scelta vecchia");
  // ⚠️ Senza scelta del tavolo, solo il QR generico.
  assert.match(nudo("src/pages/admin/settings.astro"), /rigaTav\.style\.display = acceso && sceltaTavolo &&/);
});

test("Assets: una pagina sola, l'unico + la scelta salvata, filtrata sui tavoli veri", () => {
  const qr = nudo("src/pages/api/admin/qr.ts");
  assert.match(qr, /const scelta = sceltaQr\(cfg\.valori\.get\("orders_table_qr_sel"\)\);/);
  assert.match(qr, /cartonciniScelti\(base, tavoli, scelta, sala\.conTavoli\)/);
  assert.match(qr, /scriviConfig\(ambito, \{ orders_table_qr_sel: sceltaQrDaSalvare\(body\) \}\)/);
  assert.doesNotMatch(qr, /searchParams\.get(All)?\("(modo|sel)"\)/, "la scelta si legge salvata, non dall'indirizzo");
  assert.match(leggi("src/lib/admin/sedeRegole.ts"), /orders_table_qr_sel: "sede",/);
  const as = nudo("src/pages/admin/assets.astro");
  // Niente piu' schede «Un seul / Par section / Par table».
  assert.doesNotMatch(as, /id="qr-modi"|data-qr=/);
  assert.match(as, /\(\["unico", "sezione", "tavolo"\] as GenereQr\[\]\)/);
  assert.match(as, /<h3 class="qr-gruppo">\$\{esc\(titoli\[g\]\)\}<\/h3>/);
});

test("Assets › QR codes: si vedono, si copiano, si stampano", () => {
  const as = leggi("src/pages/admin/assets.astro");
  assert.match(as, /<button class="tab" data-t="qr">/);
  assert.match(as, /<section data-tab="qr" style="display:none">/);
  // `?tab=qr` apre direttamente la scheda.
  assert.match(as, /new URLSearchParams\(location\.search\)\.get\("tab"\)/);
  // Titoli dal ristoratore: sempre `esc`.
  assert.match(as, /<div class="card-name">\$\{esc\(c\.titolo \|\| tr\("as\.qr"\)\)\}<\/div>/);
  // La stessa scheda degli altri asset.
  assert.match(as, /<div class="card qr-card">\s*<div class="card-img qr-img">/);
  // La finestra di stampa si apre e si riempie nello stesso tocco, senza attese di rete.
  const i = as.indexOf("qrStampa.addEventListener(\"click\"");
  assert.ok(i > 0);
  const fine = as.indexOf("w.print()", i);
  assert.ok(fine > i);
  assert.doesNotMatch(as.slice(i, fine), /await /, "un'attesa prima di window.open fa bloccare la finestra");
  // Il QR su fondo bianco: su un tema scuro un QR nero non si legge.
  assert.match(as, /\.qr-img \{ aspect-ratio: 1; background: #fff;/);
  // Scarica l'SVG: un file col nome del tavolo, dal QR gia' disegnato.
  assert.match(as, /class="i-btn qr-scarica"/);
  assert.match(as, /new Blob\(\[c\.svg\], \{ type: "image\/svg\+xml" \}\)/);
  // Senza ordine dal tavolo la scheda non c'e'.
  assert.match(as, /fetch\("\/api\/admin\/qr\?stato=1"/);
  assert.match(as, /mainTabs\.querySelector\('\.tab\[data-t="qr"\]'\)\?\.remove\(\);/);
  assert.match(leggi("src/pages/api/admin/qr.ts"), /return json\(\{ attivo: \(await opzioniTavolo\(ambito\)\)\.attivo \}\);/);
  // Permessi: e' di Assets, e il super admin puo' spegnere la scheda.
  assert.match(leggi("src/lib/admin/permessiRegole.ts"), /"qr": "assets"/);
  assert.match(leggi("src/lib/admin/superAdmin.ts"), /\{ key: "qr", label: "QR codes" \}/);
});
