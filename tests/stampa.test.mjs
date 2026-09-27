/**
 * LE PAGINE DI STAMPA — come il catalogo Print trova i PDF del cliente.
 *
 * ⚠️ Il problema che queste prove tengono chiuso: il catalogo e' del motore
 * (cosa MOODD vende, a che prezzo) e le PAGINE che generano i PDF sono di ogni
 * cliente. Finche' il legame si scriveva a mano, ogni prodotto nuovo costava
 * una riga in `PRINT_DEFAULTS` e una chiave di traduzione: codice del motore
 * per un dato di un cliente solo. Adesso il motore SCOPRE le pagine, e il nome
 * lo scrive il super admin. Queste prove esistono perche' resti cosi'.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { derivaPagine, confrontaCatalogo } from "../src/lib/admin/printRegole.ts";
import { PRINT_DEFAULTS, validaCatalogo } from "../src/config/printCatalog.ts";

test("dal nome del file esce la rotta, in ordine", () => {
  assert.deepEqual(
    derivaPagine(["/src/pages/print/menu.astro", "/src/pages/print/lunch.astro"]),
    [
      { slug: "lunch", route: "/print/lunch" },
      { slug: "menu", route: "/print/menu" },
    ],
  );
});

test("le rotte dinamiche restano fuori", () => {
  // ⚠️ `[slug].astro` non e' un URL: senza un parametro non esiste una pagina
  // da anteprimare, e l'iframe del pannello mostrerebbe un 404 al ristoratore.
  assert.deepEqual(derivaPagine(["/src/pages/print/[tipo].astro"]), []);
});

test("solo le pagine di stampa, e solo al primo livello", () => {
  assert.deepEqual(
    derivaPagine([
      "/src/pages/menu.astro",
      "/src/pages/print/sotto/x.astro",
      "/src/pages/print/lunch.ts",
      "/src/pages/print/lunch.astro",
    ]),
    [{ slug: "lunch", route: "/print/lunch" }],
  );
});

test("il confronto guarda la ROTTA, non lo slug", () => {
  // ⚠️ Nel seed il prodotto `business-cards` punta a `/print/businesscard`:
  // slug del prodotto e nome del file NON coincidono, e non devono essere
  // costretti a coincidere. Confrontando gli slug, quel prodotto risulterebbe
  // sempre «pagina assente» e la pagina sempre «da aggiungere».
  const catalogo = [{ slug: "business-cards", route: "/print/businesscard" }];
  const pagine = [{ slug: "businesscard", route: "/print/businesscard" }];
  assert.deepEqual(confrontaCatalogo(catalogo, pagine), { nuove: [], senzaPagina: [] });
});

test("una pagina nuova si vede, e un prodotto senza pagina anche", () => {
  const catalogo = [
    { slug: "menu", route: "/print/menu" },
    { slug: "vecchio", route: "/print/vecchio" },
  ];
  const pagine = [
    { slug: "lunch", route: "/print/lunch" },
    { slug: "menu", route: "/print/menu" },
  ];
  const c = confrontaCatalogo(catalogo, pagine);
  assert.deepEqual(c.nuove, [{ slug: "lunch", route: "/print/lunch" }]);
  assert.deepEqual(c.senzaPagina, ["vecchio"]);
});

test("un prodotto senza rotta non e' un prodotto con la pagina rotta", () => {
  // Rotta vuota = prodotto definito ma non ancora legato a una pagina: il
  // pannello del cliente lo dice gia' con «Page bientot disponible». Metterlo
  // fra i guasti sarebbe un allarme per una cosa normale.
  const c = confrontaCatalogo([{ slug: "futuro", route: "" }], []);
  assert.deepEqual(c.senzaPagina, []);
});

test("printRegole resta senza dipendenze", () => {
  // ⚠️ Le regole servono ANCHE nel browser, dentro la scheda Print del super.
  // `printRoutes.ts` non si puo' importare li': contiene `import.meta.glob`, e
  // trascinerebbe le pagine del sito dentro il pacchetto del browser.
  const r = readFileSync("src/lib/admin/printRegole.ts", "utf8");
  const imports = [...r.matchAll(/^import .*/gm)].map((m) => m[0]).filter((l) => !l.startsWith("import type"));
  assert.deepEqual(imports, [], "printRegole.ts non deve importare niente");
  const g = readFileSync("src/lib/admin/printRoutes.ts", "utf8");
  assert.match(g, /import\.meta\.glob\("\/src\/pages\/print\/\*\.astro"/,
    "la scoperta non legge piu' il filesystem: il pannello non trovera' niente");
  // ⚠️ E deve chiederli COME TESTO. `import.meta.glob` non rende solo i nomi:
  // aggancia quei moduli al grafo delle dipendenze, e Astro raccoglie il CSS
  // delle dipendenze di una pagina. Senza `?raw`, il foglio `is:global` di una
  // pagina di stampa finisce addosso a /admin/print: su L'Huile sur le Feu il
  // pannello si e' ritrovato il fondo grigio e l'header staccato di 24px,
  // perche' quel foglio stila `body` per l'anteprima del PDF. Nessun errore da
  // nessuna parte, solo una pagina che non somigliava piu' alle altre.
  assert.match(g, /query:\s*"\?raw"/,
    "senza ?raw il glob trascina il CSS delle pagine di stampa dentro il pannello");
});

test("il seed punta a pagine di stampa, non altrove", () => {
  const fuori = PRINT_DEFAULTS.filter((p) => p.route && !p.route.startsWith("/print/"));
  assert.deepEqual(fuori, [], "un prodotto del seed punta fuori da /print/");
});

test("un prodotto si puo' TOGLIERE dal listino, non solo aggiungere", () => {
  // ⚠️ L'asimmetria era il buco: si poteva mettere un prodotto a catalogo e
  // non levarlo piu'. E «Reinitialiser» non e' la via d'uscita, perche' riporta
  // anche i prezzi consigliati su tutti gli altri prodotti. Senza questo
  // bottone, un prodotto che punta a una pagina che il cliente non ha resta
  // nel suo listino per sempre.
  const S = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.match(S, /class="pr-del pr-delprod"/, "il bottone per togliere un prodotto e' sparito");
  assert.match(S, /classList\.contains\("pr-delprod"\)/, "il bottone non e' agganciato a niente");
  assert.match(S, /catalogo\.splice/, "niente toglie davvero il prodotto dal listino");
});

test("senza quantita' il prodotto si offre lo stesso: PDF si', ordine no", () => {
  // ⚠️ Prima un prodotto visibile senza fasce era un ERRORE, e l'unico modo di
  // dare un PDF senza venderlo era nasconderlo — cioe' non darlo. Adesso e' una
  // scelta: il ristoratore vede anteprima e bottone PDF, e «Commander» non
  // compare affatto.
  const r = validaCatalogo([{ slug: "lunch", label: "Le Lunch", route: "/print/lunch", visible: true, meta: {}, tiers: [] }]);
  assert.equal(r.error, undefined, "un prodotto senza prezzo viene ancora rifiutato");
  assert.equal(r.catalog?.[0].visible, true);
  assert.deepEqual(r.catalog?.[0].tiers, []);

  // Il bottone d'ordine non si disegna senza fasce...
  assert.match(readFileSync("src/pages/admin/print.astro", "utf8"),
    /p\.tiers\.length > 0 && \(\s*<button[^>]*class="pbtn pbtn-buy"/,
    "il bottone Commander e' tornato incondizionato");

  // ...e se qualcuno chiama l'API a mano, il server non vende a zero: cerca la
  // fascia chiesta fra quelle del prodotto, e senza fasce non ne trova nessuna.
  const O = readFileSync("src/pages/api/admin/print-order.ts", "utf8");
  assert.match(O, /prodotto\.tiers\.find\(\(t\) => t\.qty === qty\)/);
  assert.match(O, /if \(!tier\) return json\(\{ error: await msg\("err\.qtyGone"\) \}, 400\)/,
    "senza fascia trovata l'ordine non si ferma piu'");
});

test("il nome del prodotto NON torna nel codice", () => {
  // ⚠️ E' questa la prova che tiene in piedi l'automazione. Se qualcuno rimette
  // una chiave `print.prod.<slug>`, aggiungere un prodotto torna a costare una
  // riga nel motore per ogni cliente, ed e' esattamente il lavoro che questo
  // giro ha tolto di mezzo. Il nome e' un campo libero, scritto dal super admin
  // nella lingua di QUEL pannello.
  for (const f of ["src/i18n/admin.ts", "src/pages/admin/super.astro", "src/pages/admin/print.astro"]) {
    assert.doesNotMatch(readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, " "), /print\.prod\./,
      `${f}: il nome del prodotto e' tornato una chiave di traduzione`);
  }
  assert.match(readFileSync("src/pages/admin/super.astro", "utf8"), /class="pr-name-in"/,
    "il campo del nome e' sparito dalla scheda: il super admin non puo' piu' rinominare");
});
