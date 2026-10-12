/**
 * L'INDIRIZZO A PEZZI — e da dove devono arrivare i pezzi.
 *
 * ⚠️ Difetto vero, 12/10/2026: la scheda `Restaurant` del sito leggeva via,
 * codice postale e comune da `config/client.ts`, cioe' da una costante
 * decisa quando si compila. Le stesse tre cose stanno in `app_config`
 * (`company_street`, `company_zip`, `company_city`), le legge
 * `datiRistorante()`, e il ristoratore le cambia da Réglages → Général.
 *
 * Due verita' per lo stesso dato: il giorno che il locale si sposta, le
 * email di conferma dicono il nuovo indirizzo e Google continua a leggere il
 * vecchio — fino al prossimo deploy, cioe' fino a quando se ne accorge
 * qualcuno. E dei due, quello sbagliato e' il piu' visibile: la scheda e'
 * quella che finisce nel pannello di destra della ricerca e nelle mappe.
 *
 * ⚠️ E vale doppio verso l'app sola per tutti i clienti: una costante per
 * cliente, in un processo che ne serve cinquanta, non e' piu' nemmeno
 * possibile. Chi siamo lo dice la richiesta, non il modulo importato.
 *
 * ⚠️ Si legge il SORGENTE: `ristorante.ts` apre il DB quando lo si importa,
 * e quello che qui conta e' da DOVE prende i pezzi — e lo dice il file.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync("src/lib/ristorante.ts", "utf8");

test("`DatiRistorante` espone i pezzi, non solo la riga unica", () => {
  for (const campo of ["via", "cap", "citta"]) {
    assert.match(
      SRC,
      new RegExp(`\\n\\s*${campo}: string;`),
      `\`DatiRistorante\` non espone piu' \`${campo}\`: la scheda torna a leggere una costante`,
    );
  }
});

test("i pezzi arrivano da Général, e restituiti separati", () => {
  for (const chiave of ["company_street", "company_zip", "company_city"]) {
    assert.match(SRC, new RegExp(chiave), `${chiave} non viene piu' chiesto a leggiConfig`);
  }
  // ⚠️ Il punto non e' che le chiavi siano LETTE — lo erano anche prima, per
  // comporre la riga unica — e' che escano ANCHE a pezzi.
  assert.match(SRC, /\n\s*via,\n/, "`via` non esce piu' dalla funzione");
  assert.match(SRC, /\n\s*cap: cp,\n/, "`cap` non esce piu' dalla funzione");
  assert.match(SRC, /\n\s*citta,\n/, "`citta` non esce piu' dalla funzione");
});

test("⚠️ il ripiego lascia i pezzi VUOTI", () => {
  // `CLIENT.indirizzo` e' una riga sola scritta per un essere umano in fondo
  // a un'email. Spezzarla per riempire i pezzi vorrebbe dire indovinare: un
  // civico puo' essere «7/9», codice postale e comune stanno attaccati, e
  // «bus 3» finisce dove non deve. Un `addressLocality` sbagliato dice a
  // Google che il ristorante e' in un altro comune: peggio di non dirglielo.
  const ripiego = SRC.slice(SRC.indexOf("const fallback"), SRC.indexOf("const chiaveCache"));
  assert.ok(ripiego.length > 0, "il ripiego non c'e' piu': questa prova passerebbe a vuoto");
  for (const campo of ["via", "cap", "citta"]) {
    assert.match(
      ripiego,
      new RegExp(`${campo}: ""`),
      `il ripiego inventa un valore per \`${campo}\` invece di lasciarlo vuoto`,
    );
  }
});

function fileSorgente(dir = "src", out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) fileSorgente(p, out);
    else if (/\.(ts|tsx|astro)$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * SOLO I FILE DEL MOTORE — l'elenco e' quello di `.gitattributes`.
 *
 * ⚠️ Questa prova viaggia nei sette repo cliente insieme al motore, e un
 * file `merge=ours` e' loro: il sito pubblico, il telaio, le traduzioni, il
 * config. Sgridare un cliente per come disegna la propria pagina vorrebbe
 * dire una prova rossa in casa sua per una scelta che e' sua — e una prova
 * rossa che non si puo' far passare si impara a ignorare.
 *
 * ⚠️ Oggi (12/10/2026) due pagine di clienti spezzano ancora la riga per
 * andare a capo: `BROS/src/layouts/Sito.astro` e
 * `EducazioneNapoletana/src/components/Footer.astro`. Sta scritto qui per
 * non riscoprirlo: si sistemano quando si tocca quel cliente, prendendo
 * `via`, `cap` e `citta` da `datiRistorante`.
 */
const delMotore = (f) =>
  !f.startsWith("src/components/site/") &&
  !f.startsWith("src/layouts/") &&
  !f.startsWith("src/i18n/") &&
  !/^src\/config\/(client|siteImageSlots|sitePages|ticket)\.ts$/.test(f) &&
  (!f.startsWith("src/pages/") || /^src\/pages\/(admin|api)\//.test(f));

test("nel motore nessuno ricostruisce i pezzi spezzando la riga unica", () => {
  const colpe = [];
  for (const f of fileSorgente().filter(delMotore)) {
    const testo = readFileSync(f, "utf8");
    for (const riga of testo.split("\n")) {
      // Una riga che nomina l'indirizzo e lo spezza: `indirizzo.split(",")`,
      // `dati.indirizzo.split(" ")`, e cosi' via.
      if (/indirizzo[A-Za-z]*\s*\.\s*split\s*\(/.test(riga)) colpe.push(`${f}: ${riga.trim()}`);
    }
  }
  assert.deepEqual(colpe, [], "i pezzi dell'indirizzo si chiedono a `datiRistorante`, non si indovinano spezzando la riga");
});
