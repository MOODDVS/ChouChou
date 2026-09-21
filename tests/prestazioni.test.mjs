/**
 * PRESTAZIONI — cio' che PageSpeed misura davvero.
 *
 * Il motore non ha un sito: ce l'hanno i clienti. Quello che il motore puo'
 * fare e' non mettere zavorra nei mattoni che tutti usano, e queste prove
 * difendono le decisioni prese il 21/09/2026.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

function fileAstro(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileAstro(p, fuori);
    else if (v.endsWith(".astro")) fuori.push(p);
  }
  return fuori;
}
const ASTRO = fileAstro("src");
const CONFIG = readFileSync("astro.config.mjs", "utf8");
const senzaCommenti = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/<!--[\s\S]*?-->/g, " ");

test("nessuno chiede piu' i font a Google a ogni visita", () => {
  // ⚠️ Due ragioni, e la seconda non e' tecnica.
  //
  // VELOCITA': due handshake verso un terzo dominio prima che il browser
  // possa disegnare una lettera, sul percorso critico. Su mobile e' il pezzo
  // piu' grosso dell'LCP di un sito vetrina.
  //
  // PRIVACY: un foglio servito da Google porta l'IP del visitatore a Google a
  // ogni visita. In Germania un tribunale l'ha gia' giudicata una violazione
  // del GDPR, e questi siti hanno una pagina privacy che promette altro.
  const colpevoli = [];
  for (const f of [...ASTRO, ...fileTs("src")]) {
    if (/fonts\.(googleapis|gstatic)\.com/.test(senzaCommenti(readFileSync(f, "utf8")))) {
      colpevoli.push(f);
    }
  }
  assert.deepEqual(colpevoli, [], "tornano a chiedere i font a Google");
});

function fileTs(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileTs(p, fuori);
    else if (/\.(ts|tsx)$/.test(v)) fuori.push(p);
  }
  return fuori;
}

test("le famiglie si dichiarano in un posto solo, e quelle usate esistono", () => {
  // ⚠️ Prima c'erano ventitre' elenchi di famiglie e pesi scritti a mano, e
  // divergevano gia': alcune pagine chiedevano Nunito Sans 400;600;700, altre
  // 400;700, altre 400;600;700;900. Il browser scaricava insiemi diversi
  // pagina per pagina, e nessuno sapeva piu' quale fosse quello giusto.
  const dichiarate = new Set([...CONFIG.matchAll(/cssVariable: "(--font-[a-z]+)"/g)].map((m) => m[1]));
  assert.ok(dichiarate.size >= 2, "le famiglie non sono piu' dichiarate in astro.config.mjs");
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  const usate = [...F.matchAll(/cssVariable="(--font-[a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usate.length > 0, "Fonts.astro non chiede piu' nessuna famiglia");
  const orfane = usate.filter((v) => !dichiarate.has(v));
  assert.deepEqual(orfane, [], "famiglie chieste ma non dichiarate: la pagina non compila");
});

test("chi mostra i font li importa, e da un posto solo", () => {
  const rotti = [];
  for (const f of ASTRO) {
    const s = readFileSync(f, "utf8");
    const usa = /<Fonts[\s/]/.test(s);
    const imp = /import Fonts from "([^"]+)"/.exec(s);
    if (usa && !imp) rotti.push(`${f}: usa <Fonts /> senza importarlo`);
    if (!usa && imp) rotti.push(`${f}: importa Fonts e non lo usa`);
    if (usa && imp && !resolve(dirname(f), imp[1]).endsWith(join("src", "components", "Fonts.astro"))) {
      rotti.push(`${f}: importa un altro Fonts`);
    }
  }
  assert.deepEqual(rotti, []);
});

test("i font dell'admin stanno in AdminHead, non anche nelle pagine", () => {
  // ⚠️ Il codemod li aveva messi in tutte e due: `<Font>` emette il suo CSS e
  // i suoi preload ogni volta che compare, quindi tredici pagine avrebbero
  // precaricato lo stesso file due volte. Un preload doppio non e' gratis:
  // ruba banda al vero LCP, e il browser lo scrive in console.
  const doppi = [];
  for (const f of ASTRO) {
    if (f.endsWith("AdminHead.astro")) continue;
    const s = readFileSync(f, "utf8");
    if (/<AdminHead[\s/]/.test(s) && /<Fonts[\s/]/.test(s)) doppi.push(f);
  }
  assert.deepEqual(doppi, [], "pagine che caricano i font due volte");
  assert.match(readFileSync("src/components/admin/AdminHead.astro", "utf8"), /<Fonts[^>]*\/>/,
    "AdminHead ha smesso di caricare i font: tutte le pagine admin restano senza");
});

test("si precarica solo cio' che serve al primo schermo", () => {
  // Un `preload` di troppo e' banda rubata al vero LCP. La firma a mano sta
  // in un saluto, non e' il primo pixel che conta: si carica e basta.
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  assert.match(F, /cssVariable="--font-body" preload/, "il testo dev'essere precaricato");
  assert.doesNotMatch(F, /cssVariable="--font-mano"[^>]*preload/, "la firma a mano non va precaricata");
});

test("il componente Font si importa dal percorso, non da «astro:fonts»", () => {
  // ⚠️ Questa prova esiste per un errore che `astro check` NON vede: in
  // Astro 7.3 `astro:fonts` e' il nome del plugin Vite, non un modulo
  // importabile. Con `import { Font } from "astro:fonts"` i test passano,
  // `astro check` passa, e poi la BUILD fallisce con «Rolldown failed to
  // resolve import». E' esattamente il tipo di cosa che si scopre in
  // produzione se nessuno lancia `npm run build` prima di pubblicare.
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  assert.match(F, /import Font from "astro\/components\/Font\.astro"/);
  assert.doesNotMatch(F.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, " "), /from "astro:fonts"/,
    "«astro:fonts» non e' un modulo: la build fallisce");
});
