/**
 * SEO TECNICO — cio' che il motore consegna ai motori di ricerca.
 *
 * ⚠️ Difetto vero, trovato il 21/09/2026: la sitemap conteneva 15 URL
 * `/admin/` su 29. Ogni cliente stava dicendo a Google «indicizza il mio
 * pannello», e quegli URL rispondono 302 al login. Nessun errore da nessuna
 * parte: una sitemap sbagliata e' un file valido.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { inSitemap, FUORI_SITEMAP } from "../src/lib/seo/sitemapRegole.ts";

const CONFIG = readFileSync("astro.config.mjs", "utf8");
const ROBOTS = readFileSync("public/robots.txt", "utf8");

// Dal FILESYSTEM, non da un elenco scritto a mano: una pagina admin aggiunta
// domani e' coperta da sola, senza che nessuno si ricordi di questo file.
const PAGINE_ADMIN = readdirSync("src/pages/admin")
  .filter((f) => f.endsWith(".astro"))
  .map((f) => (f === "index.astro" ? "/admin/" : `/admin/${f.replace(/\.astro$/, "")}/`));

test("le pagine del pannello esistono davvero (la prova sotto non passa a vuoto)", () => {
  assert.ok(PAGINE_ADMIN.length >= 10, `lette solo ${PAGINE_ADMIN.length} pagine admin`);
});

test("nessuna pagina del pannello finisce in sitemap", () => {
  const dentro = PAGINE_ADMIN.filter((p) => inSitemap(`https://www.esempio.be${p}`));
  assert.deepEqual(dentro, [], "il pannello non e' un sito: 302 al login, e non va in ricerca");
});

test("le pagine pubbliche ci restano", () => {
  // Il filtro deve escludere il pannello, non svuotare la sitemap: e' l'errore
  // gemello, e sarebbe molto piu' grave.
  for (const p of ["/", "/en/", "/legal/privacy/", "/legal/terms/", "/menu/", "/contact/"]) {
    assert.ok(inSitemap(`https://www.esempio.be${p}`), `${p} e' sparito dalla sitemap`);
  }
});

test("il filtro capisce URL interi e path, con e senza barra finale", () => {
  assert.equal(inSitemap("https://www.esempio.be/admin"), false);
  assert.equal(inSitemap("/admin"), false);
  assert.equal(inSitemap("/admin/"), false);
  assert.equal(inSitemap("/admin/orders/"), false);
  // ⚠️ Confine: un prefisso non e' un pezzo di parola. `/administration` e
  // `/orders` sono pagine pubbliche legittime e devono passare.
  assert.equal(inSitemap("/administration/"), true);
  assert.equal(inSitemap("/order/"), true);
  assert.equal(inSitemap("/reservation/"), true);
});

test("la regola e' agganciata: astro.config usa il filtro", () => {
  // Un modulo di regole che nessuno chiama e' peggio di niente: sembra che il
  // problema sia risolto.
  assert.match(CONFIG, /import \{ inSitemap \} from "\.\/src\/lib\/seo\/sitemapRegole"/);
  assert.match(CONFIG, /sitemap\(\{\s*filter: inSitemap\s*\}\)/,
    "sitemap() e' tornata nuda: rimette il pannello in sitemap");
});

test("robots.txt chiude il pannello, e non chiude il ristorante", () => {
  // Le due cose vanno insieme: la sitemap dice cosa indicizzare, robots dice
  // cosa non visitare. Con una sola delle due Google arriva lo stesso.
  // ⚠️ Niente `/demo01`: il cliente che lo cancella cancella anche la sua riga
  // in robots.txt, e questa prova gira ANCHE nei repo dei clienti. Un'eccezione
  // morta che li tiene rossi e' gia' successa due volte.
  for (const v of ["/admin", "/reservation-embed", "/reservation-test"]) {
    assert.match(ROBOTS, new RegExp(`^Disallow: ${v}\\b`, "m"),
      `robots.txt non esclude ${v}, che la sitemap tiene gia' fuori`);
  }
  // ⚠️ L'errore gemello, e sarebbe peggio del guasto che stiamo chiudendo:
  // `/order/cancel` e `/reservation/cancel` stanno fuori dalla sitemap, ma
  // `Disallow: /order` spegnerebbe la pagina d'ordine del ristorante e
  // `Disallow: /reservation` quella delle prenotazioni. Un prefisso in
  // robots.txt non ha confini di parola: taglia tutto quello che inizia cosi'.
  for (const v of ["/order", "/reservation", "/menu", "/contact"]) {
    assert.doesNotMatch(ROBOTS, new RegExp(`^Disallow: ${v}\\s*$`, "m"),
      `robots.txt blocca ${v}: e' una pagina pubblica del ristorante`);
  }
  assert.match(ROBOTS, /^Sitemap: /m, "robots.txt non indica piu' dove sta la sitemap");
});
