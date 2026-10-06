/**
 * SEARCH CONSOLE — il bottone «Vérifier» deve soltanto verificare.
 *
 * ⚠️ IL DIFETTO (06/10/2026): «Vérifier» salvava `gsc_site` prima di
 * interrogare Google, perche' la rotta sapeva leggere la proprieta' solo da
 * `app_config`. Nessuno lo diceva e nessuno leggeva l'esito di quella
 * scrittura: si provava una proprieta' scritta male, la prova rispondeva di
 * no, e intanto quella sbagliata era gia' al posto di quella che funzionava.
 * Un bottone che fa una cosa in piu' di quella che dice e' il modo di perdere
 * una configurazione buona.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { sitoValido } from "../src/lib/searchConsole.ts";

const leggi = (f) => readFileSync(f, "utf8");

test("una proprieta' e' scritta in uno di due modi, non in tre", () => {
  for (const buono of ["sc-domain:esempio.be", "sc-domain:WWW.Esempio.BE", "https://www.esempio.be/", "https://esempio.be"]) {
    assert.equal(sitoValido(buono), true, `${buono} dovrebbe essere accettata`);
  }
  for (const cattivo of ["", "   ", "esempio.be", "http://esempio.be", "sc-domain:", "sc domain:esempio.be", "x".repeat(301)]) {
    assert.equal(sitoValido(cattivo), false, `${JSON.stringify(cattivo)} non dovrebbe passare`);
  }
  // Gli spazi intorno non sono un errore di chi incolla.
  assert.equal(sitoValido("  sc-domain:esempio.be  "), true);
});

test("salvare e provare accettano esattamente le stesse cose", () => {
  // Due copie della regola arriverebbero al caso peggiore: la prova dice di
  // si' e il salvataggio rifiuta, o il contrario.
  for (const f of ["src/pages/api/admin/integrations.ts", "src/pages/api/admin/search-console.ts"]) {
    const src = leggi(f);
    assert.match(src, /sitoValido\(/, `${f}: non usa la regola comune`);
    assert.doesNotMatch(
      src,
      /sc-domain:\[a-z0-9/i,
      `${f}: la regex della proprieta' e' tornata qui dentro, accanto a quella di searchConsole.ts`,
    );
  }
});

test("provare non scrive niente", () => {
  const sup = leggi("src/pages/admin/super.astro");
  const i = sup.indexOf('scTest?.addEventListener');
  assert.ok(i > 0, "l'handler del bottone «Vérifier» non si trova piu'");
  const handler = sup.slice(i, sup.indexOf("\n        });", i));
  assert.doesNotMatch(
    handler,
    /method: "(PUT|POST|PATCH|DELETE)"/,
    "«Vérifier» e' tornato a scrivere qualcosa: deve solo chiedere",
  );
  assert.match(handler, /search-console\?site=/, "la proprieta' da provare deve viaggiare nell'indirizzo");
  // E non deve ricaricare la scheda: rileggerebbe il valore SALVATO e
  // riscriverebbe il campo, cancellando la proprieta' appena provata.
  assert.doesNotMatch(handler, /itgCarica\(\)/, "ricaricare qui cancella dal campo cio' che si stava provando");
});

test("la prova e' del super, la tile della visibilita' di tutto lo staff", () => {
  const api = leggi("src/pages/api/admin/search-console.ts");
  const i = api.indexOf('searchParams.get("site")');
  assert.ok(i > 0, "il ramo della prova non c'e' piu'");
  const ramo = api.slice(i, i + 400);
  assert.match(ramo, /isSuperUser\(staff\)/, "chiunque potrebbe provare proprieta' altrui");
  // La lettura normale resta aperta allo staff: la usa la tile dell'Accueil.
  assert.match(api, /const staff = await verificaStaff\(request\);\n  if \(!staff\) return nonAutorizzato\(\);/);
});
