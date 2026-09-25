/**
 * IL MENU — il comportamento.
 *
 * Il modello, che e' la cosa che si dimentica:
 *
 *   il PIATTO e' del gruppo     — stessa margherita, stesso prezzo, ovunque
 *   il FORMATO e' di un punto   — la teglia la fa solo Stockel
 *   l'ESAURITO e' di un punto   — e non e' una proprieta' del piatto: e' uno
 *                                 stato di oggi, e vive in un'altra tabella
 *
 * Definizione e stato sono separati apposta. «Cos'e' in carta» cambia
 * raramente e vale per tutti; «cos'e' finito» cambia ogni sera e vale per
 * uno. Nella stessa colonna, Stockel segnando finita la burrata la
 * toglierebbe anche a Jourdan.
 *
 * Qui gli errori non si vedono mai: un formato che sparisce, un prezzo che
 * cambia fra la vetrina e la cassa, un piatto esaurito che si riesce a
 * pagare. Il cliente paga e la cucina non ce l'ha.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { ETICHETTE_MENU, etichettaMenu } from "../src/lib/i18nMenu.ts";
import {
  prezzoEffettivo, leggiVariantiDb, variantiDelPunto, trovaVariante,
  haVarianti, etichettaVariante, applicaStato,
} from "../src/lib/pricing.ts";
import {
  validaVarianti, variantiVisibili, fondiVarianti, pulisciI18n, MAX_VARIANTI,
} from "../src/lib/menuRegole.ts";
import { sede, SEDE_UNICA, tutteLeSedi } from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";
const JOURDAN = "22222222-2222-2222-2222-222222222222";
const v = (o) => ({ key: "k", label_i18n: { fr: "L" }, price_cents: 1000, ...o });

/* ============================================================
   IL PREZZO — un solo punto di verita' fra vetrina e cassa
   ============================================================ */

test("senza sconto il prezzo e' quello pieno", () => {
  assert.equal(prezzoEffettivo(1400, null, null), 1400);
  assert.equal(prezzoEffettivo(1400, "fixed", 0), 1400);
  assert.equal(prezzoEffettivo(1400, "percent", 0), 1400);
});

test("«fixed» e' il PREZZO promo, non lo sconto", () => {
  // 14 € in promo a 12 € → value = 1200, non 200. E' la confusione che fa
  // vendere una pizza a 2 €.
  assert.equal(prezzoEffettivo(1400, "fixed", 1200), 1200);
});

test("un prezzo promo piu' alto del pieno non ha effetto", () => {
  assert.equal(prezzoEffettivo(1400, "fixed", 1900), 1400);
});

test("la percentuale si applica e si arrotonda al centesimo", () => {
  assert.equal(prezzoEffettivo(1000, "percent", 10), 900);
  assert.equal(prezzoEffettivo(1499, "percent", 33), 1004);
  assert.equal(prezzoEffettivo(1000, "percent", 100), 0);
  // Oltre il 100% resta zero: mai un prezzo negativo.
  assert.equal(prezzoEffettivo(1000, "percent", 150), 0);
});

/* ============================================================
   I FORMATI — lettura del jsonb, che arriva anche sporco
   ============================================================ */

test("una riga senza chiave o senza prezzo valido si scarta, non fa cadere il menu", () => {
  // ⚠️ Scartare e non esplodere: un dato sporco nel database non deve far
  // sparire la carta dal sito. Un formato in meno si nota; una pagina
  // bianca la vede il cliente.
  const letti = leggiVariantiDb([
    v({ key: "30" }),
    v({ key: "" }),
    v({ key: "40", price_cents: "abc" }),
    v({ key: "50", price_cents: -1 }),
    "non un oggetto",
    null,
  ]);
  assert.deepEqual(letti.map((x) => x.key), ["30"]);
});

test("chiavi doppie: vince la prima", () => {
  const letti = leggiVariantiDb([v({ key: "30", price_cents: 1000 }), v({ key: "30", price_cents: 9999 })]);
  assert.equal(letti.length, 1);
  assert.equal(letti[0].price_cents, 1000);
});

test("i valori predefiniti: ordinabile si', esaurito no, sede di tutti", () => {
  const [x] = leggiVariantiDb([v({ key: "30" })]);
  assert.equal(x.orderable, true);
  assert.equal(x.sold_out, false);
  assert.equal(x.location_id, null, "un formato senza sede vale per TUTTE, non per nessuna");
});

test("un jsonb che non e' una lista rende lista vuota", () => {
  for (const cattivo of [null, undefined, {}, "[]", 42]) {
    assert.deepEqual(leggiVariantiDb(cattivo), []);
  }
});

/* ============================================================
   IL FORMATO E' DI UN PUNTO
   ============================================================ */

const CARTA = [
  v({ key: "30", price_cents: 1200, location_id: null }),          // tutti
  v({ key: "teglia", price_cents: 2400, location_id: STOCKEL }),   // solo Stockel
  v({ key: "gigante", price_cents: 3000, location_id: JOURDAN }),  // solo Jourdan
];

test("ogni punto vede i suoi formati e quelli di tutti, mai quelli degli altri", () => {
  assert.deepEqual(variantiDelPunto(CARTA, sede(STOCKEL)).map((x) => x.key), ["30", "teglia"]);
  assert.deepEqual(variantiDelPunto(CARTA, sede(JOURDAN)).map((x) => x.key), ["30", "gigante"]);
});

test("a sede unica si vede tutto: non c'e' niente da dividere", () => {
  assert.deepEqual(variantiDelPunto(CARTA, SEDE_UNICA).map((x) => x.key), ["30", "teglia", "gigante"]);
  assert.deepEqual(variantiDelPunto(CARTA, tutteLeSedi()).map((x) => x.key), ["30", "teglia", "gigante"]);
});

test("«ha formati» e' una domanda per punto, non per piatto", () => {
  const soloStockel = [v({ key: "teglia", location_id: STOCKEL })];
  assert.equal(haVarianti(soloStockel, sede(STOCKEL)), true);
  assert.equal(haVarianti(soloStockel, sede(JOURDAN)), false, "Jourdan crede di avere un formato che non fa");
});

/* ============================================================
   IL CHECKOUT — dove il filtro deve mordere davvero
   ============================================================ */

test("⚠️ il formato di un altro punto non si puo' PAGARE, non solo non si vede", () => {
  // Chi manda la chiave e' il browser, e il browser puo' mandare qualunque
  // cosa. Nascondere la teglia nel menu di Jourdan e poi accettarne il
  // pagamento vuol dire incassare per una pizza che quella cucina non fa.
  assert.equal(trovaVariante(CARTA, "teglia", true, sede(JOURDAN)), null);
  assert.equal(trovaVariante(CARTA, "teglia", true, sede(STOCKEL))?.price_cents, 2400);
});

test("un formato esaurito o non ordinabile non si paga", () => {
  const carta = [
    v({ key: "a", sold_out: true }),
    v({ key: "b", orderable: false }),
    v({ key: "c" }),
  ];
  // In vetrina esistono tutti e tre (restano in carta, segnalati)...
  assert.equal(trovaVariante(carta, "a", false, SEDE_UNICA)?.key, "a");
  assert.equal(trovaVariante(carta, "b", false, SEDE_UNICA)?.key, "b");
  // ...ma alla cassa passano solo quelli che si possono davvero servire.
  assert.equal(trovaVariante(carta, "a", true, SEDE_UNICA), null);
  assert.equal(trovaVariante(carta, "b", true, SEDE_UNICA), null);
  assert.equal(trovaVariante(carta, "c", true, SEDE_UNICA)?.key, "c");
});

test("una chiave inventata non trova niente", () => {
  assert.equal(trovaVariante(CARTA, "xxx", true, SEDE_UNICA), null);
  assert.equal(trovaVariante(CARTA, "", true, SEDE_UNICA), null);
  assert.equal(trovaVariante(CARTA, null, true, SEDE_UNICA), null);
});

/* ============================================================
   L'ESAURITO — stato del punto sopra la carta del gruppo
   ============================================================ */

const PIATTO = {
  id: "p1",
  name: "Margherita",
  sold_out: false,
  variants: [v({ key: "30" }), v({ key: "40" })],
};

test("nessuno stato per questo punto: il piatto resta com'e'", () => {
  assert.equal(applicaStato(PIATTO, undefined), PIATTO);
});

test("lo stato del punto comanda, anche per RIMETTERE in vendita", () => {
  // ⚠️ Se fosse solo additivo — «puo' esaurire, non puo' ripristinare» — un
  // punto non potrebbe mai rimettere in carta un piatto che il gruppo aveva
  // segnato finito, e se ne accorgerebbe la sera con il cliente davanti.
  const finito = { ...PIATTO, sold_out: true };
  const rimesso = applicaStato(finito, { sold_out: false, variants_off: [] });
  assert.equal(rimesso.sold_out, false);
});

test("si esaurisce un formato solo: la 40 si', la 30 no", () => {
  const r = applicaStato(PIATTO, { sold_out: false, variants_off: ["40"] });
  assert.deepEqual(r.variants.map((x) => x.sold_out), [false, true]);
});

test("applicare lo stato non tocca il piatto di partenza", () => {
  // ⚠️ Il piatto viene dal gruppo ed e' lo STESSO oggetto per tutte le sedi
  // nella stessa richiesta: modificarlo sul posto vorrebbe dire che
  // l'esaurito di Stockel si vede anche su Jourdan, nella stessa pagina.
  const copia = JSON.parse(JSON.stringify(PIATTO));
  applicaStato(PIATTO, { sold_out: true, variants_off: ["30", "40"] });
  assert.deepEqual(PIATTO, copia, "applicaStato ha modificato l'originale");
});

/* ============================================================
   LE ETICHETTE
   ============================================================ */

test("l'etichetta ripiega in ordine: lingua chiesta, default, prima, chiave", () => {
  const x = { key: "30", label_i18n: { fr: "30 cm", nl: "30 cm groot" } };
  assert.equal(etichettaVariante(x, "nl"), "30 cm groot");
  assert.equal(etichettaVariante(x, "it"), "30 cm");            // ripiega sul default fr
  assert.equal(etichettaVariante({ key: "30", label_i18n: { nl: "X" } }, "it"), "X");
  assert.equal(etichettaVariante({ key: "30", label_i18n: {} }, "it"), "30");
});

test("le etichette si ripuliscono: solo lingue note, senza spazi, troncate", () => {
  const r = pulisciI18n({ fr: "  Grande  ", it: "", xx: "ignorata", en: "A".repeat(60) }, 40);
  assert.deepEqual(Object.keys(r), ["fr", "en"]);
  assert.equal(r.fr, "Grande");
  assert.equal(r.en.length, 40);
});

/* ============================================================
   SCRITTURA DALL'ADMIN — il default e i confini
   ============================================================ */

test("dentro un punto, un formato nuovo e' SUO per default", () => {
  // ⚠️ La direzione dell'errore decide il default: un formato di troppo in
  // un punto si vede e si toglie, uno mancante non si vede.
  const { value } = validaVarianti([{ key: "teglia", label_i18n: { fr: "Teglia" }, price_cents: 2400 }], sede(STOCKEL));
  assert.equal(value[0].location_id, STOCKEL);
});

test("«vale per tutte le sedi» si dice, e viene rispettato", () => {
  const { value } = validaVarianti(
    [{ key: "30", label_i18n: { fr: "30 cm" }, price_cents: 1200, location_id: null }],
    sede(STOCKEL),
  );
  assert.equal(value[0].location_id, null);
});

test("⚠️ non si scrive MAI nel menu di un altro punto", () => {
  // L'id arriva dal browser. Accettarlo vorrebbe dire modificare il menu di
  // una societa' diversa da quella in cui si e' entrati.
  const r = validaVarianti(
    [{ key: "gigante", label_i18n: { fr: "Gigante" }, price_cents: 3000, location_id: JOURDAN }],
    sede(STOCKEL),
  );
  assert.ok(r.errore, "ha accettato la sede di un altro punto");
  assert.equal(r.value, undefined);
});

test("a sede unica i formati non hanno sede: com'e' sempre stato", () => {
  const { value } = validaVarianti([{ key: "30", label_i18n: { fr: "30" }, price_cents: 1200 }], SEDE_UNICA);
  assert.equal(value[0].location_id, null);
});

test("la chiave si normalizza, e senza chiave o etichetta si rifiuta", () => {
  const { value } = validaVarianti([{ key: "  30 CM!! ", label_i18n: { fr: "x" }, price_cents: 1 }], SEDE_UNICA);
  assert.equal(value[0].key, "30-cm");
  assert.ok(validaVarianti([{ key: "***", label_i18n: { fr: "x" }, price_cents: 1 }], SEDE_UNICA).errore);
  assert.ok(validaVarianti([{ key: "a", label_i18n: {}, price_cents: 1 }], SEDE_UNICA).errore);
  assert.ok(validaVarianti([{ key: "a", label_i18n: { fr: "x" }, price_cents: -1 }], SEDE_UNICA).errore);
  assert.ok(validaVarianti([{ key: "a", label_i18n: { fr: "x" }, price_cents: 1 }, { key: "a", label_i18n: { fr: "y" }, price_cents: 2 }], SEDE_UNICA).errore);
  assert.ok(validaVarianti(Array(MAX_VARIANTI + 1).fill({ key: "a", label_i18n: { fr: "x" }, price_cents: 1 }), SEDE_UNICA).errore);
  assert.ok(validaVarianti("non una lista", SEDE_UNICA).errore);
  assert.deepEqual(validaVarianti(null, SEDE_UNICA).value, []);
});

test("l'admin di un punto non vede i formati degli altri", () => {
  assert.deepEqual(variantiVisibili(CARTA, sede(STOCKEL)).map((x) => x.key), ["30", "teglia"]);
  assert.deepEqual(variantiVisibili(CARTA, SEDE_UNICA).map((x) => x.key), ["30", "teglia", "gigante"]);
});

/* ============================================================
   LA FUSIONE — il punto piu' pericoloso del menu
   ============================================================ */

test("⚠️ salvare da un punto NON cancella i formati degli altri", () => {
  // L'admin di Stockel vede «30» e «teglia», non «gigante». Rimanda
  // indietro quei due: se li scrivessimo tal quali, la pizza gigante di
  // Jourdan sparirebbe dal database senza che nessuno l'abbia chiesta, e
  // nessuno se ne accorgerebbe fino a un ordine rifiutato.
  const chieste = [
    v({ key: "30", price_cents: 1300, location_id: null }),
    v({ key: "teglia", price_cents: 2500, location_id: STOCKEL }),
  ];
  const fuse = fondiVarianti(chieste, CARTA, sede(STOCKEL));
  assert.deepEqual(fuse.map((x) => x.key).sort(), ["30", "gigante", "teglia"]);
  // E le modifiche di Stockel sono passate.
  assert.equal(fuse.find((x) => x.key === "teglia").price_cents, 2500);
  assert.equal(fuse.find((x) => x.key === "gigante").price_cents, 3000);
});

test("⚠️ l'esaurito scritto nel piatto e' del GRUPPO e non si tocca da un punto", () => {
  // «Finito qui» vive in `menu_sold_out`. Scriverlo nel piatto vorrebbe dire
  // che Stockel, segnando finita la teglia, la toglie anche a chi la fa.
  const esistenti = [v({ key: "30", sold_out: true, location_id: null })];
  const chieste = [v({ key: "30", sold_out: false, location_id: null })];
  const fuse = fondiVarianti(chieste, esistenti, sede(STOCKEL));
  assert.equal(fuse[0].sold_out, true, "l'esaurito del gruppo e' stato sovrascritto da un punto");
});

test("togliere un formato dal proprio punto funziona ancora", () => {
  const fuse = fondiVarianti([v({ key: "30", location_id: null })], CARTA, sede(STOCKEL));
  assert.equal(fuse.some((x) => x.key === "teglia"), false, "non si riesce piu' a togliere un formato");
  assert.equal(fuse.some((x) => x.key === "gigante"), true, "e quello di Jourdan deve restare");
});

test("a sede unica la fusione non serve: si scrive quello che arriva", () => {
  const chieste = [v({ key: "30" })];
  assert.deepEqual(fondiVarianti(chieste, CARTA, SEDE_UNICA), chieste);
});

/* ============================================================
   LE RETI
   ============================================================ */

test("le regole del menu non leggono niente", () => {
  const src = readFileSync("src/lib/menuRegole.ts", "utf8");
  const importDiValore = [...src.matchAll(/^import (?!type )/gm)];
  assert.deepEqual(importDiValore, [], "menuRegole.ts ha cominciato a importare del codice");
});

test("le regole del menu esistono in un posto solo", () => {
  // ⚠️ Erano dentro il gestore dell'API, quindi non provabili e copiabili.
  const api = readFileSync("src/pages/api/admin/menu.ts", "utf8");
  for (const nome of ["validaVarianti", "variantiVisibili", "pulisciI18n"]) {
    assert.equal(
      new RegExp(`^function ${nome}\\(`, "m").test(api),
      false,
      `menu.ts ha di nuovo una sua copia di ${nome}`,
    );
  }
  assert.match(api, /fondiVarianti\(/, "il PUT non usa piu' la fusione comune");
});

test("il checkout filtra i formati per sede, non solo la vetrina", () => {
  // La vetrina che nasconde e la cassa che accetta sono lo stesso guasto
  // visto da due lati. Il filtro deve stare da tutte e due le parti.
  const checkout = readFileSync("src/pages/api/checkout.ts", "utf8");
  assert.match(checkout, /trovaVariante\([^)]*ambitoPub\)/s, "il checkout non passa la sede a trovaVariante");
  assert.match(checkout, /haVarianti\([^)]*ambitoPub\)/s);
});

/* ============================================================
   IL CARRELLO — fotografia, prezzo unitario, svuota
   ============================================================ */

/**
 * ⚠️ I siti dei clienti VESTONO `OrderApp` da fuori, attaccandosi alle classi
 * `order-*`. Il componente non si tocca: si configura e si veste. Quindi ogni
 * nodo nuovo dentro il carrello e' un cambio di aspetto su quattro siti in
 * produzione che per quelle classi il CSS non ce l'hanno — e `.order-cart-line-top`
 * e' un flex `space-between`: un terzo figlio non si aggiunge, sposta gli altri due.
 *
 * Per questo il di piu' sta dietro una prop SPENTA. Queste prove difendono la
 * prop, non la funzione: la funzione si vede a occhio, la prop no.
 */
const ORDERAPP = readFileSync("src/components/OrderApp.tsx", "utf8");

test("il carrello ricco e' spento finche' il sito non lo chiede", () => {
  assert.match(ORDERAPP, /carrelloDettagliato = false/,
    "la prop ha perso il default: i siti in produzione cambiano aspetto al merge");
  // Ogni pezzo nuovo passa dalla prop. Se un domani uno si sgancia, compare
  // da solo su tutti i clienti insieme.
  for (const pezzo of [
    /carrelloDettagliato && fotoPerId\.get\(l\.id\)/,
    /carrelloDettagliato && \(\s*<span className="order-cart-line-unit"/,
    /carrelloDettagliato && linee\.length > 0 \?/,
  ]) {
    assert.match(ORDERAPP, pezzo, "un pezzo del carrello ricco non passa piu' dalla prop");
  }
});

test("il prezzo unitario e' il prezzo unitario, non una divisione", () => {
  // ⚠️ `l.price_cents` E' gia' l'unitario del formato scelto: `prezzoRiga` lo
  // moltiplica per la quantita'. Dividere darebbe lo stesso numero oggi e un
  // numero sbagliato il giorno che nasce uno sconto per quantita'.
  assert.match(ORDERAPP, /order-cart-line-unit">\{euro\(l\.price_cents\)\}/);
  assert.doesNotMatch(ORDERAPP, /prezzoRiga\(l\)\s*\/\s*l\.qty/,
    "il prezzo unitario si ricava dividendo: regge oggi e mente domani");
});

test("la fotografia non lascia un buco quando non c'e'", () => {
  // Un riquadro vuoto dice «manca qualcosa», e il CSS del sito non ha modo di
  // distinguerlo da uno che sta caricando.
  assert.match(ORDERAPP, /fotoPerId\.get\(l\.id\) && \(/);
  // Il posto va riservato: senza, la riga salta quando la foto arriva.
  const img = ORDERAPP.match(/<img src=\{fotoPerId[^>]*>/);
  assert.ok(img, "l'immagine del carrello e' sparita");
  assert.match(img[0], /width="\d+"/);
  assert.match(img[0], /height="\d+"/);
  assert.match(img[0], /loading="lazy"/);
});

test("svuotare chiede conferma, con l'UNICO meccanismo che c'e' gia'", () => {
  // ⚠️ E' l'unico comando del carrello che distrugge tutto: un tocco per
  // sbaglio su un telefono costa l'ordine intero. Due meccanismi di conferma
  // diversi vorrebbero dire due tempi diversi e due modi di sbagliare.
  assert.match(ORDERAPP, /function clickSvuota\(\)\s*\{\s*chiediConferma\(TUTTO, \(\) => setLinee\(\[\]\)\)/);
  assert.match(ORDERAPP, /function clickRimuovi\(chiave: string\)\s*\{\s*chiediConferma\(/);
  const attese = [...ORDERAPP.matchAll(/setDaConfermare\(null\), 3000\)/g)];
  assert.equal(attese.length, 1, "il tempo di conferma e' scritto in piu' di un posto");
  // Lo svuota non deve poter partire al primo tocco.
  assert.doesNotMatch(ORDERAPP, /onClick=\{\(\) => setLinee\(\[\]\)\}/);
});

test("le due etichette nuove hanno un ripiego in tutte le lingue", () => {
  // ⚠️ Sono opzionali: i siti gia' in produzione non le passano. Senza
  // ripiego, a schermo comparirebbe `undefined` su tutti i clienti insieme.
  for (const lang of Object.keys(ETICHETTE_MENU)) {
    for (const k of Object.keys(ETICHETTE_MENU.fr)) {
      const v = ETICHETTE_MENU[lang][k];
      assert.ok(typeof v === "string" && v.trim(), `manca ${k} in ${lang}`);
    }
  }
  assert.ok(Object.keys(ETICHETTE_MENU.fr).includes("each"));
  assert.ok(Object.keys(ETICHETTE_MENU.fr).includes("clearAll"));
  // Una lingua che non esiste non lascia il buco: ripiega sul francese.
  assert.equal(etichettaMenu("clearAll", "de"), ETICHETTE_MENU.fr.clearAll);
  // E la parola del cliente vince su quella del motore.
  assert.equal(etichettaMenu("clearAll", "it", { clearAll: "Azzera" }), "Azzera");
});

/* ============================================================
   I FORMATI NEL MODALE — ogni riga porta il suo prezzo
   ============================================================ */

/**
 * ⚠️ IL GUASTO: la prima riga faceva da riferimento e le altre mostravano la
 * DIFFERENZA, con `euroDelta(0) === ""`. Due formati allo stesso prezzo e il
 * secondo restava SENZA PREZZO — l'etichetta sola, il posto del numero vuoto.
 * Il cliente non legge «stesso prezzo»: legge «prezzo mancante», e sul dubbio
 * non ordina. Nessun errore, nessun log: solo un ordine che non arriva.
 *
 * Queste prove leggono il SORGENTE (qui non c'e' un DOM da montare), e
 * difendono l'invariante che conta: il prezzo mostrato per un formato non
 * dipende da nessun ALTRO formato.
 */

/** Via i commenti: una rete non deve leggere le frasi che la descrivono —
 *  qui il commento del modale NOMINA `euroDelta(0)` per spiegare il guasto. */
const ORDERAPP_CODICE = ORDERAPP
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n")
  .filter((r) => !/^\s*(\/\/|\*)/.test(r))
  .join("\n");

/** Il corpo del modale, dal `map` dei formati alla sua chiusura. */
function modaleVarianti() {
  const i = ORDERAPP.indexOf("function ModaleVarianti()");
  assert.ok(i > 0, "ModaleVarianti e' sparita: rete da aggiornare");
  const j = ORDERAPP.indexOf("\n  function ", i + 10);
  return ORDERAPP.slice(i, j > 0 ? j : undefined);
}

test("nel modale ogni formato mostra il SUO prezzo pieno", () => {
  const M = modaleVarianti();
  assert.match(M, /order-modal-variant-price[\s\S]{0,400}?euro\(v\.price_cents\)/,
    "il prezzo del formato non e' piu' il suo");
  // ⚠️ L'invariante: nessun riferimento a un'altra riga dentro il prezzo.
  assert.doesNotMatch(M, /price_cents\s*-\s*base\./, "e' tornata la differenza dalla prima riga");
  assert.doesNotMatch(M, /\bisBase\b/, "e' tornato un formato privilegiato");
  assert.doesNotMatch(M, /\bdelta\b/, "e' tornata la differenza");
});

test("due formati allo stesso prezzo mostrano tutt'e due il prezzo", () => {
  // La prova dello zero, quella che ha fatto nascere il lavoro: non c'e' piu'
  // nessuna funzione che renda "" per una differenza nulla.
  assert.doesNotMatch(ORDERAPP_CODICE, /function euroDelta/,
    "euroDelta e' tornata: una differenza di zero diventa una riga senza prezzo");
  assert.doesNotMatch(ORDERAPP_CODICE, /euroDelta\(/);
  // E il prezzo non passa da nessuna condizione: si scrive sempre.
  const M = modaleVarianti();
  const span = M.match(/<span className="order-modal-variant-price">[\s\S]*?<\/span>/);
  assert.ok(span, "il posto del prezzo e' sparito dal modale");
  assert.doesNotMatch(span[0], /\?/, "il prezzo del formato passa da una condizione");
});

test("lo sconto si vede nel modale come nelle pastiglie", () => {
  // ⚠️ C'era solo nelle pastiglie: lo stesso formato in promozione si vedeva
  // scontato da una parte e a prezzo pieno dall'altra.
  const M = modaleVarianti();
  assert.match(M, /original_price_cents && \(\s*<s className="order-item-old">\{euro\(v\.original_price_cents\)\}<\/s>/,
    "nel modale il prezzo barrato non c'e'");
  // Stessa classe delle pastiglie: nessun CSS nuovo da scrivere per i clienti.
  const pastiglie = ORDERAPP.match(/order-item-var-pr[\s\S]{0,600}?<\/span>/);
  assert.ok(pastiglie, "le pastiglie sono sparite: rete da aggiornare");
  assert.match(pastiglie[0], /order-item-old/);
});

/* ============================================================
   IL FORMATO NELLA RIGA DI CARRELLO — due elementi, non un testo
   ============================================================ */

/**
 * ⚠️ La riga salvava un testo unico, «Piatto — Formato», dentro un solo
 * `<span>`. Un sito che vuole il formato come pastiglia sotto il nome non puo'
 * ricavarlo: il CSS un testo non lo divide. E ricavarlo in JS spezzando sul
 * trattino romperebbe, in silenzio, ogni piatto che un trattino ce l'ha nel
 * nome.
 */

test("la riga porta il nome e il formato separati, e ANCHE il testo unico", () => {
  // ⚠️ `name` non si tocca: e' quello che vede chi non ha il carrello
  // dettagliato, ed e' quello gia' salvato nei carrelli aperti.
  assert.match(ORDERAPP, /name: `\$\{nomeVisto\} — \$\{etichettaVariante\(v, lang\)\}`/,
    "il testo unico e' sparito: i carrelli gia' aperti restano senza nome");
  assert.match(ORDERAPP, /base_name: nomeVisto/);
  assert.match(ORDERAPP, /variant_label: etichettaVariante\(v, lang\)/);
  // E i due campi sono OPZIONALI: una riga vecchia non li ha.
  assert.match(ORDERAPP, /base_name\?: string;/);
  assert.match(ORDERAPP, /variant_label\?: string;/);
});

test("il formato si stacca solo quando c'e' davvero, e non si ricava spezzando il nome", () => {
  const riga = ORDERAPP.slice(
    ORDERAPP.indexOf('<div className="order-cart-line-top">'),
    ORDERAPP.indexOf('<div className="order-cart-line-controls">'),
  );
  assert.ok(riga.length > 100, "la riga di carrello e' cambiata: rete da aggiornare");
  // Due elementi quando il formato c'e'...
  assert.match(riga, /order-cart-line-name">\{l\.base_name\}/);
  assert.match(riga, /order-cart-line-variant">\{l\.variant_label\}/);
  // ...e la ricaduta sul testo unico quando non c'e' (carrelli gia' aperti,
  // o piatto a prezzo unico): altrimenti la riga resterebbe senza nome.
  assert.match(riga, /order-cart-line-name">\{l\.name\}/);
  assert.match(riga, /carrelloDettagliato && l\.base_name && l\.variant_label \?/);
  // ⚠️ Mai ricavare il formato spezzando il nome sul trattino.
  assert.doesNotMatch(ORDERAPP, /\.split\("\s*—\s*"\)/, "il formato si ricava spezzando il nome");
});

test("la classe nuova e' scritta dove la cerca chi veste il carrello", () => {
  // Una classe che il motore emette e nessuno documenta e' una classe che
  // resta senza stile finche' qualcuno non la scopre guardando il DOM.
  const prop = ORDERAPP.slice(
    ORDERAPP.indexOf("carrelloDettagliato?: boolean") - 1600,
    ORDERAPP.indexOf("carrelloDettagliato?: boolean"),
  );
  for (const c of [
    "order-cart-line-foto", "order-cart-line-unit", "order-cart-line-variant",
    "order-recap-testa", "order-recap-conta", "order-recap-svuota",
  ]) {
    assert.ok(prop.includes(c), `la classe ${c} non e' documentata sulla prop`);
  }
});
