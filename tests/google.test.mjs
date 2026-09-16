/**
 * GOOGLE — tre schede, tre flussi di recensioni, un conto solo.
 *
 * Il modello e' MISTO, ed e' la cosa che si dimentica:
 *
 *   l'AUTORIZZAZIONE e' del marchio — un conto Google gestisce le tre schede,
 *                                     quindi un token solo. La collega MOODD,
 *                                     una volta, in super admin: i ristoratori
 *                                     non hanno questa possibilita' da nessuna
 *                                     parte.
 *   la SCHEDA e' della sede         — tre pizzerie, tre indirizzi
 *   le RECENSIONI sono della sede   — vengono dalla sua scheda
 *   il PLACE ID e' della sede       — identifica UN'ATTIVITA' FISICA
 *
 * Qui gli errori sono PUBBLICI: una risposta firmata dal ristorante sbagliato
 * resta su Google, sotto gli occhi di tutti, e non la si toglie con un
 * `update`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  schedaValida, sedeDaAttribuire, campoSede, schedaLibera,
} from "../src/lib/googleRegole.ts";
import { sede, SEDE_UNICA, tutteLeSedi, CLASSIFICA } from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";
const JOURDAN = "22222222-2222-2222-2222-222222222222";
const SCHEDA = "accounts/123/locations/456";

/* ============================================================
   IL PERCORSO DELLA SCHEDA
   ============================================================ */

test("si accetta solo il formato v4 di Google", () => {
  assert.equal(schedaValida(SCHEDA), true);
  for (const cattivo of ["", "accounts/123", "locations/456", "accounts//locations/456",
                         "accounts/123/locations/456/extra", null, undefined, 42]) {
    assert.equal(schedaValida(cattivo), false, String(cattivo));
  }
});

/* ============================================================
   A CHI APPARTENGONO LE RECENSIONI SCARICATE
   ============================================================ */

test("a sede unica non si attribuisce niente: NULL e' la verita'", () => {
  // ⚠️ Non e' un ripiego. Sui quattro clienti a punto singolo NULL e' quello
  // che c'e' scritto da sempre, e deve restare.
  assert.equal(sedeDaAttribuire({ ambito: SEDE_UNICA, dichiarata: STOCKEL, multiSede: false }), null);
});

test("sincronizzando un punto, le recensioni sono sue", () => {
  assert.equal(
    sedeDaAttribuire({ ambito: sede(STOCKEL), dichiarata: JOURDAN, multiSede: true }),
    STOCKEL,
    "ha creduto alla scheda dichiarata invece che al punto che si sta sincronizzando",
  );
});

test("senza un punto scelto (il cron) vale chi ha dichiarato la scheda", () => {
  assert.equal(sedeDaAttribuire({ ambito: tutteLeSedi(), dichiarata: JOURDAN, multiSede: true }), JOURDAN);
});

test("nessuno ha dichiarato la scheda: resta «non lo so»", () => {
  assert.equal(sedeDaAttribuire({ ambito: tutteLeSedi(), dichiarata: null, multiSede: true }), null);
});

/* ============================================================
   ⚠️ LE TRE RIGHE CHE HANNO QUASI CANCELLATO 276 RECENSIONI
   ============================================================ */

test("non sapendo la sede, la colonna NON entra nel payload", () => {
  // Le recensioni si salvano con un upsert su `review_id`. Un upsert scrive
  // QUELLO CHE GLI PASSI: con `location_id: null` ogni sincronizzazione
  // azzererebbe l'attribuzione di TUTTE le recensioni gia' assegnate — e
  // senza un errore da nessuna parte.
  //
  // «Non lo so» e «e' di nessuno» sono due cose diverse: un campo assente
  // dice la prima, un `null` esplicito dice la seconda.
  assert.deepEqual(campoSede(null), {});
  assert.equal("location_id" in campoSede(null), false, "la colonna e' entrata lo stesso");
  assert.deepEqual(campoSede(STOCKEL), { location_id: STOCKEL });
});

test("la riga vera che va nell'upsert non porta location_id quando non si sa", () => {
  const riga = { review_id: "r1", rating: 5, ...campoSede(null) };
  assert.deepEqual(Object.keys(riga), ["review_id", "rating"]);
});

/* ============================================================
   ⚠️ UNA SCHEDA, UNA SEDE
   ============================================================ */

test("una scheda libera si puo' prendere", () => {
  assert.equal(schedaLibera({ giaDi: null, ambito: sede(STOCKEL) }), true);
});

test("⚠️ la scheda di un altro punto NON si prende", () => {
  // Due sedi sullo stesso percorso scaricano le stesse recensioni, e
  // `review_id` e' la chiave primaria: a ogni giro l'attribuzione si
  // riscrive. Le recensioni rimbalzano fra i due punti, i conteggi
  // diventano casuali, e chi prova a rispondere a una recensione sua si
  // sente dire che non e' sua — a volte.
  assert.equal(schedaLibera({ giaDi: JOURDAN, ambito: sede(STOCKEL) }), false);
});

test("riassegnare la STESSA scheda allo STESSO punto e' un salvataggio, non un conflitto", () => {
  assert.equal(schedaLibera({ giaDi: STOCKEL, ambito: sede(STOCKEL) }), true);
});

test("fuori da un punto, una scheda gia' presa resta presa", () => {
  // A sede unica non si arriva qui (non c'e' niente di dichiarato), ma se
  // ci si arrivasse, scrivere sopra la dichiarazione di un punto sarebbe il
  // modo di rompere tutto da un pannello che non sa di che sede parla.
  assert.equal(schedaLibera({ giaDi: JOURDAN, ambito: SEDE_UNICA }), false);
  assert.equal(schedaLibera({ giaDi: JOURDAN, ambito: tutteLeSedi() }), false);
});

/* ============================================================
   LE RETI — dove la separazione vive davvero
   ============================================================ */

test("le recensioni sono una tabella di SEDE", () => {
  assert.equal(CLASSIFICA.google_reviews, "sede",
    "tre schede Google, tre flussi: mescolarli falsa la media di ogni punto");
});

test("ogni pagina Google dell'admin guarda la sede selezionata", () => {
  // ⚠️ Profilo, foto, post, attributi, menu, dati: ognuna agisce sulla
  // SCHEDA di un punto. Con l'ambito sbagliato si modificherebbe la vetrina
  // Google di un'altra societa' — e su Google si vede subito, da fuori.
  const dir = "src/pages/api/admin/google";
  const file = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(file.length >= 8, `trovati solo ${file.length} endpoint: la ricerca non funziona`);

  // `locations.ts` e' l'eccezione dichiarata: lo chiama il modale della sede
  // nel super admin, quindi la sede arriva ESPLICITA nel parametro e viene
  // verificata contro l'elenco vero (`sedeChiesta`).
  const ECCEZIONI = {
    "locations.ts":
      "la chiama il modale della sede: il punto arriva nel parametro `sede` e si verifica",
  };
  const senza = [];
  for (const f of file) {
    if (ECCEZIONI[f]) continue;
    const src = readFileSync(`${dir}/${f}`, "utf8");
    if (!/ambitoDiRichiesta\(/.test(src)) senza.push(f);
  }
  assert.deepEqual(senza.sort(), [], `endpoint Google senza la sede della richiesta:\n  ${senza.join("\n  ")}`);

  // E l'eccezione deve restare vera: se un giorno usasse `ambitoDiRichiesta`,
  // il modale della sede scriverebbe sul punto selezionato nell'header.
  const loc = readFileSync(`${dir}/locations.ts`, "utf8");
  assert.match(loc, /async function sedeChiesta\(/);
  assert.match(loc, /elencoSedi\(\)\)\.some\(\(s\) => s\.id === id\)/,
    "la sede che arriva dal browser non viene piu' verificata");
});

test("rispondere a una recensione passa dal filtro di sede", () => {
  // ⚠️ Rispondere e' un atto PUBBLICO firmato dal ristorante. Senza filtro,
  // il responsabile di Stockel potrebbe rispondere a una recensione di
  // Jourdan, e la risposta comparirebbe su Google a nome di un'altra
  // societa'. L'id della recensione arriva dal browser.
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  assert.match(lib, /leggi\("google_reviews", ambito, "name"\)/);
  const reply = readFileSync("src/pages/api/admin/google/reply.ts", "utf8");
  assert.match(reply, /nomeRecensione\(reviewId, ambito\)/);
});

test("il conflitto fra schede si controlla PRIMA di salvare", () => {
  const api = readFileSync("src/pages/api/admin/google/locations.ts", "utf8");
  const guardia = api.indexOf("schedaLibera(");
  const salva = api.indexOf("salvaLocation(");
  assert.ok(guardia >= 0, "manca il controllo «una scheda, una sede»");
  assert.ok(salva > guardia, "si salva prima di controllare: il conflitto e' gia' scritto");
});

test("chi cerca la sede di una scheda non usa maybeSingle", () => {
  // ⚠️ Con due sedi sullo stesso percorso la query rende due righe e
  // `maybeSingle()` fallisce — cioe' proprio nel caso che quella funzione
  // esiste per scoprire, risponderebbe «nessuna».
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  const i = lib.indexOf("export async function sedeConLaScheda");
  assert.ok(i > 0, "sedeConLaScheda non trovata");
  const corpo = lib.slice(i, lib.indexOf("\n}", i));
  assert.equal(/maybeSingle\(\)/.test(corpo), false, "sedeConLaScheda usa maybeSingle");
  assert.match(corpo, /\.limit\(1\)/);
});

test("il token Google e' del marchio, e resta uno solo", () => {
  // Un conto gestisce le tre schede: e' la ragione per cui basta
  // un'autorizzazione. Se un giorno servisse un token per sede, questo test
  // lo dice — e vorrebbe dire ripensare tutto il collegamento.
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  assert.match(lib, /const K_REFRESH = "google_oauth_refresh";/);
  assert.match(lib, /export async function accessToken\(\): Promise<string \| null>/,
    "accessToken ha preso un ambito: il token non e' piu' del marchio");
});

/* ============================================================
   IL LAVORO «BEST-EFFORT» CHE FALLISCE IN SILENZIO
   ------------------------------------------------------------
   Trovato il 16/09/2026 guardando la pagina Google di Stockel:
   le recensioni c'erano, il pannello business a sinistra — mappa,
   logo, indirizzo, orari — no. Schaerbeek e Jourdan ce l'avevano.

   Il pannello si disegna da `google_profile`, che il sync scrive
   solo se `dettagliScheda` riesce. Google puo' rifiutare UNA
   scheda (non verificata, in attesa, o su cui il conto non ha il
   ruolo giusto) e riuscire sulle altre. Il codice faceva
   `if (scheda) …` e basta: nessun log, nessuno stato, niente.

   Con una sede sola non si sarebbe mai notato. Con tre si vede —
   due hanno la mappa e una no — e non c'e' niente da leggere per
   capire perche'. Un lavoro che fallisce senza lasciare traccia
   e' un lavoro che nessuno sistemera' mai.
   ============================================================ */

test("i dettagli della scheda dicono anche PERCHE' hanno fallito", () => {
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  assert.match(
    lib,
    /export async function dettagliScheda\(\s*token: string,\s*path: string,\s*\): Promise<\{ scheda: GScheda \| null; error: string \}>/,
    "dettagliScheda e' tornata a rendere solo null: il fallimento non lascia traccia",
  );
});

test("una scheda rifiutata non fa perdere le recensioni, ma si registra", () => {
  // ⚠️ Sono due cose diverse e devono restare separate: le recensioni
  // arrivano lo stesso (vengono da un'altra API), e il sync riesce. Quello
  // che NON deve succedere e' che nessuno lo sappia.
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  assert.match(lib, /schedaError = errScheda;/);
  assert.match(lib, /console\.error\(`\[google\] scheda illeggibile/);
  assert.match(lib, /schedaError\?: string;/, "l'esito non porta l'errore della scheda");
});

test("l'errore della scheda arriva fino allo schermo", () => {
  // Registrarlo nei log non basta: chi guarda il pannello vuoto e' il
  // ristoratore, e nei log non ci va.
  const api = readFileSync("src/pages/api/admin/google/sync.ts", "utf8");
  assert.match(api, /schedaError: r\.schedaError \?\? "",/);
  const pagina = readFileSync("src/pages/admin/google.astro", "utf8");
  assert.match(pagina, /j\.schedaError/);
  const i18n = readFileSync("src/i18n/admin.ts", "utf8");
  assert.match(i18n, /"gg\.ficheErr":/);
  // Le cinque lingue dell'admin, come ogni altro messaggio.
  const riga = /"gg\.ficheErr":[^\n]*/.exec(i18n)[0];
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    assert.match(riga, new RegExp(`\\b${l}:`), `manca la lingua ${l}`);
  }
});
