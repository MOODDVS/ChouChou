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
   E IL BROWSER DEVE DIRLO
   ============================================================ */

/**
 * Le prove qui sopra guardano il SERVER: nessun endpoint pubblico si sceglie
 * la sede da solo. Ma un endpoint che CHIEDE il punto e un browser che non lo
 * DICE danno lo stesso risultato di prima — il ripiego, cioe' la prima sede.
 *
 * ⚠️ Il 21/09/2026 era esattamente cosi': `ReservationWidget` mandava la sede
 * a ogni chiamata, `OrderApp`, `SlotPicker` e `ContactForm` no. Il server era
 * pronto da giorni, e nessuna prova se ne accorgeva: si prenotava nel punto
 * giusto e si ordinava nel primo.
 */

/** Chi il punto lo chiede alla richiesta: letto dagli endpoint, non a mano. */
const ENDPOINT_DI_SEDE = readdirSync("src/pages/api")
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => /ambitoPubblicoChiesto\(/.test(readFileSync(`src/pages/api/${f}`, "utf8")))
  .map((f) => f.replace(/\.ts$/, ""));

/** I componenti del fronte pubblico (quelli di `admin/` non c'entrano). */
const COMPONENTI_PUBBLICI = readdirSync("src/components")
  .filter((f) => /\.(astro|tsx)$/.test(f))
  .map((f) => `src/components/${f}`);

/** Chiamate che il punto NON lo mandano, e hanno ragione. */
const TACCIONO_APPOSTA = {
  "src/components/ReservationWidget.astro": [
    // La modifica (PUT) di una prenotazione che esiste gia': la sua sede sta
    // nella riga, e il token e' l'autorizzazione. Mandare un punto qui
    // vorrebbe dire poter spostare una prenotazione cambiando un URL.
    'modifyToken ? "/api/reservation"',
  ],
};

test("gli endpoint di sede esistono (le due prove qui sotto non girano a vuoto)", () => {
  assert.ok(ENDPOINT_DI_SEDE.includes("checkout"), "checkout non chiede piu' il punto alla richiesta");
  assert.ok(ENDPOINT_DI_SEDE.length >= 4, `letti solo ${ENDPOINT_DI_SEDE.length} endpoint di sede`);
  assert.ok(COMPONENTI_PUBBLICI.length >= 4, "non si leggono piu' i componenti pubblici");
});

test("il browser dice il punto a ogni chiamata che lo chiede", () => {
  const muti = [];
  for (const f of COMPONENTI_PUBBLICI) {
    const src = readFileSync(f, "utf8");
    const scuse = TACCIONO_APPOSTA[f] ?? [];
    // ⚠️ La finestra prende anche un pezzo DOPO l'URL: le scuse dichiarate
    // sono frammenti di codice veri, virgolette comprese.
    for (const m of src.matchAll(/(.{0,40})"\/api\/([a-z-]+)[^"\n]*"?/g)) {
      const [intero, prima, nome] = m;
      if (!ENDPOINT_DI_SEDE.includes(nome)) continue;
      if (prima.includes("conSede(")) continue;
      if (scuse.some((v) => intero.includes(v))) continue;
      muti.push(`${f}: /api/${nome}`);
    }
  }
  assert.deepEqual(muti.sort(), [],
    "una chiamata senza sede finisce sulla PRIMA: menu falso, ordine e incasso nel punto sbagliato");
});

test("le scuse dichiarate esistono ancora", () => {
  const morte = [];
  for (const [f, scuse] of Object.entries(TACCIONO_APPOSTA)) {
    const src = readFileSync(f, "utf8");
    for (const v of scuse) if (!src.includes(v)) morte.push(`${f}: ${v}`);
  }
  assert.deepEqual(morte, [], "dichiarate mute ma non esistono piu': toglile dall'elenco");
});

test("la regola di come si attacca il punto sta in un posto solo", () => {
  // Ogni componente si tiene la SUA `conSede(u)` legata alla propria sede —
  // e' un'associazione. Il parametro e il modo di attaccarlo no: due copie
  // di quella riga sono due copie che prima o poi divergono.
  const L = readFileSync("src/lib/sedeUrl.ts", "utf8");
  assert.match(L, /PARAM_SEDE/, "sedeUrl non usa piu' la costante del parametro");
  const aMano = COMPONENTI_PUBBLICI.filter((f) =>
    /encodeURIComponent\(\s*(SEDE|sede)\s*\)/.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(aMano, [], "questo componente si riscrive la regola invece di usare urlConSede");
});

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

test("i campi del widget non scendono sotto i 16px sul tocco", () => {
  // ⚠️ Safari su iPhone INGRANDISCE la pagina da solo quando si tocca un campo
  // con testo piu' piccolo di 16px. Il modulo diventa piu' largo dello schermo
  // e si compila nome, telefono ed email trascinando la pagina di lato — sul
  // modulo che porta le prenotazioni, cioe' dove un cliente abbandona e basta.
  //
  // Non e' un comportamento che si puo' spegnere. La scorciatoia nota e'
  // `maximum-scale=1` nel viewport, ma toglie lo zoom a chiunque, anche a chi
  // ne ha bisogno per leggere: un'accessibilita' vera sacrificata a un difetto
  // di stile. L'unica cura buona e' non scendere sotto i 16px dove si tocca.
  const W = readFileSync("src/components/ReservationWidget.astro", "utf8");

  // ⚠️ Si cerca DENTRO i blocchi `pointer: coarse`, uno per uno, non «entro
  // 200 caratteri dall'apertura». I clienti hanno blocchi coarse loro — il
  // datepicker di ChouChou e L'Huile — e la posizione della regola dentro il
  // blocco e' una questione di stile, non di comportamento: il 04/10 questo
  // test e' diventato rosso su un cliente dove la regola c'era, solo piu' in
  // basso. Un test che litiga su dove sta una riga finisce aggirato.
  const blocchiCoarse = [...W.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]);
  const coi16 = blocchiCoarse.some((b) => /\.rw-in[^}]*font-size:\s*16px/.test(b));
  assert.ok(coi16,
    "i campi del widget sono tornati sotto i 16px sul tocco: iPhone zooma e il modulo diventa inusabile");

  // E la scorciatoia che non vogliamo, in nessuna pagina pubblica.
  // ⚠️ Si guarda il TAG `<meta viewport>`, non il testo del file: la prima
  // versione cercava la stringa e basta, e accusava il commento qui sopra che
  // spiega perche' quella strada non si prende. Un test che litiga con la
  // propria spiegazione lo si disattiva, non lo si legge.
  for (const f of ["src/components/ReservationWidget.astro", "src/pages/reservation-embed.astro"]) {
    let src = "";
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    const meta = [...src.matchAll(/<meta[^>]*name=["']viewport["'][^>]*>/gi)].map((m) => m[0]);
    for (const tag of meta) {
      assert.doesNotMatch(tag, /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/,
        `${f} blocca lo zoom nel viewport: si risolve un difetto di stile togliendo l'ingrandimento a chi non ci vede`);
    }
  }
});
