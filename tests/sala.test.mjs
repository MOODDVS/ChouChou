/**
 * LA SALA — i test del comportamento, non dell'impianto.
 *
 * `tests/sede.test.mjs` controlla che le tabelle della sala si filtrino per
 * sede. E' l'impianto, ed e' necessario. Ma non dice NIENTE su cosa succede
 * davvero quando arriva una prenotazione da sei persone e i tavoli da sei
 * sono occupati.
 *
 * Qui si prova il comportamento: quale tavolo tocca a chi, quali sezioni si
 * riempiono prima, cosa succede con una zona chiusa. E' l'unico punto del
 * progetto dove un errore non e' un numero storto su uno schermo — e' gente
 * in piedi sulla porta il sabato sera, o un tavolo vuoto tenuto per uno che
 * non arrivera'.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { scegliCombinazione, capienzaDelleZone, zoneDaConfig } from "../src/lib/salaRegole.ts";

/** Una sala di prova: due sezioni, tavoli di misure diverse. */
const SALA = [
  { id: "d1", zone: "Dehors", name: "D1", seats: 2 },
  { id: "d2", zone: "Dehors", name: "D2", seats: 2 },
  { id: "d3", zone: "Dehors", name: "D3", seats: 2 },
  { id: "s1", zone: "Salle", name: "S1", seats: 4 },
  { id: "s2", zone: "Salle", name: "S2", seats: 6 },
];
/** Catene di tavoli accostabili, per sezione. */
const LEGAMI = { Dehors: [["d1", "d2", "d3"]] };
const nessuno = new Set();

const scegli = (opz = {}) =>
  scegliCombinazione(
    opz.tavoli ?? SALA,
    opz.legami ?? LEGAMI,
    opz.occupati ?? nessuno,
    opz.zonaPref ?? null,
    opz.zoneChiuse ?? [],
    opz.people,
    opz.priorita ?? [],
  );

/* ============================================================
   Il criterio: meno posti sprecati, poi meno tavoli
   ============================================================ */

test("due persone prendono un tavolo da due, non quello da sei", () => {
  const r = scegli({ people: 2 });
  assert.equal(r.ids.length, 1);
  assert.equal(SALA.find((t) => t.id === r.ids[0]).seats, 2);
});

test("cinque persone prendono il tavolo da sei, non due accostati", () => {
  // Due tavoli da 2 accostati fanno 4: non bastano. Tre fanno 6, come S2,
  // ma S2 e' UN tavolo solo — a parita' di posti sprecati vince chi ne usa meno.
  const r = scegli({ people: 5 });
  assert.deepEqual(r.ids, ["s2"]);
  assert.equal(r.zone, "Salle");
});

test("sei persone fuori accostano tre tavoli da due", () => {
  const r = scegli({ people: 6, zonaPref: "Dehors" });
  assert.deepEqual(r.ids, ["d1", "d2", "d3"]);
  assert.equal(r.zone, "Dehors");
});

test("quattro persone: il tavolo da quattro batte i due accostati", () => {
  // d1+d2 = 4 posti esatti e S1 = 4 posti esatti: pari sprechi, ma S1 e' uno
  // solo. Accostare tavoli e' lavoro per la sala, e si fa solo se serve.
  const r = scegli({ people: 4 });
  assert.deepEqual(r.ids, ["s1"]);
});

test("nessuna combinazione basta: rende null, non un tavolo troppo piccolo", () => {
  // ⚠️ Conta piu' di quanto sembri. Rendere «il meglio che c'e'» vorrebbe
  // dire sette persone sedute a un tavolo da sei, deciso da un algoritmo e
  // scoperto dal cameriere.
  assert.equal(scegli({ people: 20 }), null);
});

/* ============================================================
   Quello che e' gia' occupato
   ============================================================ */

test("un tavolo occupato non si assegna due volte", () => {
  const r = scegli({ people: 2, occupati: new Set(["d1", "d2"]) });
  assert.deepEqual(r.ids, ["d3"]);
});

test("una catena con un anello occupato non si usa", () => {
  // d2 occupato spezza d1-d2-d3: fuori non restano sei posti contigui, e si
  // finisce dentro.
  const r = scegli({ people: 6, occupati: new Set(["d2"]) });
  assert.deepEqual(r.ids, ["s2"]);
});

test("tutto occupato: null", () => {
  assert.equal(scegli({ people: 2, occupati: new Set(SALA.map((t) => t.id)) }), null);
});

/* ============================================================
   Sezioni: scelta, chiusura, ordine di riempimento
   ============================================================ */

test("la sezione chiesta dal cliente si rispetta, anche sprecando posti", () => {
  const r = scegli({ people: 2, zonaPref: "Salle" });
  assert.equal(r.zone, "Salle");
  assert.deepEqual(r.ids, ["s1"]); // 4 posti per 2: chi sceglie la sala la ottiene
});

test("una sezione chiusa non riceve nessuno", () => {
  const r = scegli({ people: 2, zoneChiuse: ["Dehors"] });
  assert.equal(r.zone, "Salle");
});

test("una sezione CHIESTA per nome salta il filtro delle chiusure", () => {
  // ⚠️ Sembra un buco e non lo e', ma il motivo sta ALTROVE e va scritto qui,
  // perche' fra i due punti non c'e' niente che li tenga insieme.
  //
  // Dal sito: `verificaCreneau` rifiuta prima di arrivare qui — una zona
  // chiusa non si prenota, e chi manda la richiesta e' il browser, quindi il
  // controllo sta li' apposta (il test qui sotto lo guarda).
  //
  // Dall'admin: e' voluto. Il responsabile che decide di sedere qualcuno sulla
  // terrazza chiusa sa cosa sta facendo — magari l'ha appena riaperta e non ha
  // ancora tolto la chiusura. Un algoritmo che glielo impedisce non protegge
  // nessuno: gli fa scrivere la prenotazione su un foglietto.
  const r = scegli({ people: 2, zonaPref: "Dehors", zoneChiuse: ["Dehors"] });
  assert.equal(r.zone, "Dehors");
});

test("dal SITO una sezione chiusa non si prenota: il controllo e' a monte", async () => {
  // ⚠️ E' la meta' che rende accettabile il test qui sopra. Se sparisse questa
  // riga, `scegliCombinazione` accetterebbe volentieri la terrazza chiusa e
  // il cliente si presenterebbe davanti a delle sedie accatastate.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/pages/api/reservation.ts", "utf8");
  assert.match(
    src,
    // Dal 02/10/2026 ogni rifiuto porta il suo nome: qui "sezioneChiusa".
    /if \(p\.zone && zoneClosed\.includes\(p\.zone\)\) return "sezioneChiusa";/,
    "il controllo sulle sezioni chiuse e' sparito da verificaCreneau",
  );
  // E le chiusure che guarda sono di QUESTA sede: quelle del giorno dalla
  // tabella filtrata, quelle permanenti dalla configurazione della sede.
  assert.match(src, /leggiTab\(\s*"zone_closures",\s*ambito/);
});

test("con «indifferente» si riempie prima la sezione in cima all'elenco", () => {
  // Due persone: sia Dehors (2 posti esatti) sia Salle bastano. Senza
  // priorita' vincerebbe Dehors per sprechi; con la priorita' vince la Salle.
  const senza = scegli({ people: 2 });
  assert.equal(senza.zone, "Dehors");
  const con = scegli({ people: 2, priorita: ["Salle", "Dehors"] });
  assert.equal(con.zone, "Salle");
});

test("la priorita' si ferma alla prima sezione che ha posto", () => {
  // Salle in cima ma piena: si scende a Dehors invece di non trovare niente.
  const r = scegli({
    people: 2,
    priorita: ["Salle", "Dehors"],
    occupati: new Set(["s1", "s2"]),
  });
  assert.equal(r.zone, "Dehors");
});

/* ============================================================
   MULTI-SEDE — il contratto di questa funzione
   ============================================================ */

test("i tavoli arrivano gia' filtrati: qui le sedi non esistono", () => {
  // ⚠️ Questo test descrive un CONTRATTO, non una difesa. `scegliCombinazione`
  // non sa che le sedi esistono: se le venissero passati i tavoli di due
  // pizzerie, accosterebbe volentieri un tavolo di Stockel con uno di
  // Jourdan — e la prenotazione risulterebbe seduta in due citta'.
  //
  // La separazione sta UNA riga sopra, in `assegnaTavoli`, che legge con
  // `leggi("restaurant_tables", ambito, …)`. Il test qui sotto guarda proprio
  // quella riga: e' lei che tiene in piedi tutto il resto.
  const mescolati = [
    { id: "stockel-1", zone: "Salle", name: "S1", seats: 2 },
    { id: "jourdan-1", zone: "Salle", name: "J1", seats: 2 },
  ];
  const r = scegliCombinazione(mescolati, { Salle: [["stockel-1", "jourdan-1"]] }, nessuno, null, [], 4, []);
  assert.deepEqual(
    r.ids,
    ["stockel-1", "jourdan-1"],
    "se un giorno rendesse null, qualcuno ha messo qui una difesa che NON deve stare qui",
  );
});

test("la sala si legge sempre con il filtro di sede", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/planSalle.ts", "utf8");
  for (const tabella of ["restaurant_tables", "zone_closures", "reservations"]) {
    assert.match(
      src,
      new RegExp(`leggi\\(\\s*"${tabella}",\\s*ambito`),
      `planSalle legge «${tabella}» senza l'ambito: i tavoli di tre pizzerie in una sala sola`,
    );
    assert.equal(
      new RegExp(`supabaseAdmin\\s*\\.from\\(\\s*"${tabella}"`).test(src),
      false,
      `planSalle legge «${tabella}» scavalcando il filtro`,
    );
  }
});

test("la configurazione della sala si legge per sede, chiave per chiave", async () => {
  const { readFileSync } = await import("node:fs");
  // Le chiavi che DESCRIVONO la sala: sezioni, servizi, legami fra tavoli,
  // priorita' di riempimento, chiusure permanenti. Sono in `app_config`, che
  // e' del marchio — ma `appConfigIn(..., ambito)` ci sovrappone quelle della
  // sede. Senza l'ambito, tre pizzerie con piante diverse userebbero le
  // sezioni di una sola, e i tavoli finirebbero in zone che li' non esistono.
  const CHIAVI = [
    "reservation_zones", "reservation_services", "reservation_plan_mode",
    "reservation_plan_links", "reservation_zone_priority",
    "reservation_hold_minutes", "zone_closures_permanent",
  ];
  for (const f of ["src/lib/planSalle.ts", "src/lib/admin/caricaResaGiorno.ts"]) {
    const src = readFileSync(f, "utf8");
    const usate = CHIAVI.filter((k) => src.includes(`"${k}"`));
    if (usate.length === 0) continue;
    // Ogni chiamata ad appConfigIn in questi file deve nominare l'ambito.
    for (const m of src.matchAll(/appConfigIn\(/g)) {
      let i = m.index + m[0].length, liv = 1;
      while (liv > 0 && i < src.length) {
        if (src[i] === "(") liv++;
        else if (src[i] === ")") liv--;
        i++;
      }
      assert.match(
        src.slice(m.index, i),
        /\bambito\b/,
        `${f}:${src.slice(0, m.index).split("\n").length} legge la sala senza dire di quale sede`,
      );
    }
  }
});

/* ============================================================
   LA CAPIENZA — quanti posti ha davvero QUESTA sala
   ------------------------------------------------------------
   Non e' un dato estetico: decide se una prenotazione entra.
   Un numero troppo alto vuol dire gente in piu' di quanta ne
   stia, e lo si scopre la sera.
   ============================================================ */

test("plan de salle acceso: i posti si contano dai tavoli di QUESTA sede", () => {
  const conf = [{ name: "Salle", seats: 100 }, { name: "Dehors", seats: 100 }];
  // Il piano di questa sede: 12 posti dentro, 6 fuori. I 100 scritti nella
  // configurazione (ereditati dal marchio) non contano piu'.
  const piano = new Map([["Salle", 12], ["Dehors", 6]]);
  const r = capienzaDelleZone(conf, piano);
  assert.equal(r.capienza, 18);
  assert.deepEqual(r.zones, [{ name: "Salle", seats: 12 }, { name: "Dehors", seats: 6 }]);
});

test("una sezione ereditata senza tavoli QUI sparisce da sola", () => {
  // ⚠️ E' la parte che salva il multi-sede con il plan acceso: Stockel
  // eredita l'elenco sezioni del marchio, ma la veranda ce l'ha solo
  // Schaerbeek. Zero tavoli = zero posti = sezione fuori dal conto, invece
  // di trenta coperti che non esistono.
  const conf = [{ name: "Salle", seats: 40 }, { name: "Veranda", seats: 30 }];
  const r = capienzaDelleZone(conf, new Map([["Salle", 12]]));
  assert.equal(r.capienza, 12);
  assert.deepEqual(r.zones.map((z) => z.name), ["Salle"]);
});

test("plan spento: valgono i posti scritti nella configurazione", () => {
  const conf = [{ name: "Salle", seats: 40 }, { name: "Dehors", seats: 20 }];
  assert.equal(capienzaDelleZone(conf, null).capienza, 60);
});

test("⚠️ plan spento: una sede non configurata eredita i coperti del marchio", () => {
  // Questo test NON approva: descrive. `capienzaDelleZone` riceve la
  // configurazione gia' risolta da `leggiConfig`, che a una sede senza valori
  // suoi rende quelli dell'installazione. Con il plan spento nessuno se ne
  // accorge, e Stockel accetta i coperti di Schaerbeek.
  //
  // Non si corregge qui — e' l'ereditarieta', la stessa di tutto il resto, e
  // per un ristorante solo e' esatta. Si configura la sede, oppure si accende
  // il plan de salle e il conto si fa da solo (vedi i due test qui sopra).
  const delMarchio = [{ name: "Salle", seats: 60 }];
  assert.equal(capienzaDelleZone(delMarchio, null).capienza, 60);
});

test("nomi con spazi: «Terrasse » e «Terrasse» sono la stessa sezione", () => {
  // ⚠️ E' il guasto che ha fatto nascere questa funzione. Il pannello non
  // faceva `trim()`, il widget si': la stessa sezione aveva i posti di qua e
  // zero di la'. Nessun errore — solo un widget che rifiutava prenotazioni
  // per una sala vuota.
  const r = capienzaDelleZone([{ name: "  Terrasse ", seats: 10 }], new Map([["Terrasse", 8]]));
  assert.deepEqual(r.zones, [{ name: "Terrasse", seats: 8 }]);
});

test("configurazione rotta o vuota: zero posti, nessuna eccezione", () => {
  for (const cattivo of [undefined, null, "[]", 42, {}, [{ seats: 10 }], [{ name: "X" }]]) {
    const r = capienzaDelleZone(cattivo, null);
    assert.equal(r.capienza, 0, String(cattivo));
    assert.deepEqual(r.zones, []);
  }
  // ⚠️ Zero, non «illimitato». Una capienza sconosciuta che si comporta come
  // infinita accetta tutto: meglio un widget che non prenota e si nota
  // subito, di una sala che si riempie il doppio.
  assert.equal(capienzaDelleZone([{ name: "Salle", seats: 0 }], null).capienza, 0);
  assert.equal(capienzaDelleZone([{ name: "Salle", seats: -5 }], null).capienza, 0);
});

test("il JSON della configurazione non fa mai esplodere niente", () => {
  assert.deepEqual(zoneDaConfig(undefined), []);
  assert.deepEqual(zoneDaConfig(""), []);
  assert.deepEqual(zoneDaConfig("{non json"), []);
  assert.deepEqual(zoneDaConfig('[{"name":"Salle","seats":4}]'), [{ name: "Salle", seats: 4 }]);
});

test("la capienza si calcola in UN posto solo", async () => {
  // ⚠️ Era scritta due volte e le copie erano gia' divergenti. Questa rete
  // impedisce che ne rinasca una terza: chi somma dei posti deve chiamare
  // `capienzaDelleZone`, non rifarsi il giro sulle sezioni.
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/lib/admin/caricaResaGiorno.ts", "src/pages/api/reservation.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /capienzaDelleZone\(/, `${f}: non usa la regola comune`);
    assert.equal(
      /capacity \+= /.test(src),
      false,
      `${f}: somma i posti per conto suo invece di chiamare capienzaDelleZone`,
    );
  }
});

test("il rifiuto di un creneau dice SEMPRE perche'", async () => {
  // ⚠️ Il 02/10/2026 un ristoratore non riusciva a prenotare a nessuna ora, con
  // la sala vuota. Il server rispondeva `creneauPris` — la stessa parola per
  // tredici controlli diversi — e dal codice i candidati erano otto: capienza,
  // giorno chiuso, fuori servizio, sezione chiusa, preavviso, tavoli... Non era
  // un bug difficile: era un bug MUTO.
  //
  // Da qui in avanti `verificaCreneau` torna il motivo e l'API lo mette accanto
  // all'errore. Il cliente continua a leggere la frase gentile; chi apre la
  // scheda Rete legge quale regola ha deciso.
  const { readFileSync } = await import("node:fs");
  const API = readFileSync("src/pages/api/reservation.ts", "utf8");

  assert.doesNotMatch(API, /return "creneauPris"/,
    "un controllo e' tornato alla risposta unica: cosi' il rifiuto non si sa piu' spiegare");

  // Ogni `return` di verificaCreneau porta un nome, e i nomi sono tutti diversi:
  // due controlli con la stessa etichetta sarebbero di nuovo indistinguibili.
  const corpo = API.slice(API.indexOf("async function verificaCreneau"), API.indexOf("/** Cliente BLOCCATO"));
  const motivi = [...corpo.matchAll(/return "([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(motivi.length >= 13, `verificaCreneau ha ${motivi.length} rifiuti nominati, erano 13`);
  assert.equal(new Set(motivi).size, motivi.length, "due controlli diversi tornano lo stesso motivo");

  // E il motivo deve davvero uscire dall'API, se no resta una variabile interna.
  assert.match(API, /error: "creneauPris", motivo: errC/,
    "il motivo non viene piu' messo nella risposta");
});

test("una chiave di servizio puo' avere piu' righe, e si guarda quella del giorno", async () => {
  // ⚠️ IL GUASTO PIU' CARO DI QUESTA SETTIMANA, e non dava nessun errore.
  // I ristoranti scrivono due servizi con la STESSA chiave e giorni diversi:
  //   soir 18:00-22:30  giorni [0,1,3,4]     (feriali)
  //   soir 18:00-23:00  giorni [5,6]         (venerdi' e sabato)
  // E' il modo normale di dire "il weekend si chiude piu' tardi", e due
  // clienti su cinque lo usano — verificato leggendo il loro `?config=1`.
  //
  // `verificaCreneau` faceva `services.find(key)`, che prende la PRIMA riga.
  // Il venerdi' si finiva a controllare la riga dei feriali, che il venerdi'
  // non e' attiva: prenotazione rifiutata a QUALSIASI ora, con la sala vuota,
  // nei due giorni che contano di piu'. Il cliente leggeva «questo orario e'
  // appena stato preso», e nei log non c'era niente.
  const { readFileSync } = await import("node:fs");
  const API = readFileSync("src/pages/api/reservation.ts", "utf8");

  assert.doesNotMatch(API, /cfg\.services\.find\(/,
    "si e' tornati a `find` sui servizi: con due righe per la stessa chiave si guarda quella sbagliata");
  assert.match(API, /cfg\.services\.filter\(\(sv\) => sv\.key === p\.service_key\)/,
    "il controllo del creneau non raccoglie piu' TUTTE le righe del servizio scelto");
  assert.match(API, /esiti\.some\(\(e\) => e === null\)/,
    "basta che UNA riga regga il giorno e l'ora: la regola e' tornata a pretenderle tutte");

  // La durata (hold) ha la stessa trappola: con due righe la mappa teneva
  // l'ultima, e il lunedi' si calcolava l'occupazione con la durata del sabato.
  assert.doesNotMatch(API, /new Map\(cfg\.services\.map\(\(s\) => \[s\.key, s\.hold\]\)\)/,
    "la mappa delle durate e' tornata a tenere l'ultima riga invece di quella del giorno");

  // E lo stesso vale per la chiusura automatica dei tavoli.
  const CAR = readFileSync("src/lib/admin/caricaResaGiorno.ts", "utf8");
  assert.match(CAR, /righe\.find\(\(x\) => \{/,
    "la chiusura automatica e' tornata a prendere la prima riga: il sabato chiudeva i tavoli troppo presto");
});
