/**
 * LA COLONNA «AUJOURD'HUI» — gli orari, il grafico, la scheda Google.
 *
 * ⚠️ PERCHE' QUESTE PROVE ESISTONO. Questa colonna non si rompe mai in modo
 * visibile: le barre escono comunque, il numero c'e' comunque, la pastiglia e'
 * colorata comunque. Sbaglia in silenzio — un righello storto, una percentuale
 * calcolata su mezzo periodo, «Non disponibile» col vestito di «Fermé» — e chi
 * guarda non ha nessun modo di accorgersene, perche' non ha un secondo posto
 * dove controllare.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  fasce, statoGiorno, oreAperte, grafico, altezza, picco, oraDi, quanto,
} from "../src/lib/admin/giornataRegole.ts";
import { stelle, stellePiene, linkRecensioni, variazione, controllaPlaceId } from "../src/lib/admin/googleRegole.ts";

const HOME = readFileSync("src/pages/admin/index.astro", "utf8");
const FASCIA = readFileSync("src/components/admin/home/Giornata.astro", "utf8");

const APERTO = {
  lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
  dinner_active: true, dinner_open: "18:30:00", dinner_close: "22:30:00",
};

// ============================================================
// GLI ORARI DI OGGI
// ============================================================
test("le fasce si scrivono senza i secondi del database", () => {
  assert.deepEqual(fasce(APERTO), ["12:00 – 14:30", "18:30 – 22:30"]);
  // Un servizio spento non e' una fascia, e mezza fascia (apertura senza
  // chiusura) non si stampa: «18:30 – » non e' un orario.
  assert.deepEqual(fasce({ ...APERTO, lunch_active: false }), ["18:30 – 22:30"]);
  assert.deepEqual(fasce({ dinner_active: true, dinner_open: "18:30" }), []);
});

test("«non lo sappiamo» non e' «chiuso»", () => {
  // ⚠️ IL GUASTO: la pastiglia diceva «Non disponibile» col vestito di
  // «Fermé» (corallo). Un locale aperto, con l'API lenta o caduta, si vedeva
  // CHIUSO sulla propria Accueil — e non c'era niente che dicesse il
  // contrario.
  assert.equal(statoGiorno(null), "ignoto");
  assert.equal(statoGiorno(undefined), "ignoto");
  assert.equal(statoGiorno({}), "chiuso");
  assert.equal(statoGiorno(APERTO), "aperto");
  assert.match(HOME, /pil\.classList\.toggle\("off", stato === "chiuso"\)/,
    "la pastiglia si colora di nuovo di «chiuso» anche quando non sa");
  assert.match(HOME, /pil\.classList\.toggle\("n", stato === "ignoto"\)/,
    "lo stato ignoto non ha piu' una pastiglia neutra");
});

test("l'ultima ora conta solo se si chiude dopo", () => {
  // Chiudendo alle 22:00 le 22 non sono un'ora di servizio: una colonna vuota
  // in fondo al grafico fa sembrare che la serata sia andata male.
  assert.deepEqual(oreAperte({ dinner_active: true, dinner_open: "18:00", dinner_close: "22:00" }), [18, 19, 20, 21]);
  assert.deepEqual(oreAperte({ dinner_active: true, dinner_open: "18:00", dinner_close: "22:30" }), [18, 19, 20, 21, 22]);
  assert.deepEqual(oreAperte(null), []);
  assert.deepEqual(oreAperte(APERTO), [12, 13, 14, 18, 19, 20, 21, 22]);
});

// ============================================================
// IL RIGHELLO DEL GRAFICO
// ============================================================
const serieDi = (oggi, solito) => [
  { ore: oggi, classe: "cov oggi" },
  { ore: solito, classe: "cov" },
];

test("il grafico non si disegna quando non c'e' niente da dire", () => {
  // ⚠️ Barre tutte a zero su un asse disegnato sono un grafico che chiede di
  // essere guardato e non dice niente.
  assert.equal(grafico([], [12, 13]), null);
  assert.equal(grafico(serieDi({}, {}), []), null);
  assert.equal(grafico(serieDi({ 19: 0 }, { 19: 0 }), [19]), null);
});

test("una prenotazione fuori orario resta nel grafico", () => {
  // ⚠️ La finestra non e' l'orario di apertura: e' l'orario PIU' le ore che
  // hanno un numero. Tagliando via il fuori orario sparisce proprio il caso
  // che varrebbe la pena di guardare.
  const g = grafico(serieDi({ 23: 4 }, {}), [18, 19, 20]);
  assert.equal(g.da, 18);
  assert.equal(g.a, 23);
  // Le ore vuote in mezzo restano: una giornata con un buco e' una giornata
  // con un buco, non una giornata piu' corta.
  assert.deepEqual(g.ore, [18, 19, 20, 21, 22, 23]);
});

test("il soffitto e' un numero tondo, e la meta' si scrive solo se e' intera", () => {
  const g = grafico(serieDi({ 19: 7.3 }, {}), [19]);
  assert.equal(g.cima, 8, "il soffitto non e' arrotondato in su: l'etichetta direbbe «7,3»");
  assert.equal(g.meta, 4);
  assert.equal(g.metaScritta, true);
  const g2 = grafico(serieDi({ 19: 5 }, {}), [19]);
  assert.equal(g2.cima, 5);
  assert.equal(g2.metaScritta, false, "«2,5 coperti» non e' una quantita' che qualcuno conta");
});

test("barre e linee si misurano con lo STESSO righello", () => {
  // ⚠️ Una linea disegnata al 50% e una barra calcolata sul soffitto sono due
  // righelli sullo stesso grafico, e il secondo dice una cosa falsa.
  assert.equal(altezza(10, 10), 96, "la barra piu' alta tocca il soffitto del riquadro");
  assert.equal(altezza(5, 10), 48);
  assert.equal(altezza(0, 10), 0);
  assert.equal(altezza(3, 0), 0, "senza soffitto non si divide per zero");
});

test("l'ora di punta: la prima a parita', e nessuna quando non c'e' nessuno", () => {
  assert.equal(picco({ 12: 2, 19: 6, 20: 6 }), 19, "a parita' deve vincere l'ora in cui comincia la spinta");
  assert.equal(picco({}), null);
  assert.equal(picco({ 12: 0 }), null, "zero coperti non sono un'ora di punta");
});

test("un'ora a una cifra non fa sparire la prenotazione", () => {
  // ⚠️ IL GUASTO CHE QUESTA PROVA TIENE CHIUSO: con `slice(0, 2)`, «9:30»
  // diventava «9:» e quindi NaN — e quella prenotazione spariva dal grafico
  // senza che niente lo dicesse. Le ore di una cifra sono il pranzo.
  assert.equal(oraDi("9:30"), 9);
  assert.equal(oraDi("19:30"), 19);
  assert.equal(oraDi("19:30:00"), 19);
  assert.equal(oraDi(""), -1);
  assert.equal(oraDi(null), -1);
  assert.equal(oraDi("25:00"), -1);
  assert.equal(quanto({ ore: { 19: 3 }, classe: "" }, 19), 3);
  assert.equal(quanto({ ore: {}, classe: "" }, 19), 0);
  // ⚠️ Chi disegna le barre e chi calcola le medie devono leggere l'ora allo
  // stesso modo: `affluenzaRegole` (server, con luxon) riprende questa, e non
  // se ne scrive una sua — altrimenti sono due grafici che non si parlano.
  const AFF = readFileSync("src/lib/admin/affluenzaRegole.ts", "utf8");
  assert.match(AFF, /export \{ oraDi \} from "\.\/giornataRegole"/,
    "l'ora di una prenotazione e' tornata ad avere due letture");
  assert.doesNotMatch(HOME, /from "\.\.\/\.\.\/lib\/admin\/affluenzaRegole"/,
    "la Accueil importa un file che porta luxon dentro il browser");
});

// ============================================================
// LA SCHEDA GOOGLE
// ============================================================
test("le stelle si contano allo stesso modo nei due schermi", () => {
  // ⚠️ IL GUASTO: la Accueil arrotondava (4,7 → cinque piene) e la pagina
  // Google troncava (4,7 → quattro). Lo stesso locale, due giudizi diversi a
  // due clic di distanza.
  assert.equal(stellePiene(4.7), 5);
  assert.equal(stellePiene(4.4), 4);
  assert.equal(stellePiene(0), 0);
  assert.equal(stellePiene(9), 5, "un voto impossibile non disegna nove stelle");
  assert.equal(stellePiene("ciao"), 0);
  assert.equal(stelle(4.4), "★★★★☆");
  assert.equal(stelle(5), "★★★★★");
  const GOOGLE = readFileSync("src/pages/admin/google.astro", "utf8");
  assert.match(GOOGLE, /stellePiene/, "la pagina Google si conta di nuovo le stelle da sola");
});

test("un link che non porta da nessuna parte non si mostra", () => {
  assert.equal(linkRecensioni({ reviews_url: "https://x/avis", maps_url: "https://x" }), "https://x/avis");
  assert.equal(linkRecensioni({ maps_url: "https://x" }), "https://x", "senza l'elenco si ripiega sulla scheda");
  assert.equal(linkRecensioni({}), null);
  assert.equal(linkRecensioni(null), null);
  assert.doesNotMatch(HOME, /maps\.href = g\.reviews_url \|\| g\.maps_url \|\| "#"/,
    "il link torna a puntare a «#»: si clicca, non succede niente, e non si clicca piu'");
});

test("una percentuale vuole due periodi interi", () => {
  // ⚠️ IL GUASTO: si sommavano «gli ultimi 30 punti» e «i 30 prima»,
  // qualunque cosa fosse arrivata. Con 40 giorni di storia il secondo periodo
  // erano 10 giorni, e la Accueil scriveva «+180 %» confrontando un mese con
  // una settimana e mezza — un numero inventato con l'aria di un numero vero.
  const punti = (n, v) => Array.from({ length: n }, (_, i) => ({
    date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    value: v,
  }));
  const corto = variazione(punti(40, 1));
  assert.equal(corto.ultimi, 30);
  assert.equal(corto.diff, null, "con meno di due periodi interi la percentuale si inventa");

  const pieno = variazione([...punti(30, 1), ...punti(30, 2).map((p, i) => ({ ...p, date: `2026-05-${String(i + 1).padStart(2, "0")}` }))]);
  assert.equal(pieno.ultimi, 60, "30 giorni a 2 = 60");
  assert.equal(pieno.diff, 100, "da 30 a 60 e' il doppio");

  assert.equal(variazione([]), null);
  assert.equal(variazione(null), null);
  // Periodo precedente a zero: non si divide per zero e non si scrive «+∞».
  assert.equal(variazione([...punti(30, 0), ...punti(30, 5).map((p, i) => ({ ...p, date: `2026-05-${String(i + 1).padStart(2, "0")}` }))]).diff, null);
});

test("i punti si ordinano prima di sommarli", () => {
  // Arrivano da un'API: l'ordine non e' garantito, e «gli ultimi trenta» di
  // una lista disordinata sono trenta giorni a caso.
  const a = { date: "2026-01-01", value: 1 };
  const b = { date: "2026-01-02", value: 10 };
  assert.equal(variazione([b, a], 1).ultimi, 10, "l'ultimo giorno non e' quello con la data piu' alta");
});

// ============================================================
// LA COLONNA NEL MARKUP
// ============================================================
test("la colonna di oggi usa i componenti del pannello", () => {
  assert.match(FASCIA, /class="btn btn-sm btn-primary j-rbtn"/, "«Rispondi» non e' piu' il bottone pieno condiviso");
  assert.match(FASCIA, /class="ibtn ibtn-sm ibtn-scuro" id="j-g-prev"/,
    "le frecce del carosello sono tornate due bottoni disegnati a mano");
  // ⚠️ Un disegno, non «‹ ›»: una freccia di testo si centra come una lettera.
  assert.doesNotMatch(FASCIA, /id="j-g-(prev|next)"[^>]*>[‹›]/, "le frecce sono tornate due caratteri");
  assert.match(FASCIA, /class="spx-b j-rep"/, "la pastiglia della risposta non ha piu' la forma delle altre");
  const nudo = HOME.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(nudo, /\.j-arrows button\s*\{/, "le frecce hanno di nuovo un vestito loro");
  assert.doesNotMatch(nudo, /\.j-rbtn\s*\{[^}]*background/, "«Rispondi» si e' riscritto il fondo corallo");
});

test("il conto degli orari e del grafico non torna dentro la pagina", () => {
  // ⚠️ E' la prova che tiene isolata la colonna: finche' la matematica sta in
  // `giornataRegole.ts` si puo' provare senza un browser. Il giorno che
  // qualcuno la riscrive dentro lo `<script>` «perche' era una riga sola», si
  // ricomincia a scoprire i grafici storti guardandoli.
  assert.match(HOME, /from "\.\.\/\.\.\/lib\/admin\/giornataRegole"/, "la Accueil non prende piu' il conto dal modulo");
  assert.match(HOME, /from "\.\.\/\.\.\/lib\/admin\/googleRegole"/, "la Accueil non prende piu' le regole di Google dal modulo");
  const nudo = HOME.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(nudo, /function fasce\(/, "le fasce sono tornate a calcolarsi dentro la pagina");
  assert.doesNotMatch(nudo, /Math\.ceil\(max\)/, "il soffitto del grafico e' tornato dentro la pagina");
});

test("quando si e' chiusi, la colonna dice fino a quando", () => {
  // ⚠️ `caricaToday` cerca la prossima apertura fino a tre settimane avanti, a
  // ogni caricamento della Accueil — e non la leggeva nessuno: un conto fatto
  // ogni volta per niente, mentre la colonna di un lunedi' di chiusura diceva
  // «Fermé» senza dire fino a quando.
  assert.match(HOME, /stato === "chiuso" && jt\?\.reopen/, "la riapertura non si mostra piu'");
  assert.match(HOME, /home\.reopen/, "sparita la parola «Riapertura»");
});

test("Google che non risponde non e' Google che non c'e'", () => {
  // ⚠️ IL GUASTO DI 450 GRADI, 08/10/2026. Tre sedi: il voto si vedeva per
  // Schaerbeek e Stockel, e su Jourdan compariva e spariva. Dallo schermo non
  // c'era modo di capire perche', e il motivo l'API lo mandava gia': quando
  // Google rifiuta la scheda rende `configured: true` con un messaggio, e la
  // Accueil trattava quel caso come «nessuna scheda configurata» — cioe'
  // nascondeva tutto, messaggio compreso.
  //
  // I due casi ora si separano: senza scheda il blocco se ne va (non c'e'
  // niente da dire), con la scheda e Google che rifiuta il blocco RESTA e dice
  // cosa e' successo — un 404 vuol dire che quel Place ID non e' di quella
  // sede, ed e' una cosa che si va a correggere.
  assert.match(HOME, /if \(!g\.configured\) \{ soloOrari\(\); return; \}/,
    "il caso «nessuna scheda» non e' piu' distinto: o sparisce tutto o resta un blocco vuoto");
  assert.match(HOME, /g\.rating == null[\s\S]{0,400}?guastoGoogle\(/,
    "Google che rifiuta fa di nuovo sparire il blocco: il motivo non arriva piu' a nessuno");
  // E il motivo deve esserci davvero: senza il codice (404 · 403 · 429) resta
  // «non disponibile», che su tre sedi non dice da che parte cominciare.
  const API = readFileSync("src/pages/api/admin/google-info.ts", "utf8");
  assert.match(API, /motivo/, "l'API non manda piu' il motivo del rifiuto di Google");
  assert.match(API, /console\.error\("\[google-info\]"/,
    "il rifiuto di Google non lascia piu' traccia nei log del server");
  // ⚠️ E le due ASSENZE non sono la stessa assenza: «nessun Place ID per
  // questo punto» si risolve in Réglages in trenta secondi, «manca la chiave
  // Places sull'ambiente» e' una variabile del server e dall'admin non si
  // risolve affatto. Lo schermo tace in tutti e due i casi — per il
  // ristoratore e' giusto — ma la risposta deve dire quale delle due, se no
  // l'unico modo di saperlo e' indovinare.
  assert.match(API, /motivo: "no-key"/, "la chiave Places assente non si distingue piu' dal Place ID mancante");
  assert.match(API, /motivo: "no-place"/, "il Place ID mancante non si distingue piu' dalla chiave assente");
});

test("un Place ID scritto male si riconosce, e si dice COME e' sbagliato", () => {
  // ⚠️ Tre risposte e non un sì/no: i due rifiuti si riparano in modi
  // diversi. «E' una chiave API» vuol dire che quella stringa va nel `.env` e
  // che il Place ID e' un'altra cosa — ed e' L'ERRORE TIPICO, chi configura ha
  // le due stringhe aperte nella stessa pagina di Google Cloud.
  assert.equal(controllaPlaceId("ChIJrTLr-GyuEmsRBfy61i59si0"), "ok");
  assert.equal(controllaPlaceId("AIzaSyD-ExampleKeyNotAPlaceId"), "chiave");
  assert.equal(controllaPlaceId("ChIJ abc"), "formato");
  assert.equal(controllaPlaceId("https://maps.google.com/?cid=123"), "formato");
  // ⚠️ Il VUOTO va bene: vuol dire «togli il Place ID», ed e' una cosa che si
  // deve poter fare — un campo che non si puo' svuotare e' un dato che non si
  // puo' correggere.
  assert.equal(controllaPlaceId(""), "ok");
  assert.equal(controllaPlaceId("   "), "ok");
  assert.equal(controllaPlaceId(null), "ok");
});

test("a sede unica il Place ID ha un posto dove essere messo", () => {
  // ⚠️ IL BUCO TROVATO SU BROS, 09/10/2026. Il 15/09 il Place ID e' passato
  // dall'installazione alla scheda della sede — giusto: identifica UN
  // esercizio fisico. Ma a sede unica la scheda della sede NON ESISTE, e da
  // quel giorno un cliente nuovo non ha piu' avuto nessun posto dove metterlo:
  // in Integrations si legge «CONNESSO» (che e' il livello 2, OAuth, un'altra
  // cosa) e il blocco Google della Accueil non compare mai. Lo stesso buco,
  // lo stesso giorno, aveva colpito la scelta della scheda: il rimedio fu
  // `#g-unica`, e questo e' il suo gemello.
  const SUP = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.match(SUP, /id="g-place-unica"/, "a sede unica il Place ID non si puo' piu' impostare da nessuna parte");
  assert.match(SUP, /g-place-unica[\s\S]{0,600}?id="g-place"/, "manca il campo del Place ID");
  assert.match(SUP, /gPlaceBox\.style\.display = sedi\.length > 0 \? "none" : "block"/,
    "il campo non si accende piu' solo a sede unica: con piu' sedi il posto giusto e' la scheda del punto");
  // ⚠️ Il campo deve comparire anche senza OAuth: il Place ID e' il livello 1
  // e non dipende dal collegamento a Google Business — era proprio la
  // confusione che su BROS faceva leggere «connesso» e non mostrare niente.
  assert.doesNotMatch(SUP, /connected && !conSedi[\s\S]{0,200}?g-place-unica/,
    "il campo del Place ID e' tornato a dipendere dal collegamento OAuth");
  // ⚠️ E il server NON si mette a decidere «e' multi-sede?»: Integrations non
  // importa niente da `admin/sede` — e' la difesa strutturale per cui il
  // selettore dell'header non puo' arrivarci (vedi superadmin.test.mjs).
  // Chi decide dove va il Place ID e' chi disegna il campo. Quello che il
  // server fa e' controllare come e' SCRITTO, con la stessa regola dell'altro
  // posto che lo scrive.
  const API = readFileSync("src/pages/api/admin/integrations.ts", "utf8");
  const LOC = readFileSync("src/pages/api/admin/locations.ts", "utf8");
  for (const [nome, src] of [["integrations", API], ["locations", LOC]]) {
    assert.match(src, /controllaPlaceId\(/,
      `${nome}: il Place ID si controlla con una regola sua invece di quella condivisa`);
    assert.doesNotMatch(src, /\[A-Za-z0-9_-\]\+/,
      `${nome}: la regex del Place ID e' tornata nel file — due copie, e la seconda resta indietro`);
  }
});
