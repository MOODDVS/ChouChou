/**
 * LA VALUTA — e la porta che tiene chiusa.
 *
 * ⚠️ Il difetto che queste prove impediscono non e' un'icona brutta: e' una
 * card che MENTE SUI SOLDI. Il giorno in cui qualcuno collega `valutaDi()` a
 * una schermata senza aver prima sistemato `soldi.ts` e `stripe.ts`, un
 * ristorante fuori dall'euro vedrebbe il simbolo del dollaro accanto a un
 * totale scritto in euro, su un incasso fatto in euro.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { valutaDi, valutaDelMotore, misuraDi, iconaValuta, ALTEZZA_SIMBOLO } from "../src/lib/valuta.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("la valuta la decide il PAESE, non il continente", () => {
  assert.equal(valutaDi("BE"), "EUR");
  assert.equal(valutaDi("fr"), "EUR", "il codice paese minuscolo non deve cambiare la risposta");
  // ⚠️ Il cuore della prova: sono tutti e tre in Europa e non pagano in euro.
  assert.equal(valutaDi("CH"), "CHF", "la Svizzera e' in Europa e paga in franchi");
  assert.equal(valutaDi("GB"), "GBP", "il Regno Unito e' in Europa e paga in sterline");
  assert.equal(valutaDi("US"), "USD");
  // Paese sconosciuto, vuoto o assente: l'euro, che e' dove gira il motore.
  assert.equal(valutaDi("ZZ"), "EUR");
  assert.equal(valutaDi(undefined), "EUR");
});

test("la valuta la dice il paese, e nessuno se la riscrive a mano", () => {
  // ⚠️ IL 15/10/2026 LA CATENA E' STATA COLLEGATA. Prima questa prova teneva
  // chiusa la porta: `valutaDi` non doveva arrivare a nessuna schermata
  // finche' gli importi e Stripe avevano l'euro scritto dentro. Adesso
  // guarda il contrario — che quel pezzo di euro non sia tornato a mano in
  // nessuno dei tre posti, perche' basta UNO perche' la card menta sui soldi.
  const soldi = nudo("src/lib/soldi.ts");
  assert.doesNotMatch(soldi, /currency:\s*"[A-Z]{3}"/,
    "soldi.ts ha di nuovo una valuta scritta a mano: l'importo e il simbolo direbbero due monete diverse");
  assert.match(soldi, /valutaDelMotore/, "soldi.ts non chiede piu' la valuta al motore");

  const stripe = nudo("src/lib/stripe.ts");
  assert.doesNotMatch(stripe, /currency:\s*"[a-z]{3}"/,
    "stripe.ts ha di nuovo una valuta scritta a mano: un incasso partirebbe nella moneta sbagliata");
  // Quattro punti incassano: checkout, buono regalo, supplemento, riga.
  assert.ok((stripe.match(/valutaStripe\(\)/g) ?? []).length >= 4,
    "qualche punto di stripe.ts non chiede piu' la valuta: e' li' che l'incasso parte storto");

  // ⚠️ E la risposta viene dal PAESE, non da una costante: una costante
  // ricomparirebbe identica anche su un cliente svizzero.
  const valuta = nudo("src/lib/valuta.ts");
  assert.match(valuta, /valutaDi\(CLIENT\.paese\)/,
    "valutaDelMotore non legge piu' il paese del cliente");

  // Oggi tutti i clienti sono in Belgio, quindi la risposta e' EUR: se un
  // giorno questa riga diventasse rossa, vorrebbe dire che un'installazione
  // ha cambiato paese — ed e' il momento di rileggere le due cose da fare
  // scritte in valuta.ts (conto Stripe, colonna currency sugli ordini).
  assert.equal(valutaDelMotore(), "EUR");
});

test("ogni simbolo porta la SUA misura, se no il dollaro viene piu' alto", () => {
  // Il `$` scende sotto la linea di base, l'`€` no: a parita' di corpo
  // l'inchiostro del dollaro sarebbe piu' alto. Le misure devono differire.
  const eur = misuraDi("EUR");
  const usd = misuraDi("USD");
  assert.notEqual(eur.corpo, usd.corpo,
    "EUR e USD hanno lo stesso corpo: uno dei due verra' piu' alto dell'altro");
  assert.ok(usd.linea < eur.linea,
    "il dollaro ha un'asta che scende: la sua linea di base deve stare piu' in alto");
  for (const v of ["EUR", "USD", "GBP", "CHF"]) {
    const m = misuraDi(v);
    assert.ok(m.simbolo.length === 1, `il simbolo di ${v} deve essere UN carattere: due lettere a 24px non si leggono`);
    assert.ok(m.corpo > 20 && m.corpo < 35, `corpo fuori scala per ${v}`);
  }
  assert.equal(misuraDi("zz").simbolo, "\u20ac", "valuta sconosciuta: si ripiega sull'euro");
});

test("l'icona e' il simbolo e basta — niente freccia, niente cornice", () => {
  const svg = iconaValuta("EUR");
  assert.match(svg, /<text[^>]*>\u20ac<\/text>/, "l'icona non porta piu' il simbolo");
  // ⚠️ Provate e scartate: a 24px la punta di una freccia sparisce dentro il
  // tratto del cerchio, e restano due macchie sovrapposte.
  assert.doesNotMatch(svg, /<path|<circle|<polyline/,
    "e' tornato un disegno dentro l'icona: a quella misura si impasta col simbolo");
  assert.equal(ALTEZZA_SIMBOLO, 21,
    "l'altezza non e' piu' quella del rollback: i due bottoni del piede non pareggiano piu'");
});

test("il rimborso totale ha un'etichetta sua", () => {
  const i18n = leggi("src/i18n/admin.ts");
  assert.match(i18n, /"ord\.refundedAll"/,
    "manca la chiave del rimborso totale: «Remboursé» nudo sembra un parziale senza importo");
  const ord = nudo("src/pages/admin/orders.astro");
  assert.match(ord, /ord\.refundedAll/, "la card non usa piu' l'etichetta del rimborso totale");
});
