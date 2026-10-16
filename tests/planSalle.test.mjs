/**
 * IL PIANO DI SALA — nome e posto di un tavolo nuovo.
 *
 * Il difetto, trovato il 07/10/2026 guardando una mappa: nome e posizione
 * venivano dal CONTEGGIO dei tavoli (`slTavoli.length`). Finche' si aggiunge e
 * basta funziona. Basta cancellarne uno in mezzo e il conto torna indietro:
 * il tavolo dopo nasce con un nome gia' usato, esattamente sopra un tavolo che
 * c'e' gia'. Nessun errore, nessun test rosso — due riquadri sovrapposti e due
 * «T6» in una sala, che si vedono solo se qualcuno apre quella mappa.
 *
 * Qui si guarda il SORGENTE, perche' quel codice vive in uno <script> di
 * settings.astro e non si puo' importare. Si prova che il conteggio non sia
 * tornato, e che le due funzioni che cercano il posto libero ci siano.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { orfaniDelPiano, tavoliDelPiano } from "../src/lib/pianoSalaRegole.ts";

const SET = readFileSync("src/pages/admin/settings.astro", "utf8");
/** Il blocco che crea un tavolo nuovo. */
const BLOCCO = SET.slice(SET.indexOf('".sl-add:not(.sl-decor-add)"'), SET.indexOf('".sl-add:not(.sl-decor-add)"') + 1200);

test("un tavolo nuovo non prende nome e posto dal conteggio", () => {
  assert.ok(BLOCCO, "il bottone che aggiunge un tavolo non si trova piu': il test guarda la parte sbagliata");
  assert.doesNotMatch(BLOCCO, /slTavoli\.length/,
    "il tavolo nuovo torna a contare i tavoli: cancellandone uno, il prossimo nasce sopra un altro e con un nome gia' preso");
  assert.match(BLOCCO, /slNomeLibero\(/, "il nome non si cerca piu' fra quelli liberi");
  assert.match(BLOCCO, /slPostoLibero\(/, "il posto non si cerca piu' fra quelli liberi");
});

test("le due funzioni guardano DAVVERO cosa c'e' gia'", () => {
  // ⚠️ Una `slNomeLibero` che rendesse sempre «T1» passerebbe il test di
  // sopra e rifarebbe il difetto. Qui si chiede che leggano `slTavoli`.
  const nome = SET.slice(SET.indexOf("function slNomeLibero("), SET.indexOf("function slNomeLibero(") + 400);
  assert.match(nome, /slTavoli\.map\(\(t\) => t\.name\)/, "slNomeLibero non guarda i nomi gia' usati");

  const posto = SET.slice(SET.indexOf("function slPostoLibero("), SET.indexOf("function slPostoLibero(") + 600);
  assert.match(posto, /slTavoli\.some\(/, "slPostoLibero non guarda dove stanno gli altri tavoli");
});

/* ==================================================================
   I TAVOLI CHE RESTANO QUANDO UNA SECTION SPARISCE

   ⚠️ Le sections stanno in `app_config` e i tavoli in una tabella: niente
   tiene insieme le due cose. Salvare i Réglages riscrive `reservation_zones`
   e non guarda `restaurant_tables`, quindi cancellare o RINOMINARE una
   section lascia i suoi tavoli agganciati a una zona che non esiste piu'.
   Il piano di sala non li mostra (chiede sempre una zona alla volta) e
   nessuno se ne accorge. Il 16/10/2026 si sono visti dall'altra parte: un
   selettore con ventuno quadrati per diciannove tavoli, due «T1».
   ================================================================== */

const SEZIONI = JSON.stringify([{ name: "Interno", seats: 14 }, { name: "Terrazzo", seats: 16 }]);

test("i tavoli di una section sparita si contano, raggruppati per zona", () => {
  const righe = [
    { id: "a", name: "T1", zone: "Interno" },
    { id: "b", name: "T1", zone: "Sala vecchia" },
    { id: "c", name: "T2", zone: "Sala vecchia" },
    { id: "d", name: "X1", zone: "Veranda" },
  ];
  assert.deepEqual(orfaniDelPiano(righe, SEZIONI), [
    { zone: "Sala vecchia", tavoli: 2 },
    { zone: "Veranda", tavoli: 1 },
  ]);
});

test("nessuna section configurata: nessun orfano, mai", () => {
  // ⚠️ Il caso che non deve MAI diventare «cancella tutto»: senza un elenco
  // di sections non esiste un «fuori dall'elenco». Un locale che non ha mai
  // aperto quei Réglages si vedrebbe proporre di svuotare la propria sala.
  const righe = [{ id: "a", name: "1", zone: "Salle" }, { id: "b", name: "2", zone: "Salle" }];
  assert.deepEqual(orfaniDelPiano(righe, "[]"), []);
  assert.deepEqual(orfaniDelPiano(righe, ""), []);
  assert.deepEqual(orfaniDelPiano(righe, "{non e' json"), []);
  assert.deepEqual(orfaniDelPiano(righe, null), []);
});

test("orfani e tavoli veri sono due insiemi che non si toccano", () => {
  // La stessa lettura, divisa dalla stessa regola: quello che il QR mostra
  // e quello che i Réglages propongono di cancellare non possono sovrapporsi.
  const righe = [
    { id: "a", name: "T1", zone: "Interno" },
    { id: "b", name: "T1", zone: "Sala vecchia" },
    { id: "c", name: "F1", zone: "Terrazzo" },
  ];
  const veri = tavoliDelPiano(righe, SEZIONI).map((t) => t.zone);
  const persi = orfaniDelPiano(righe, SEZIONI).map((o) => o.zone);
  assert.equal(veri.filter((z) => persi.includes(z)).length, 0);
  assert.equal(veri.length + orfaniDelPiano(righe, SEZIONI).reduce((n, o) => n + o.tavoli, 0), righe.length);
});

test("righe assenti o malformate non diventano orfani", () => {
  assert.deepEqual(orfaniDelPiano(null, SEZIONI), []);
  assert.deepEqual(orfaniDelPiano("boh", SEZIONI), []);
  assert.deepEqual(orfaniDelPiano([{ id: "a", name: "T1", zone: "" }, null], SEZIONI), []);
});

test("l'avviso dei tavoli orfani nasce nascosto e lo accende il salvataggio", () => {
  /* Che `hidden` vinca su `.field { display: flex }` lo garantisce
     AdminHead per tutte le pagine (vedi motore.test.mjs): qui si controlla
     solo che l'avviso nasca spento e che la pagina legga il conto. */
  assert.match(SET, /<div class="field field-orfani" id="r-orfani" hidden>/,
    "l'avviso nascerebbe acceso, anche a zero orfani");
  assert.match(SET, /mostraOrfani\(json\.tavoli_orfani\)/,
    "la pagina non legge piu' il conto che il salvataggio le manda");
  // La cancellazione non manda id: quali siano lo ricalcola il server.
  assert.match(SET, /"\/api\/admin\/tables\?orphans=1"/);
  assert.doesNotMatch(SET, /orphans=1[^"]*id=/,
    "la pulizia manda degli id: una lista vecchia cancellerebbe tavoli vivi");
});

test("il server e' l'unico che decide chi e' orfano", () => {
  const api = readFileSync("src/pages/api/admin/tables.ts", "utf8");
  assert.match(api, /orfaniDelPiano\(righe\.data \?\? \[\], cfg\.valori\.get\("reservation_zones"\)/,
    "la pulizia non ricalcola piu' gli orfani al momento della cancellazione");
  // ⚠️ Area, liaisons e decori sono mappe { zona: … }: lasciarle vuol dire
  // ritrovarsele addosso il giorno in cui una section rinasce con quel nome.
  for (const k of ["reservation_plan_areas", "reservation_plan_links", "reservation_plan_decor"]) {
    assert.ok(api.includes(`salvaMappa("${k}", z, null, ambito)`),
      `la pulizia lascia ${k} della zona cancellata`);
  }
});
