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

test("finche' i soldi sono scritti in euro, il motore DICE euro", () => {
  // ⚠️ Questa prova si legge al contrario: non controlla `valutaDelMotore`,
  // controlla che nessuno l'abbia collegata PRIMA del resto. Se un giorno
  // soldi.ts e stripe.ts leggeranno la valuta, questa prova diventera' rossa
  // ed e' il momento giusto per cambiarla.
  const soldi = nudo("src/lib/soldi.ts");
  const stripe = nudo("src/lib/stripe.ts");
  const euroFisso = /currency:\s*"EUR"/.test(soldi) && /currency:\s*"eur"/.test(stripe);
  if (euroFisso) {
    assert.equal(valutaDelMotore(), "EUR",
      "soldi.ts e stripe.ts incassano ancora in euro: il pannello non puo' mostrare un'altra valuta");
    const ord = nudo("src/pages/admin/orders.astro");
    assert.doesNotMatch(ord, /valutaDi\s*\(/,
      "la pagina Commandes legge la valuta dal paese mentre gli importi sono ancora in euro: la card mentirebbe sui soldi");
  } else {
    assert.notEqual(valutaDelMotore(), "EUR",
      "soldi.ts/stripe.ts non sono piu' fissi sull'euro: adesso valutaDelMotore() deve leggere il paese");
  }
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
