/**
 * Intégrations → la casella Google Business (5/11/2026). Le regole pure e le
 * protezioni: solo super admin, il link generato solo quando manca, la
 * scheda della sede che non scrive piu' i campi Google.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { linkRecensioneDaPlaceId, prontoG, livelloGoogle } from "../src/lib/admin/googleRegole.ts";

test("il link «laisser un avis» dal Place ID", () => {
  assert.equal(linkRecensioneDaPlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4"), "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
  assert.equal(linkRecensioneDaPlaceId(""), "");
  assert.equal(linkRecensioneDaPlaceId("AIzaSyD-chiave-api"), ""); // una chiave API non e' un Place ID
});

test("a posto: Place ID e link SUOI per le sedi, del marchio a sede unica", () => {
  const l = (id, o = {}) => ({ id, nome: id, placeId: "ChIJx", placeProprio: true, link: "https://x", linkProprio: true, scheda: "", schedaPropria: false, ...o });
  assert.equal(prontoG(l("marchio"), false), true);
  assert.equal(prontoG(l("a", { placeProprio: false }), true), false, "il Place ID del marchio e' di un'altra attivita'");
  assert.equal(prontoG(l("a", { linkProprio: false }), true), false);
  assert.equal(prontoG(l("a"), true), true);
  assert.deepEqual(livelloGoogle([l("marchio"), l("a"), l("b", { placeId: "" })]), { livello: "parz", pronti: 1, totale: 2 });
  assert.equal(livelloGoogle([l("marchio", { placeId: "" })]).livello, "no");
  // La scheda (OAuth, livello 2) non conta: il livello 1 funziona senza.
  assert.equal(livelloGoogle([l("marchio")]).livello, "ok");
});

test("l'API: solo super admin; il link si genera solo se il livello non ne ha uno suo", () => {
  const api = readFileSync("src/pages/api/admin/google-casella.ts", "utf8");
  for (const m of ["GET", "PUT", "POST"]) {
    const corpo = api.split(`export const ${m}`)[1]?.split("export const")[0] ?? "";
    assert.match(corpo, /isSuperUser\(staff\)/, `${m} senza controllo super`);
  }
  const lib = readFileSync("src/lib/admin/googleCasella.ts", "utf8");
  assert.match(lib, /if \(!prima\.link \|\| !prima\.linkProprio\)/, "un link scritto a mano verrebbe sovrascritto");
  assert.match(lib, /controllaPlaceId\(pid\)/, "il Place ID si controlla con la regola condivisa");
  // ⚠️ Il link NON si genera nelle email: e' anche l'interruttore dell'email d'avis.
  const notif = readFileSync("src/lib/notifications.ts", "utf8");
  assert.doesNotMatch(notif, /linkRecensioneDaPlaceId/);
});

test("la scheda della sede non scrive piu' i campi Google, e apre la casella", () => {
  const p = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.doesNotMatch(p, /id="loc-place"|id="loc-greview"|id="loc-g-pick"|id="g-place-unica"|id="g-unica"/);
  assert.match(p, /new CustomEvent\("apri-google"/);
  assert.match(p, /addEventListener\("apri-google"/);
});
