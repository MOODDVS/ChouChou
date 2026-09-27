/**
 * LA LINGUA DI BASE DEL SITO PUBBLICO.
 *
 * Il motore dava per scontato due cose: che la lingua alla radice fosse il
 * francese, e che l'unica altra fosse l'inglese, scritto `"en"` dentro le
 * funzioni. Per quattro clienti belgi era vero. Per il primo con il sito in
 * inglese non lo e' piu': si sarebbe ritrovato `/en` davanti a ogni
 * indirizzo, compresi `success_url` e `cancel_url` di Stripe — cioe' il
 * cliente che ha appena pagato mandato su una pagina che non esiste.
 *
 * ⚠️ QUALE sia la lingua di base NON e' una decisione del motore: sta in
 * `src/i18n/ui.ts`, che e' `merge=ours`, ed e' gia' un file del cliente. Qui
 * si prova la REGOLA, passandole la lingua che si vuole: con la lingua letta
 * da una costante importata, una prova potrebbe verificare solo il caso
 * francese, cioe' l'unico che non ci preoccupa.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { prefissoLingua, urlConLingua } from "../src/lib/linguaUrl.ts";
import { SONO_IL_MOTORE } from "./ambiente.mjs";

test("la lingua di base non ha prefisso, le altre si'", () => {
  assert.equal(prefissoLingua("fr", "fr"), "");
  assert.equal(prefissoLingua("en", "fr"), "/en");
  assert.equal(prefissoLingua("it", "fr"), "/it");
  // Chi non dice niente sta alla radice: e' la lingua di base.
  assert.equal(prefissoLingua(undefined, "fr"), "");
  assert.equal(prefissoLingua("", "fr"), "");
  assert.equal(prefissoLingua(null, "fr"), "");
});

test("con il sito in inglese, il ritorno da Stripe non ha prefisso", () => {
  // ⚠️ E' il caso che ha fatto nascere questo lavoro. Se `/order-confirm`
  // uscisse come `/en/order-confirm` su un sito che l'inglese ce l'ha alla
  // radice, chi ha appena pagato finirebbe su una pagina che non esiste —
  // con l'ordine gia' incassato.
  assert.equal(urlConLingua("/order-confirm", "en", "en"), "/order-confirm");
  assert.equal(urlConLingua("/order-cancel", "en", "en"), "/order-cancel");
  // E la seconda lingua di quel sito prende il suo prefisso, francese incluso.
  assert.equal(urlConLingua("/order-confirm", "fr", "en"), "/fr/order-confirm");
  assert.equal(urlConLingua("order-confirm", "fr", "en"), "/fr/order-confirm");
});

test("nessuna lingua scritta a mano in stripe.ts", () => {
  // Il resto del file usava gia' `defaultLang`; tre ripieghi `"fr"` erano
  // rimasti indietro, e si vedevano solo sul supplemento di un ordine.
  const S = readFileSync("src/lib/stripe.ts", "utf8");
  assert.doesNotMatch(S, /"fr"/, "una lingua e' di nuovo scritta fissa in stripe.ts");
  assert.match(S, /prefissoLingua\(lang, defaultLang\)/);
  assert.match(S, /prefissoLingua\(opts\.lang, defaultLang\)/);
  // E gli indirizzi di ritorno passano da li', non da una stringa cucita a mano.
  const ritorni = [...S.matchAll(/(success_url|cancel_url): `([^`]*)`/g)].map((m) => m[2]);
  assert.ok(ritorni.length >= 4, `letti solo ${ritorni.length} indirizzi di ritorno`);
  for (const u of ritorni) {
    assert.ok(
      u.includes("${prefix}") || u.includes("returnBase") || u.includes("prefissoLingua("),
      `indirizzo di ritorno cucito sulla radice: ${u}`,
    );
  }
});

test.skipIf(!SONO_IL_MOTORE)("il template del motore non nomina nessuna lingua", () => {
  // ⚠️ Solo nel motore. `src/i18n/ui.ts` e' `merge=ours`: nei quattro clienti
  // di oggi c'e' la LORO versione, con `"en"` scritto a mano, e va benissimo —
  // il loro sito ha il francese alla radice. Qui si difende il TEMPLATE, che
  // e' quello da cui parte il prossimo cliente.
  const U = readFileSync("src/i18n/ui.ts", "utf8");
  const corpo = U.split("\n").filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r)).join("\n");
  assert.doesNotMatch(corpo, /seg === "[a-z]{2}"/, "getLangFromUrl nomina di nuovo una lingua");
  assert.doesNotMatch(corpo, /`\/en\$\{/, "getLocalizedUrl scrive di nuovo /en a mano");
  assert.match(corpo, /urlConLingua\(path, lang, defaultLang\)/);
});
