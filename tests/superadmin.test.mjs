/**
 * SUPER ADMIN — cosa e' del MARCHIO e cosa e' della SEDE, tab per tab.
 *
 * ⚠️ Questa pagina ha una trappola sua, diversa da tutte le altre.
 *
 * Ovunque nell'admin, l'ambito arriva dal selettore nell'header e va bene
 * cosi': si sta lavorando DENTRO un punto. Qui no. Il super admin configura
 * l'INSTALLAZIONE — i colori, le lingue, le funzioni, le integrazioni — e lo
 * fa mentre quel selettore sta su un punto qualunque, perche' deve pur stare
 * da qualche parte.
 *
 * Se uno di questi salvataggi passasse da `scriviConfig(ambito, …)`, il tema
 * finirebbe in `location_config` e cambierebbe colore a UNA pizzeria sola.
 * Nessun errore: si salva, si ricarica, si vede il tema nuovo. Poi si cambia
 * sede e i colori tornano quelli vecchi, e non c'e' niente da leggere per
 * capire perche'.
 *
 * La difesa e' strutturale e vale la pena dirla: gli endpoint del marchio
 * scrivono DIRETTAMENTE su `app_config`, senza mai toccare un ambito. Non e'
 * pigrizia — e' che cosi' il selettore dell'header non ha nessuna strada per
 * arrivarci.
 *
 * Quello che invece E' di una sede (le chiavi Stripe, il Place ID, la scheda
 * Google, la sede di un utente) prende il punto per parametro ESPLICITO e lo
 * verifica contro l'elenco vero.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const PAGINA = readFileSync("src/pages/admin/super.astro", "utf8");
const api = (f) => readFileSync(`src/pages/api/admin/${f}`, "utf8");

/* ============================================================
   L'INVENTARIO: sei tab, e a che livello vive ognuno
   ============================================================ */

/**
 * Per ogni tab del super admin: cosa contiene e di chi e'.
 * Se un giorno un tab cambia livello, questo elenco e i test qui sotto
 * devono cambiare insieme — ed e' il punto.
 */
const TAB = {
  design: {
    livello: "marchio",
    cosa: "colori, logo, favicon: l'identita' visiva e' una sola anche con tre societa'",
    api: ["pages"],
  },
  reglages: {
    livello: "marchio",
    cosa: "lingue del sito, lingua dell'admin, pagine attive: valgono per l'installazione",
    api: ["pages"],
  },
  integrations: {
    livello: "marchio",
    cosa: "OAuth Google, Search Console, chiavi dei servizi: un conto per installazione",
    api: ["integrations"],
  },
  print: {
    livello: "marchio",
    cosa: "catalogo di stampa MOODD: e' il listino del fornitore, uguale per tutti",
    api: ["print-catalog"],
  },
  sedi: {
    livello: "sede",
    cosa: "le sedi stesse, e dentro il modale le chiavi Stripe, il Place ID e la scheda Google",
    api: ["locations", "google/locations"],
  },
  users: {
    livello: "misto",
    cosa: "l'elenco utenti e' dell'installazione; la sede di OGNI utente e' sua",
    api: ["users"],
  },
};

test("i tab del super admin sono quelli dichiarati, ne' uno di piu' ne' uno di meno", () => {
  // ⚠️ Un tab nuovo non dichiarato qui e' un tab di cui nessuno ha deciso il
  // livello — e il livello, in questa pagina, non si nota se e' sbagliato.
  const nelCodice = [...PAGINA.matchAll(/<section class="pane"[^>]*data-pane="([a-z]+)"/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual(nelCodice, Object.keys(TAB).sort());
  for (const [nome, t] of Object.entries(TAB)) {
    assert.ok(["marchio", "sede", "misto"].includes(t.livello), `${nome}: livello strano`);
    assert.ok(t.cosa.length > 30, `${nome}: manca la spiegazione`);
  }
});

/* ============================================================
   ⚠️ IL MARCHIO: il selettore dell'header non deve arrivarci
   ============================================================ */

const DEL_MARCHIO = ["pages.ts", "integrations.ts", "print-catalog.ts"];

test("gli endpoint del marchio non conoscono nemmeno l'esistenza delle sedi", () => {
  // ⚠️ E' la difesa vera, ed e' STRUTTURALE: questi tre file non importano
  // niente da `admin/sede`. Non c'e' nessuna strada per cui il selettore
  // dell'header arrivi fin qui — non perche' qualcuno si ricorda di non
  // usarlo, ma perche' non ce l'hanno in mano.
  //
  // ⚠️ Si guarda l'IMPORT, non la chiamata. Provato: cercando solo
  // `ambitoDiRichiesta(` questa rete restava verde mentre l'import era gia'
  // li'. L'import e' il primo passo e l'unico momento in cui qualcuno sta
  // decidendo davvero; la chiamata arriva dopo, quando la decisione sembra
  // gia' presa.
  for (const f of DEL_MARCHIO) {
    const src = api(f);
    assert.equal(
      /from "[^"]*admin\/sede"/.test(src),
      false,
      `${f}: ha cominciato a importare da admin/sede, ma configura l'INSTALLAZIONE`,
    );
    assert.equal(/\bambitoDiRichiesta\b/.test(src), false,
      `${f}: nomina la sede selezionata, ma configura l'installazione`);
    assert.equal(/\bscriviConfig\b/.test(src), false,
      `${f}: usa scriviConfig, che a livello «sede» scrive in location_config`);
  }
});

test("gli endpoint del marchio scrivono su app_config, e si vede", () => {
  for (const f of DEL_MARCHIO) {
    assert.match(api(f), /supabaseAdmin\s*\n?\s*\.from\("app_config"\)/,
      `${f}: non scrive piu' direttamente sull'installazione`);
  }
});

test("il design e le lingue passano dal marchio, non da un punto", () => {
  // I sei salvataggi dei tab Design e Réglages vanno tutti allo stesso posto.
  const verso = [...PAGINA.matchAll(/fetch\(\s*"(\/api\/[^"?]+)[^)]{0,400}?method:\s*"(PUT|POST|PATCH)"/gs)]
    .map((m) => m[1]);
  assert.ok(verso.filter((u) => u === "/api/admin/pages").length >= 5,
    "i salvataggi di Design/Réglages non vanno piu' tutti a /api/admin/pages");
});

/* ============================================================
   LA SEDE: il punto arriva ESPLICITO e si verifica
   ============================================================ */

test("il modale della sede dice SEMPRE di quale punto parla", () => {
  // ⚠️ Qui `ambitoDiRichiesta` sarebbe sbagliato al contrario: si sta
  // modificando la sede X mentre il selettore dell'header e' su Y. Quindi il
  // punto arriva nel corpo o nel parametro — e siccome arriva dal browser,
  // va verificato contro l'elenco vero.
  const loc = api("locations.ts");
  assert.match(loc, /RE_UUID\.test\(id\)/, "l'id della sede non viene piu' validato");
  assert.match(loc, /body\.secret_key !== undefined/, "il modale non scrive piu' i segreti");

  const gloc = api("google/locations.ts");
  assert.match(gloc, /async function sedeChiesta\(/);
  assert.match(gloc, /elencoSedi\(\)\)\.some\(\(s\) => s\.id === id\)/,
    "la sede della scheda Google non viene piu' verificata");
  assert.equal(/ambitoDiRichiesta\(/.test(gloc), false,
    "la scheda Google segue il selettore dell'header invece della sede del modale");
});

test("i segreti Stripe e il Place ID si scrivono SOLO sulla sede del modale", () => {
  const loc = api("locations.ts");
  // `ambitoDiRiga(id)` = la sede che il modale sta modificando, non quella
  // selezionata. Il Place ID identifica un'attivita' fisica: scriverlo sul
  // punto sbagliato vuol dire collegare la vetrina Google di un'altra.
  assert.match(loc, /scriviConfig\(ambitoDiRiga\(id\), \{ google_place_id: placeId \}\)/);
  assert.match(loc, /\.from\("location_secrets"\)\s*\n?\s*\.upsert\(\{ location_id: id,/);
});

test("la sede di un utente si verifica contro l'elenco vero", () => {
  // ⚠️ L'id arriva dal browser. Senza controllo, un utente potrebbe nascere
  // legato a una sede che non esiste — e `scegliSede` lo lascerebbe vedere
  // il VUOTO, per sempre, senza nessun errore.
  const u = api("users.ts");
  assert.match(u, /async function sedeDaBody\(/);
  assert.match(u, /\.from\("locations"\)\.select\("id"\)\.eq\("id", s\)/);
  assert.match(u, /throw new Error\("Établissement inconnu\."\)/);
  // Vuoto = nessuna sede = vede tutto. `undefined` = non tocca niente.
  assert.match(u, /if \(v === undefined\) return undefined;/);
  assert.match(u, /if \(!s\) return null;/);
});

/* ============================================================
   LA SCHEDA DELLA SEDE — quello che il pannello mostra
   ============================================================ */

test("la scheda di una sede distingue «suo» da «ereditato»", () => {
  // ⚠️ `leggiConfig` ricade sull'installazione quando la sede non ha scritto
  // niente. Per l'indirizzo va benissimo; per il Place ID e la scheda Google
  // e' una bugia — identificano UN'ATTIVITA' FISICA, e tre pizzerie non
  // possono averne una sola. Senza questa distinzione il pannello avrebbe
  // mostrato tutte e tre «configurate» con il dato di un altro ristorante.
  const loc = api("locations.ts");
  assert.match(loc, /propri\[r\.id\] = \[\.\.\.c\.sovrascritte\]/);
  assert.match(PAGINA, /if \(!\(propri\[idSede\] \?\? \[\]\)\.includes\(chiave\)\) return \["no", String\(L\.stDaMarchio/);
});

test("la scheda dice se il .env ha un ripiego, mai quale", () => {
  // Distingue «non configurata» da «eredita dal .env»: sono due cose
  // diverse, e la prima e' un pagamento che fallira'.
  const loc = api("locations.ts");
  assert.match(loc, /ambiente\[k\] = segretoDAmbiente\(k\) !== "";/);
  assert.equal(/ambiente\[k\] = segretoDAmbiente\(k\);/.test(loc), false,
    "il VALORE del segreto d'ambiente esce dall'API");
});

/* ============================================================
   CHI PUO' ENTRARE
   ============================================================ */

test("tutto il super admin e' riservato al super admin", () => {
  // ⚠️ Non e' una pagina come le altre: da qui si cambiano le chiavi con cui
  // si incassa e gli accessi di tutti. Un ristoratore non deve poterci
  // arrivare nemmeno chiamando l'API a mano.
  for (const f of ["locations.ts", "users.ts", "pages.ts", "integrations.ts", "print-catalog.ts"]) {
    const src = api(f);
    assert.match(src, /soloSuper|isSuperUser/,
      `${f}: non controlla piu' che sia il super admin`);
  }
});
