/**
 * IL SITO PUBBLICO — da quale punto si sta ordinando (pezzo 8).
 *
 * Per mesi il fronte pubblico ha indovinato: `ambitoPubblico()` rende la
 * PRIMA sede. Era una scelta consapevole e dichiarata — deterministico e
 * sbagliato in modo VISIBILE, invece che silenzioso e sbagliato in modo
 * variabile — ma restava sbagliato: a 450 Gradi, chiunque scegliesse Stockel
 * o Jourdan vedeva gli orari, il menu e la cassa di Schaerbeek.
 *
 * Adesso la richiesta LO DICE, e il ripiego resta solo per chi non dice
 * niente (un sito a punto unico: i quattro clienti di oggi).
 *
 * ⚠️ Qui gli errori non danno errore, mai. Un ordine che nasce nel punto
 * sbagliato si paga sul conto sbagliato e si cucina nella cucina sbagliata:
 * il cliente arriva, e non c'e' niente per lui.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { sedeDettaDa, HEADER_SEDE, PARAM_SEDE, CHIESTA_TUTTE } from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";

/** Una richiesta finta: solo quello che la regola guarda. */
const req = (o = {}) => ({
  url: o.url ?? "https://450gradi.be/api/slots",
  headers: { get: (n) => (o.headers ?? {})[n.toLowerCase()] ?? null },
});

/* ============================================================
   COME UNA RICHIESTA DICE IL SUO PUNTO
   ============================================================ */

test("l'header lo dice", () => {
  assert.equal(sedeDettaDa(req({ headers: { [HEADER_SEDE]: STOCKEL } })), STOCKEL);
});

test("anche `?sede=`, per chi un header non ce l'ha", () => {
  // Una pagina aperta dal browser, un iframe incorporato, un link condiviso:
  // nessuno di questi puo' mettere un header.
  assert.equal(sedeDettaDa(req({ url: `https://x.be/reservation-embed?${PARAM_SEDE}=${STOCKEL}` })), STOCKEL);
});

test("l'header vince sul parametro", () => {
  // Uno solo dei due puo' avere ragione. L'header e' quello che mette il
  // codice del sito; il parametro puo' venire da un link vecchio.
  const r = req({ url: `https://x.be/a?${PARAM_SEDE}=altro`, headers: { [HEADER_SEDE]: STOCKEL } });
  assert.equal(sedeDettaDa(r), STOCKEL);
});

test("IL COOKIE NON ENTRA MAI", () => {
  // ⚠️ Il cookie della sede vive su `Path=/` e viaggia anche verso le pagine
  // pubbliche. Leggendolo qui, un super admin che apre il sito vero si
  // troverebbe gli orari della sede selezionata nell'admin — e non avrebbe
  // nessun modo di capire perche'.
  const r = req({ headers: { cookie: `mdd_sede=${STOCKEL}` } });
  assert.equal(sedeDettaDa(r), "");
});

test("«tutte le sedi» non e' un posto dove si ordina", () => {
  assert.equal(sedeDettaDa(req({ headers: { [HEADER_SEDE]: CHIESTA_TUTTE } })), "");
  assert.equal(sedeDettaDa(req({ url: `https://x.be/a?${PARAM_SEDE}=${CHIESTA_TUTTE}` })), "");
});

test("chi non dice niente non sceglie niente", () => {
  assert.equal(sedeDettaDa(req()), "");
  assert.equal(sedeDettaDa(req({ headers: { [HEADER_SEDE]: "   " } })), "");
});

test("un URL malformato non fa cadere la pagina", () => {
  assert.equal(sedeDettaDa({ url: "non-un-url", headers: { get: () => null } }), "");
});

/* ============================================================
   NESSUN ENDPOINT PUBBLICO INDOVINA PIU'
   ============================================================ */

/** Chi puo' ancora chiamare `ambitoPubblico()`, e perche'. */
const INDOVINANO = {
  "src/lib/admin/sede.ts": "e' il file che lo definisce, ed e' il ripiego di ambitoPubblicoChiesto",
  "src/lib/popups.ts":
    "il pop-up lo disegna una PAGINA, che la sede la passa come parametro; " +
    "il ripiego resta per un sito a punto unico",
};

test("nessun endpoint pubblico si sceglie la sede da solo", () => {
  // ⚠️ `ambitoPubblico()` rende la PRIMA sede. In un endpoint pubblico non e'
  // un valore predefinito: e' una scelta a caso travestita da tale, e a
  // 450 Gradi sbaglia due volte su tre.
  const api = readdirSync("src/pages/api").filter((f) => f.endsWith(".ts"));
  const colpevoli = api
    .map((f) => `src/pages/api/${f}`)
    .filter((f) => /\bambitoPubblico\(\)/.test(senzaCommenti(readFileSync(f, "utf8"))))
    .filter((f) => !INDOVINANO[f]);
  assert.deepEqual(colpevoli.sort(), [], `indovinano la sede: ${colpevoli.join(", ")}`);
});

test("le eccezioni dichiarate esistono ancora", () => {
  const morte = Object.keys(INDOVINANO).filter(
    (f) => !/\bambitoPubblico\(\)/.test(senzaCommenti(readFileSync(f, "utf8"))),
  );
  assert.deepEqual(morte.sort(), [], `dichiarati ma non indovinano piu': ${morte.join(", ")}`);
});

/** Via i commenti: una rete non deve leggere le frasi che la descrivono. */
function senzaCommenti(t) {
  return t
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*)/.test(r))
    .join("\n");
}

/* ============================================================
   DOVE LA SEDE LA DICE IL DATO, NON LA RICHIESTA
   ============================================================ */

test("il PDF di un buono porta l'indirizzo di CHI L'HA VENDUTO", () => {
  // Nessuno «sceglie un punto» aprendo un PDF con un token. Il punto giusto
  // e' quello che ha incassato: e' il suo indirizzo che il cliente deve
  // trovarsi in mano quando va a spendere il buono. Prima usciva quello
  // della prima sede, e il cliente si presentava nel posto sbagliato.
  const src = senzaCommenti(readFileSync("src/pages/api/bon-pdf.ts", "utf8"));
  assert.match(src, /sold_at_location/);
  assert.match(src, /ambitoDiRiga\(/);
});

test("«modifier» e «annuler» funzionano per i clienti di TUTTI i punti", () => {
  // ⚠️ Il difetto trovato il 16/09/2026. Chi clicca nel suo promemoria non ha
  // scelto nessun punto sul sito: la ricerca era filtrata sulla prima sede, e
  // due clienti su tre si vedevano rispondere «lien invalide» su una
  // prenotazione che esisteva benissimo. Nessun errore nei log.
  //
  // Il `cancel_token` e' un uuid non indovinabile: e' LUI l'autorizzazione.
  const src = senzaCommenti(readFileSync("src/pages/api/reservation.ts", "utf8"));
  const conToken = [...src.matchAll(/leggiTab\("reservations",\s*(\w+\(?\)?)[^)]*\)\s*\n?\s*\.eq\("cancel_token"/g)];
  assert.ok(conToken.length >= 2, "le due ricerche per token sono sparite: rete da aggiornare");
  for (const m of conToken) {
    assert.equal(m[1], "tutteLeSedi()", "una ricerca per cancel_token non deve filtrare per sede");
  }
  assert.match(src, /const ambito = ambitoDiRiga\(/);
});

test("una prenotazione nasce nel punto che il cliente ha scelto", () => {
  const src = senzaCommenti(readFileSync("src/pages/api/reservation.ts", "utf8"));
  assert.match(src, /const ambito = await ambitoPubblicoChiesto\(request\)/);
});

test("l'ordine e la cassa sono lo stesso punto", () => {
  // Il checkout crea l'ordine e apre la sessione Stripe con lo STESSO ambito:
  // se divergessero, l'ordine sarebbe di un punto e i soldi di un altro.
  const src = senzaCommenti(readFileSync("src/pages/api/checkout.ts", "utf8"));
  assert.match(src, /const ambitoPub = await ambitoPubblicoChiesto\(request\)/);
  assert.match(src, /ambito: ambitoPub/);
});
