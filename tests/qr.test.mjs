/**
 * I QR DELLA SALA — unico, per sezione, per tavolo (`src/lib/qrRegole.ts`,
 * `src/lib/qrSvg.ts`, Réglages > Cuisine, pagina `/table`).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  modoQr, linkSezione, linkTavolo, tavoliDellaZona, sezioniConTavoli, MODI_QR,
} from "../src/lib/qrRegole.ts";
import { qrSvg } from "../src/lib/qrSvg.ts";

const leggi = (f) => readFileSync(f, "utf8");
const BASE = "https://resto.be/table?sede=schaerbeek";

test("il modo: tre valori, e qualunque altra cosa e' il QR unico di prima", () => {
  assert.deepEqual([...MODI_QR], ["unico", "sezione", "tavolo"]);
  assert.equal(modoQr("sezione"), "sezione");
  assert.equal(modoQr("tavolo"), "tavolo");
  assert.equal(modoQr(""), "unico");
  assert.equal(modoQr("boh"), "unico");
  assert.equal(modoQr(undefined), "unico");
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
  const pag = leggi("src/pages/table.astro");
  assert.match(pag, /tavoli=\{tavoliDellaZona\(tavoli, zonaDaUrl\)\}/);
});

test("Réglages: il tipo si salva, i link li scrive il server, «Voir» porta in Assets", () => {
  const api = leggi("src/pages/api/admin/settings.ts");
  assert.match(api, /qr_modo: modoQr\(cfg\.get\("orders_table_qr_mode"\)\)/);
  assert.match(api, /if \(body\.qr_modo !== undefined && \(MODI_QR as readonly string\[\]\)\.includes\(String\(body\.qr_modo\)\)\)/);
  const set = leggi("src/pages/admin/settings.astro");
  // I nomi li scrive il ristoratore: mai in innerHTML.
  assert.match(set, /nome\.textContent = v\.nome;/);
  assert.match(set, /<a class="kemail-add" id="o-table-qr-see" href="\/admin\/assets\?tab=qr">/);
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
  // Permessi: e' di Assets, e il super admin puo' spegnere la scheda.
  assert.match(leggi("src/lib/admin/permessiRegole.ts"), /"qr": "assets"/);
  assert.match(leggi("src/lib/admin/superAdmin.ts"), /\{ key: "qr", label: "QR codes" \}/);
});
