/**
 * IL CONFINE DEL MOTORE (deciso 16/09/2026).
 *
 * Il motore e' l'ADMIN e le API. Non ha un sito.
 *
 * I DEMO — oggi `demo01`, domani altri — sono vetrine di dimostrazione che
 * vivono su restohub.moodd.online per far vedere un caso reale. NON sono
 * un modello da clonare e NON devono finire nell'installazione di un
 * cliente: al clone si cancellano le loro cartelle, e non deve restare
 * niente che le cerchi.
 *
 * Il cliente porta il SUO sito. Il motore deve essere pronto ad accoglierlo,
 * il che vuol dire due cose precise:
 *   - non avere un sito proprio da cui il cliente debba ripulire;
 *   - dichiarare il CONTRATTO che il sito del cliente deve rispettare.
 *
 * Queste reti difendono esattamente questo. Non provano una funzione: se
 * diventano rosse vuol dire che il motore ha ricominciato a essere anche un
 * sito, e quel confine non si perde con un errore — si perde con un file in
 * piu' alla volta, finche' nessuno sa piu' dove passa.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
// ⚠️ Perche' alcune prove di questo file si saltano nei clienti: tests/ambiente.mjs.
import { SONO_IL_MOTORE } from "./ambiente.mjs";

/** Tutti i file sotto una cartella, ricorsivamente. */
function tuttiIFile(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) tuttiIFile(p, acc);
    else acc.push(p);
  }
  return acc;
}

const CODICE = tuttiIFile("src").filter((f) => /\.(ts|tsx|astro|mjs)$/.test(f));

/** Le cartelle dei demo: si cancellano al clone, tutte insieme. */
const DEMO = [
  "src/pages/demo01",
  "src/components/demo01",
  "src/layouts/Demo01Layout.astro",
];
const dentroUnDemo = (f) => DEMO.some((d) => f === d || f.startsWith(d + "/"));

/* ============================================================
   I DEMO SI STACCANO
   ============================================================ */

test("niente, fuori dai demo, importa da un demo", () => {
  // Se un file del motore importasse da `demo01`, cancellare la cartella al
  // clone romperebbe la compilazione del cliente — e il messaggio parlerebbe
  // di un demo che quel cliente non ha mai visto.
  const colpevoli = [];
  for (const f of CODICE) {
    if (dentroUnDemo(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/^\s*import\s[^;]*?["']([^"']+)["']/gm)) {
      if (/demo01|Demo01/i.test(m[1])) colpevoli.push(`${f} -> ${m[1]}`);
    }
  }
  assert.deepEqual(colpevoli, [], `import verso un demo dal motore:\n  ${colpevoli.join("\n  ")}`);
});

test("il motore non nomina un demo in una DECISIONE", () => {
  // ⚠️ Fino al 16/09/2026 il checkout aveva scritto dentro
  // `source === "demo01" ? "/demo01" : undefined`. Un demo nominato nel
  // motore vuol dire che il secondo demo si aggiunge toccando il motore, e
  // che togliendoli per un cliente resta una stringa morta che nessuno sa
  // piu' a cosa serviva. Il prefisso lo dice la configurazione.
  //
  // Nei COMMENTI il nome va bene: e' un esempio, non una decisione.
  const senzaCommenti = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").filter((r) => !/^\s*(\/\/|\*)/.test(r)).join("\n");
  const colpevoli = [];
  for (const f of CODICE) {
    if (dentroUnDemo(f)) continue;
    if (/^src\/config\//.test(f)) continue; // file per-cliente, non motore
    const src = senzaCommenti(readFileSync(f, "utf8"));
    if (/["'`]\/?demo\d+["'`]/.test(src)) colpevoli.push(f);
  }
  assert.deepEqual(colpevoli.sort(), [], `il motore decide in base al nome di un demo: ${colpevoli.join(", ")}`);
});

/* ============================================================
   IL MOTORE NON HA UN SITO
   ============================================================ */

/**
 * Le uniche rotte pubbliche del motore, e perche' esistono.
 *
 * ⚠️ Non sono un sito: sono il CONTRATTO. L'admin, Stripe e le email
 * generano link verso queste rotte, quindi devono esistere sull'installazione
 * di ogni cliente. Aggiungerne una qui vuol dire aggiungerla a ogni cliente:
 * si fa apposta, non per abitudine.
 */
const ROTTE_DEL_MOTORE = {
  "src/pages/index.astro": "coming soon brand-aware: un'installazione senza sito non deve dare un 404",
  "src/pages/en/index.astro": "reindirizza alla coming soon",
  "src/pages/manifest.webmanifest.ts": "manifest PWA, generato dai dati del cliente",
  "src/pages/legal/privacy.astro": "testo legale generico, linkato dal widget di prenotazione",
  "src/pages/legal/terms.astro": "idem",
  "src/pages/order/cancel.astro": "l'admin manda questo link al cliente: annulla col token dell'ordine",
  "src/pages/reservation/cancel.astro": "le email di prenotazione mandano qui: annulla col token",
  "src/pages/reservation-embed.astro": "il widget di prenotazione da mettere in un iframe",
  "src/pages/reservation-test.astro": "banco di prova del widget, per chi installa",
};

test("il motore si riconosce, e un cliente non si spaccia per il motore", () => {
  // ⚠️ QUESTA NON SI SALTA MAI, ed e' la contropartita dei tre `skipIf`.
  //
  // Il marcatore e' `src/pages/demo01`. Se un giorno sparisse anche dal
  // motore, i tre `skipIf` qui sotto si accenderebbero DA SOLI e tre reti
  // del confine smetterebbero di girare senza che niente lo dica: il modo
  // peggiore di perdere una rete, perche' resta scritta.
  //
  // Il controincrocio e' `site:` in astro.config.mjs, che nel motore e'
  // ancora il segnaposto e in ogni cliente e' il suo dominio.
  const site = (readFileSync("astro.config.mjs", "utf8").match(/site:\s*"([^"]+)"/) || [])[1] || "";
  const segnaposto = /example\.com/.test(site);
  if (segnaposto) {
    assert.ok(SONO_IL_MOTORE,
      "site e' ancora il segnaposto ma demo01 non c'e' piu': tre reti del confine si stanno saltando in silenzio");
  } else {
    // E questo messaggio e' per il cliente che ha tenuto il demo: spiega in
    // una riga perche' le tre prove qui sotto gli sono diventate rosse.
    assert.ok(!SONO_IL_MOTORE,
      `questo repo ha un dominio suo (${site}) ma tiene src/pages/demo01: al clone si cancella, e finche' c'e' le reti del confine del motore girano anche qui`);
  }
});

test.skipIf(!SONO_IL_MOTORE)("fuori da admin, API e demo il motore ha solo le sue rotte dichiarate", () => {
  // ⚠️ Il 16/09/2026 qui dentro c'erano VENTUNO pagine vetrina di un cliente
  // vero — testi e fotografie comprese — tenute come «punto di partenza».
  // Nessun altro cliente le avrebbe mai usate cosi', e intanto ogni modifica
  // del motore gliele spingeva addosso. Un motore che ha un sito non e' un
  // motore: e' un sito con dentro un pannello.
  const pubbliche = tuttiIFile("src/pages")
    .filter((f) => !f.startsWith("src/pages/admin/"))
    .filter((f) => !f.startsWith("src/pages/api/"))
    .filter((f) => !/^src\/pages\/demo\d+\//.test(f));
  const nonDichiarate = pubbliche.filter((f) => !ROTTE_DEL_MOTORE[f]);
  assert.deepEqual(
    nonDichiarate.sort(),
    [],
    `rotte pubbliche non dichiarate (il motore sta ridiventando un sito):\n  ${nonDichiarate.join("\n  ")}`,
  );

  const morte = Object.keys(ROTTE_DEL_MOTORE).filter((f) => !pubbliche.includes(f));
  assert.deepEqual(morte.sort(), [], `dichiarate ma non esistono piu': ${morte.join(", ")}`);
});

test.skipIf(!SONO_IL_MOTORE)("nessuna pagina del motore passa da un layout di sito", () => {
  // `layouts/Layout.astro` era il guscio del sito vetrina: intestazione,
  // menu di navigazione, piede. Se ricompare, e' ricomparso un sito.
  const conLayout = CODICE.filter((f) => !dentroUnDemo(f))
    .filter((f) => /layouts\/Layout(\.astro)?["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(conLayout.sort(), []);
});

/* ============================================================
   IL PREFISSO DEL SITO SI LEGGE IN UN POSTO SOLO
   ============================================================ */

test("dove vive il sito pubblico lo dice un file solo", () => {
  // Erano tre letture della stessa chiave — admin, email, checkout — e due
  // erano gia' divergenti: una rendeva `undefined`, l'altra `""`.
  // ⚠️ `sedeRegole.ts` NOMINA la chiave per classificarla (marchio o sede),
  // e nominarla non e' leggerla: e' un file puro, senza database.
  const letture = CODICE.filter((f) => f !== "src/lib/basePubblica.ts" && f !== "src/lib/admin/sedeRegole.ts")
    .filter((f) => /public_site_base/.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    letture.sort(),
    [],
    `leggono public_site_base fuori da lib/basePubblica.ts: ${letture.join(", ")}`,
  );
});

// ============================================================
// UN INTERRUTTORE SOLO (17/09/2026)
//
// `styles/switch.css` e' il componente, importato da AdminHead su ogni pagina
// admin. Una pagina che se ne riscrive uno nel proprio <style> VINCE nella
// cascata — arriva dopo — e quindi resta indietro in silenzio: la correzione
// fatta nel file comune non la raggiunge, e nessuno se ne accorge finche' un
// cliente con un tema diverso non vede lo spento sbiadito.
//
// E' successo davvero: google.astro aveva una copia vecchia che dipingeva lo
// spento con --c-line, un token di BORDO, e su un tema con i bordi chiari
// diventava una pastiglia pallida. settings e super avevano lo stesso vizio.
//
// La misura si dice con le variabili (--sw-w / --sw-h / --sw-k), che non sono
// una ridefinizione: sono il modo previsto per cambiare taglia.
// ============================================================
test("nessuna pagina admin si riscrive l'interruttore in casa", () => {
  const cartella = "src/pages/admin";
  const colpevoli = [];
  for (const f of readdirSync(cartella).filter((x) => x.endsWith(".astro"))) {
    const src = readFileSync(`${cartella}/${f}`, "utf8");
    // Si guarda solo il CSS: `.switch` nel markup e nel JS e' l'uso, non la
    // ridefinizione. Il segno di una copia locale e' ridisegnare la pista.
    if (/\.switch\s+(?:input\s*\+\s*)?\.track\s*(?:::before\s*)?\{/.test(src)) colpevoli.push(f);
  }
  assert.deepEqual(
    colpevoli,
    [],
    "queste pagine ridisegnano `.switch .track` nel loro <style>: vincono su styles/switch.css e non riceveranno le correzioni fatte li'. Per cambiare misura si usano --sw-w / --sw-h / --sw-k.",
  );
});

// ============================================================
// UN TOAST SOLO (17/09/2026)
//
// Stessa storia dell'interruttore, con una conseguenza peggiore: c'erano nove
// copie e TRE aspetti diversi, e in alcune pagine la differenza fra «salvato»
// e «non salvato» era il colore del BORDO — un filo di un pixel, in basso,
// per due secondi. Chi salvava non si accorgeva che il salvataggio era
// fallito. Adesso: fondo verde se riuscito, fondo rosso se fallito, testo
// bianco, ovunque.
//
// Due vocabolari (`show`/`err` e `is-visible`/`is-error`) sono diventati uno:
// `is-on`, `is-ok`, `is-error`, piu' `is-sopra` per il rimborso, che deve
// stare sopra il modale aperto.
// ============================================================
test("nessuna pagina admin si riscrive il toast in casa", () => {
  const cartella = "src/pages/admin";
  const colpevoli = [];
  for (const f of readdirSync(cartella).filter((x) => x.endsWith(".astro"))) {
    const src = readFileSync(`${cartella}/${f}`, "utf8");
    if (/^\s*\.[a-z-]*toast[^{]*\{/mi.test(src)) colpevoli.push(f);
  }
  assert.deepEqual(
    colpevoli,
    [],
    "queste pagine ridefiniscono il toast nel loro <style>: vincono su styles/toast.css, e la differenza fra riuscito e fallito torna a dipendere dalla pagina",
  );
});

test("il toast usa un vocabolario solo", () => {
  const cartella = "src/pages/admin";
  const AMMESSE = new Set(["toast", "is-on", "is-ok", "is-error", "is-sopra"]);
  const sbagliate = [];
  for (const f of readdirSync(cartella).filter((x) => x.endsWith(".astro"))) {
    for (const riga of readFileSync(`${cartella}/${f}`, "utf8").split("\n")) {
      if (!/toast/i.test(riga)) continue;
      if (!/className\s*=\s*"toast|classList\.(add|remove|toggle)\(/.test(riga)) continue;
      for (const m of riga.matchAll(/"([a-z][a-z0-9-]*)"/g)) {
        const c = m[1];
        if (c === "toast" || AMMESSE.has(c)) continue;
        // parole che non sono classi (chiavi i18n, id, messaggi) hanno il punto
        if (c.includes(".") || c.includes(" ")) continue;
        if (/^(ok|err|show|is-visible|hidden|active)$/.test(c)) sbagliate.push(`${f}: "${c}"`);
      }
    }
  }
  assert.deepEqual(sbagliate, [], "classi del vecchio vocabolario ancora in uso sul toast");
});
