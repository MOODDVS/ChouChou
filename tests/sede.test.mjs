// Multi-sede: le regole di filtro, provate senza database.
// `sedeRegole.ts` non importa niente apposta — cosi' questi test girano
// sulla funzione VERA, non su una copia che puo' divergere.
import assert from "node:assert/strict";
import { test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { SONO_IL_MOTORE } from "./ambiente.mjs";
import { join } from "node:path";
import {
  CLASSIFICA,
  CHIESTA_TUTTE,
  SEDE_UNICA,
  sede,
  tutteLeSedi,
  filtroPer,
  sedeDaScrivere,
  applicaFiltro,
  appartenenzaDi,
  scegliSede,
  NESSUNA_SEDE,
  radiceDocs,
  scegliSegreto,
  SegretoIlleggibile,
  pagamentoOnlinePronto,
} from "../src/lib/admin/sedeRegole.ts";

const JOURDAN = "11111111-2222-3333-4444-555555555555";
const TUTTE_LE_TABELLE = Object.keys(CLASSIFICA);
const di = (a) => TUTTE_LE_TABELLE.filter((t) => CLASSIFICA[t] === a);

/* ============================================================
   IL TEST CHE CONTA: coi quattro clienti attuali non cambia NIENTE.
   ============================================================ */
test("sede unica: nessun filtro, su nessuna tabella", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    assert.deepEqual(
      filtroPer(tabella, SEDE_UNICA),
      { tipo: "nessuno" },
      `${tabella} verrebbe filtrata anche a sede unica`
    );
  }
});

test("sede unica: la query esce identica a com'e' entrata", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    const chiamate = [];
    const finta = {
      eq: (...a) => (chiamate.push(["eq", ...a]), finta),
      or: (...a) => (chiamate.push(["or", ...a]), finta),
    };
    const uscita = applicaFiltro(finta, tabella, SEDE_UNICA);
    assert.equal(uscita, finta, `${tabella}: query sostituita`);
    assert.deepEqual(chiamate, [], `${tabella}: aggiunta una condizione`);
  }
});

/* ============================================================
   Con le sedi accese
   ============================================================ */
test("le tabelle del marchio non si filtrano mai", () => {
  for (const tabella of di("marchio")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), { tipo: "nessuno" });
    assert.deepEqual(filtroPer(tabella, tutteLeSedi()), { tipo: "nessuno" });
  }
});

test("le tabelle della sede si filtrano con l'uguaglianza", () => {
  for (const tabella of di("sede")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), { tipo: "sede", valore: JOURDAN });
  }
  const chiamate = [];
  const finta = { eq: (...a) => (chiamate.push(["eq", ...a]), finta), or: (...a) => (chiamate.push(["or", ...a]), finta) };
  applicaFiltro(finta, "orders", sede(JOURDAN));
  assert.deepEqual(chiamate, [["eq", "location_id", JOURDAN]]);
});

test("le tabelle miste vedono la sede E il marchio", () => {
  for (const tabella of di("mista")) {
    assert.deepEqual(filtroPer(tabella, sede(JOURDAN)), {
      tipo: "sede-o-marchio",
      espressione: `location_id.eq.${JOURDAN},location_id.is.null`,
    });
  }
  const chiamate = [];
  const finta = { eq: (...a) => (chiamate.push(["eq", ...a]), finta), or: (...a) => (chiamate.push(["or", ...a]), finta) };
  applicaFiltro(finta, "menu_items", sede(JOURDAN));
  assert.deepEqual(chiamate, [["or", `location_id.eq.${JOURDAN},location_id.is.null`]]);
});

test("l'aggregato non filtra, ma va chiesto per nome", () => {
  for (const tabella of TUTTE_LE_TABELLE) {
    assert.deepEqual(filtroPer(tabella, tutteLeSedi()), { tipo: "nessuno" });
  }
  // «tutte» e «unica» rendono lo stesso filtro ma NON sono la stessa cosa:
  // uno e' lo stato dell'installazione, l'altro una richiesta esplicita.
  assert.notDeepEqual(tutteLeSedi(), SEDE_UNICA);
});

/* ============================================================
   Le difese
   ============================================================ */
test("una tabella non classificata e' un errore, non un caso non filtrato", () => {
  assert.throws(() => filtroPer("tabella_inventata", sede(JOURDAN)), /non classificata/);
  assert.throws(() => appartenenzaDi("orders_v2"), /non classificata/);
});

test("un id di sede non valido viene rifiutato (finisce dentro un filtro testuale)", () => {
  for (const cattivo of ["", "tutte", "1; drop", "location_id.is.null", "11111111-2222-3333-4444-55555555555"]) {
    assert.throws(() => sede(cattivo), /non valido/, `accettato: ${JSON.stringify(cattivo)}`);
  }
  assert.equal(sede(JOURDAN).id, JOURDAN);
});

/* ============================================================
   Scrittura
   ============================================================ */
test("che location_id si scrive", () => {
  // Marchio: sempre NULL, anche stando dentro una sede.
  assert.equal(sedeDaScrivere("clients", sede(JOURDAN)), null);
  // Sede unica: NULL, che per un punto solo e' la verita'.
  assert.equal(sedeDaScrivere("orders", SEDE_UNICA), null);
  // Dentro una sede: la sede.
  assert.equal(sedeDaScrivere("orders", sede(JOURDAN)), JOURDAN);
  // Mista: decide chi crea.
  assert.equal(sedeDaScrivere("special_days", sede(JOURDAN), false), JOURDAN);
  assert.equal(sedeDaScrivere("special_days", sede(JOURDAN), true), null);
  // `condivisa` non ha effetto dove non c'e' niente da scegliere.
  assert.equal(sedeDaScrivere("orders", sede(JOURDAN), true), JOURDAN);
});

test("non si scrive nell'aggregato", () => {
  assert.throws(() => sedeDaScrivere("orders", tutteLeSedi()), /sola lettura/);
  assert.throws(() => sedeDaScrivere("clients", tutteLeSedi()), /sola lettura/);
});

/* ============================================================
   La rete 3: un nome locale che ombreggia un passaggio obbligato
   ------------------------------------------------------------
   Il 14/09 `orders.ts` aveva gia' una funzione locale chiamata
   `leggi`. Importando il passaggio obbligato con lo stesso nome, il
   locale l'ha ombreggiato in TUTTO il corpo dell'handler — comprese
   le righe SOPRA di lui, finite nella sua zona morta.

   ⚠️ Non e' un errore di compilazione: `astro check` passa, `esbuild`
   passa, e la pagina muore a runtime con «Cannot access 'leggi'
   before initialization». Stessa famiglia del guasto di Astro 7.
   ============================================================ */
test("nessun nome locale ombreggia un passaggio obbligato", () => {
  const NOMI = new Set([
    "leggi", "inserisci", "aggiorna", "cancella", "salva",
    "leggiConfig", "scriviConfig", "leggiOrari", "scriviOrari",
    "ambitoDiRichiesta", "ambitoPubblico", "tutteLeSedi",
  ]);
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");

  const ombre = [];
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    if (!/from\s*"[^"]*sede"/.test(testo)) continue;
    // i nomi davvero importati, tenendo conto degli alias
    const importati = new Set();
    for (const m of testo.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*sede"/g)) {
      for (let pezzo of m[1].split(",")) {
        pezzo = pezzo.trim().replace(/^type\s+/, "");
        if (!pezzo) continue;
        importati.add(pezzo.includes(" as ") ? pezzo.split(" as ")[1].trim() : pezzo);
      }
    }
    for (const n of importati) {
      if (!NOMI.has(n)) continue;
      const re = new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`, "g");
      for (const m of testo.matchAll(re)) {
        ombre.push(`${f}:${testo.slice(0, m.index).split("\n").length} → «${n}»`);
      }
    }
  }
  assert.deepEqual(
    ombre.sort(),
    [],
    `nomi locali che ombreggiano un passaggio obbligato:\n  ${ombre.join("\n  ")}`
  );
});

/* ============================================================
   La rete 2: una lettura di configurazione senza ambito
   ------------------------------------------------------------
   `appConfigIn` / `appConfigEq` prendono l'ambito come parametro
   OPZIONALE, e li' l'opzionalita' e' difendibile: un ambito
   dimenticato rende il valore dell'INSTALLAZIONE, cioe' un ripiego
   definito, non i dati di un'altra societa'.

   Ma «difendibile» non vuol dire «gratis». Il 14/09 me ne sono
   dimenticato in quattro file su sei, il giorno stesso in cui l'ho
   aggiunto: il modale «Nuova prenotazione» mostrava servizi e sale
   del marchio invece che della sede scelta. Le tabelle erano
   separate, la configurazione no — e non dava nessun errore.

   Quindi ogni chiamata deve dire esplicitamente dove sta: `ambito`,
   oppure `SEDE_UNICA` per dichiarare «questo vale per tutti».
   ============================================================ */
test("ogni lettura di configurazione dichiara il suo ambito", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome) && nome !== "appConfigCache.ts") file.push(p);
    }
  })("src");

  const senzaAmbito = [];
  let trovate = 0;
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    for (const m of testo.matchAll(/appConfig(?:In|Eq)\(/g)) {
      // si legge la chiamata intera, anche se e' spezzata su piu' righe
      let i = m.index + m[0].length, liv = 1;
      while (liv > 0 && i < testo.length) {
        if (testo[i] === "(") liv++;
        else if (testo[i] === ")") liv--;
        i++;
      }
      trovate++;
      const chiamata = testo.slice(m.index, i);
      // `ambito\w*`: i file usano nomi diversi per la stessa cosa —
      // `ambito`, `ambitoPub`, `ambitoOrdine`. Chiedere la parola esatta
      // rendeva rossa una chiamata CORRETTA solo perche' la variabile aveva
      // un suffisso, e una rete che punisce il codice giusto e' una rete che
      // qualcuno prima o poi disattiva.
      if (!/\bambito\w*\b|\bSEDE_UNICA\b/.test(chiamata)) {
        senzaAmbito.push(`${f}:${testo.slice(0, m.index).split("\n").length}`);
      }
    }
  }

  assert.ok(trovate >= 8, `trovate solo ${trovate} chiamate: la ricerca non funziona`);
  assert.deepEqual(
    senzaAmbito.sort(),
    [],
    `letture di configurazione senza ambito dichiarato:\n  ${senzaAmbito.join("\n  ")}`
  );
});

/* ============================================================
   La rete: una tabella usata e non dichiarata sarebbe senza regola
   ============================================================ */
test("ogni tabella letta nel codice e' classificata", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");

  const usate = new Set();
  // Due forme, e devono esserci tutte e due:
  //  - la query diretta `supabaseAdmin.from("x")`, che resta per le tabelle
  //    del marchio e per i percorsi non ancora convertiti;
  //  - i passaggi obbligati `leggi/inserisci/aggiorna/cancella/salva("x", …)`.
  // ⚠️ Senza la seconda, questa rete si sarebbe SVUOTATA da sola man mano che
  // il passo 5 converte i file: ogni conversione toglieva una tabella dal
  // conteggio, e alla fine il test sarebbe passato controllando niente.
  const forme = [
    /supabaseAdmin\s*\.from\(\s*"([a-z_]+)"\s*\)/g,
    /\b(?:leggi|inserisci|aggiorna|cancella|salva)\(\s*"([a-z_]+)"\s*,/g,
  ];
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    for (const re of forme) for (const m of testo.matchAll(re)) usate.add(m[1]);
  }

  assert.ok(usate.size > 25, `trovate solo ${usate.size} tabelle: la ricerca non funziona`);
  const mancanti = [...usate].filter((t) => !CLASSIFICA[t]).sort();
  assert.deepEqual(
    mancanti,
    [],
    `tabelle usate ma non dichiarate in CLASSIFICA: ${mancanti.join(", ")}`
  );
});

/* ============================================================
   Quale sede, per questa richiesta
   ============================================================ */
const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";
const SEDI = [A, B];

test("nessuna sede: nessun filtro, chiunque tu sia", () => {
  // ⚠️ E' lo stato dei quattro clienti live finche' non si crea la loro sede.
  // Dal 15/09/2026 l'interruttore `multi_location` non esiste piu': la verita'
  // e' quante sedi ci sono, e un elenco vuoto vuol dire «niente da separare».
  assert.deepEqual(scegliSede({ sedi: [] }), SEDE_UNICA);
  assert.deepEqual(scegliSede({ sedi: [], sedeUtente: A }), SEDE_UNICA);
  assert.deepEqual(scegliSede({ sedi: [], sedeChiesta: B }), SEDE_UNICA);
  assert.deepEqual(scegliSede({ sedi: [], sedeChiesta: CHIESTA_TUTTE }), SEDE_UNICA);
});

test("UNA sola sede: tutto e' suo, senza niente da scegliere", () => {
  assert.deepEqual(scegliSede({ sedi: [A] }), sede(A));
  assert.deepEqual(scegliSede({ sedi: [A], sedeUtente: A }), sede(A));
  // Anche chiedendo un'altra sede: quella non esiste, si resta sulla propria.
  assert.deepEqual(scegliSede({ sedi: [A], sedeChiesta: B }), sede(A));
});

test("chi e' legato a una sede resta sulla sua, qualunque cosa chieda", () => {
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeUtente: A, sedeChiesta: B }), sede(A));
});

test("chi vede tutte ottiene quella che chiede, se esiste", () => {
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeChiesta: B }), sede(B));
  // sede inventata o non piu' attiva → la prima, non l'aggregato
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeChiesta: "cccccccc-1111-2222-3333-444444444444" }), sede(A));
  assert.deepEqual(scegliSede({ sedi: SEDI }), sede(A));
});

test("una sede sparita non apre le porte: si vede il VUOTO", () => {
  // il responsabile era legato a una sede disattivata o cancellata
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeUtente: "dddddddd-1111-2222-3333-444444444444" }), sede(NESSUNA_SEDE));
  // e un id malformato non deve nemmeno lanciare
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeUtente: "tutte" }), sede(NESSUNA_SEDE));
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeUtente: "location_id.is.null" }), sede(NESSUNA_SEDE));
});

test("l'aggregato si ottiene solo chiedendolo per nome", () => {
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeChiesta: CHIESTA_TUTTE }), tutteLeSedi());
  // senza sedi non esiste nessun aggregato: non c'e' niente da aggregare
  assert.deepEqual(scegliSede({ sedi: [], sedeChiesta: CHIESTA_TUTTE }), SEDE_UNICA);
  // e chi e' legato a un punto non lo ottiene nemmeno chiedendolo: e' proprio
  // il tentativo da cui ci si difende, e non deve dare errore, solo non valere
  assert.deepEqual(scegliSede({ sedi: SEDI, sedeUtente: A, sedeChiesta: CHIESTA_TUTTE }), sede(A));
});

test("scegliSede non rende l'aggregato per DIMENTICANZA", () => {
  // Il pericolo non e' l'aggregato chiesto: e' la sede che manca e diventa
  // aggregato in silenzio. Nessuno di questi casi lo e'.
  const casi = [
    { sedi: SEDI },
    { sedi: SEDI, sedeChiesta: "" },
    { sedi: SEDI, sedeUtente: null, sedeChiesta: null },
    { sedi: [A] },
    { sedi: [] },
  ];
  for (const c of casi) {
    assert.notEqual(scegliSede(c).modo, "tutte", JSON.stringify(c));
  }
});

/* ============================================================
   MENU — definizione (del gruppo) e stato (del punto)
   ------------------------------------------------------------
   Il caso vero: 450 Gradi, tre pizzerie, un menu solo. Stockel ha
   una pizza in teglia che gli altri due non fanno, e ogni sera
   qualcuno finisce la burrata in un punto e non negli altri.

   Due meccanismi diversi APPOSTA:
   - il formato porta la sua sede DENTRO il jsonb (definizione);
   - l'esaurito sta in `menu_sold_out`, riga per (sede, piatto)
     (stato). Se stesse nella carta, ogni «finita la burrata»
     sarebbe una modifica al menu del gruppo.
   ============================================================ */
test("il formato di un punto non esiste negli altri", async () => {
  const { variantiDelPunto, trovaVariante } = await import("../src/lib/pricing.ts");
  const STOCKEL = "22222222-2222-2222-2222-222222222222";
  const varianti = [
    { key: "30", label_i18n: { fr: "30 cm" }, price_cents: 1200, orderable: true, sold_out: false, location_id: null },
    { key: "teglia", label_i18n: { fr: "Teglia" }, price_cents: 2400, orderable: true, sold_out: false, location_id: STOCKEL },
  ];
  // A Stockel si vedono tutti e due; a Jourdan solo quello di tutti.
  assert.deepEqual(variantiDelPunto(varianti, sede(STOCKEL)).map((v) => v.key), ["30", "teglia"]);
  assert.deepEqual(variantiDelPunto(varianti, sede(JOURDAN)).map((v) => v.key), ["30"]);
  // A sede unica non c'e' niente da dividere: si vedono tutti.
  assert.deepEqual(variantiDelPunto(varianti, SEDE_UNICA).map((v) => v.key), ["30", "teglia"]);

  // ⚠️ E il filtro deve valere anche al CHECKOUT: la chiave arriva dal
  // browser, e accettare "teglia" a Jourdan vuol dire incassare per una
  // pizza che quella cucina non fa.
  assert.equal(trovaVariante(varianti, "teglia", true, sede(JOURDAN)), null);
  assert.equal(trovaVariante(varianti, "teglia", true, sede(STOCKEL))?.price_cents, 2400);
});

test("lo stato del punto comanda sulla carta del gruppo, anche per rimettere in vendita", async () => {
  const { applicaStato } = await import("../src/lib/pricing.ts");
  const piatto = {
    id: "x",
    sold_out: true, // il gruppo l'aveva segnato finito
    variants: [
      { key: "30", sold_out: false },
      { key: "40", sold_out: true },
    ],
  };
  // Nessuna riga per questo punto: la carta del gruppo vale tale e quale.
  assert.deepEqual(applicaStato(piatto, undefined), piatto);

  // Il punto dice «ce l'ho», e vince: senza questo, una pizzeria non
  // potrebbe mai rimettere in vendita quello che il gruppo ha spento.
  const rimesso = applicaStato(piatto, { sold_out: false, variants_off: ["30"] });
  assert.equal(rimesso.sold_out, false);
  assert.deepEqual(rimesso.variants.map((v) => v.sold_out), [true, false]);

  // E non tocca l'originale: la riga del gruppo resta com'era.
  assert.equal(piatto.sold_out, true);
  assert.deepEqual(piatto.variants.map((v) => v.sold_out), [false, true]);
});

/* ============================================================
   La rete 4: l'elenco SQL che riattribuisce lo storico
   ------------------------------------------------------------
   `assegna_storico_sede()` riempie `location_id` dove e' NULL, e
   l'elenco delle tabelle su cui lavora sta nel SQL — cioe' fuori
   da `CLASSIFICA`, dove nessun compilatore lo guarda.

   ⚠️ I due modi di sbagliare non si somigliano:
   - una tabella «sede» DIMENTICATA nel SQL resta a NULL, e dopo
     l'accensione sparisce da ogni punto. Sintomo visibile.
   - una tabella «mista» AGGIUNTA per sbaglio e' molto peggio: li'
     NULL vuol dire «vale per tutte le sedi». Riempirla trasforma
     in silenzio il menu del gruppo nel menu di un punto solo, e
     non lo segnala niente.
   ============================================================ */
test("le tabelle riattribuite dal SQL sono esattamente quelle «sede»", () => {
  const sql = readFileSync("supabase/locations.sql", "utf8");
  const m = /create or replace function public\.tabelle_di_sede\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
  assert.ok(m, "funzione `tabelle_di_sede()` non trovata in locations.sql");
  // ⚠️ Via i commenti `--` PRIMA di cercare i nomi. Un commento in italiano
  // dentro l'elenco («non c'e' piu'») ha degli apostrofi, e questo lettore
  // ingenuo ci vedeva una stringa SQL: si ritrovava una tabella di nome «e».
  // Un commento non e' un dato — stessa lezione di `soloCodice`, che era
  // nata esattamente cosi'.
  const senzaCommenti = m[1].replace(/--[^\n]*/g, "");
  const nelSql = [...senzaCommenti.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();

  // Nate DOPO il multi-sede: non hanno righe storiche orfane da riattribuire,
  // e nell'elenco del SQL non ci vanno. Per le prime quattro `location_id` e'
  // NOT NULL; `print_tickets` ce l'ha nullable come gli ordini (un cliente a
  // sede unica scrive NULL), ma e' nata il 04/10/2026, a multi-sede gia'
  // fatto: quando quel SQL ha girato, la tabella non esisteva.
  const SENZA_STORICO = ["location_config", "location_settings", "location_secrets", "menu_sold_out", "print_tickets"];
  const attese = di("sede").filter((t) => !SENZA_STORICO.includes(t)).sort();

  assert.deepEqual(nelSql, attese,
    `l'elenco SQL non combacia con CLASSIFICA.\n  solo nel SQL: ${nelSql.filter((t) => !attese.includes(t))}\n  solo in CLASSIFICA: ${attese.filter((t) => !nelSql.includes(t))}`);

  // E nessuna mista/marchio ci si e' infilata: e' l'errore silenzioso.
  for (const t of nelSql) {
    assert.equal(CLASSIFICA[t], "sede", `${t} e' «${CLASSIFICA[t]}», non «sede»: riempirla cancellerebbe il senso di NULL`);
  }
});

/* ============================================================
   La rete 5: la cartella dei documenti
   ------------------------------------------------------------
   I documenti non si separano con una colonna ma con il
   PERCORSO nel bucket: la loro lista si costruisce leggendo lo
   Storage, e un file senza riga di metadati non avrebbe nessuna
   sede da cui farsi filtrare.

   ⚠️ La tentazione e' usare lo SLUG, che in un bucket si legge:
   `sedi/schaerbeek/contrat/…`. Ma lo slug si cambia dal super
   admin, e il giorno che qualcuno corregge un refuso tutti i
   documenti di quel punto restano in una cartella che il codice
   non guarda piu'. Spariscono dalla pagina senza essere stati
   cancellati — e nessuno se ne accorge finche' non li cerca.
   ============================================================ */
test("i documenti si separano per ID di sede, mai per slug", () => {
  const A = "aaaaaaaa-1111-2222-3333-444444444444";

  // Sede unica: nessun prefisso, cioe' i percorsi di sempre.
  assert.equal(radiceDocs(SEDE_UNICA), "");
  // Dentro un punto: la sua cartella, con l'ID.
  assert.equal(radiceDocs(sede(A)), `sedi/${A}/`);
  // L'aggregato non e' un posto dove si scrive: nessuna cartella.
  assert.equal(radiceDocs(tutteLeSedi()), "");

  // E il prefisso non contiene NIENTE di modificabile: se un giorno
  // qualcuno ci infilasse lo slug, questo test lo direbbe.
  const RE_UUID = /^sedi\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/i;
  assert.match(radiceDocs(sede(A)), RE_UUID);
});

/**
 * Il testo di un file SENZA i suoi commenti e senza le sue stringhe.
 *
 * ⚠️ Serve a una rete che cerca del testo nel codice, e non e' un dettaglio:
 * il 15/09/2026 tre reti di questo file sono diventate rosse tutte insieme
 * perche' leggevano i COMMENTI che le descrivono. In `stripe.ts` c'e' scritto
 * «niente piu' `export const stripe`», e la rete che cercava
 * `export const stripe` ha trovato proprio quella frase. Una rete che si
 * rompe quando qualcuno DOCUMENTA la regola che difende non e' una rete: e'
 * un ostacolo che insegna a non scrivere commenti.
 */
const esiste = (p) => existsSync(p);

function soloCodice(testo) {
  // ⚠️ I template literal (backtick) vanno attraversati, non saltati: dentro
  // ci sono `${...}` che e' codice vero, e le virgolette dentro l'HTML di
  // un'email NON aprono una stringa. La prima versione le trattava come tali
  // e da meta' di `notifications.ts` in poi leggeva tutto come una stringa
  // sola — il test diventava verde per il motivo sbagliato.
  let fuori = "";
  const pila = [];               // "`" = dentro un template, "{" = dentro ${}
  let i = 0;
  while (i < testo.length) {
    const c = testo[i], d = testo[i + 1];
    const inTemplate = pila[pila.length - 1] === "`";

    if (inTemplate) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { pila.pop(); i++; continue; }
      if (c === "$" && d === "{") { pila.push("{"); fuori += " "; i += 2; continue; }
      i++;                        // testo del template: non e' codice
      continue;
    }
    if (c === "/" && d === "/") { while (i < testo.length && testo[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < testo.length && !(testo[i] === "*" && testo[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // ⚠️ Anche le espressioni regolari vanno saltate: `/^["']|["']$/` ha
    // dentro delle virgolette che non aprono nessuna stringa. Per capire se
    // una barra apre una regex si guarda il carattere prima — dopo un valore
    // e' una divisione, dopo una parentesi o un operatore e' una regex.
    if (c === "/") {
      const prec = fuori.replace(/\s+$/, "").slice(-1);
      if (prec === "" || "(,=:[!&|?{};+-*%~^".includes(prec)) {
        i++;
        let inClasse = false;
        while (i < testo.length) {
          if (testo[i] === "\\") { i += 2; continue; }
          if (testo[i] === "[") inClasse = true;
          else if (testo[i] === "]") inClasse = false;
          else if (testo[i] === "/" && !inClasse) break;
          else if (testo[i] === "\n") break;   // non era una regex
          i++;
        }
        i++;
        while (i < testo.length && /[gimsuyd]/.test(testo[i])) i++;
        fuori += "//";
        continue;
      }
    }
    if (c === "`") { pila.push("`"); fuori += '""'; i++; continue; }
    if (c === '"' || c === "'") {
      const fine = c;
      i++;
      while (i < testo.length && testo[i] !== fine) i += testo[i] === "\\" ? 2 : 1;
      i++;
      fuori += '""';
      continue;
    }
    if (c === "}" && pila[pila.length - 1] === "{") { pila.pop(); i++; continue; }
    fuori += c;
    i++;
  }
  return fuori;
}

/* ============================================================
   PEZZO 7 — STRIPE PER SEDE
   ------------------------------------------------------------
   Qui l'errore non e' «vedo dei dati che non sono miei»: e'
   «incasso su un conto che non e' il mio». Tre societa' diverse,
   quindi un rimborso partito dal conto sbagliato e' denaro che
   esce dalla cassa di qualcun altro — e non lo dice nessun errore,
   perche' la chiamata a Stripe riesce.
   ============================================================ */

/* La rete 6: i segreti a riposo.
   Si prova la funzione VERA, non una copia. */
test("un segreto cifrato si rilegge, uno manomesso no", async () => {
  process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
  const { cifra, decifra, cifraturaPronta } = await import("../src/lib/segreti.ts");

  assert.equal(cifraturaPronta(), true);

  const chiaro = "sk_test_51ABCdefGHIjklMNO";
  const cifrato = cifra(chiaro);
  assert.notEqual(cifrato, chiaro, "il valore e' finito nel database in chiaro");
  assert.ok(cifrato.startsWith("v1."), "manca il prefisso di versione");
  assert.equal(decifra(cifrato), chiaro);

  // Due cifrature dello stesso valore non si assomigliano: l'IV e' nuovo
  // ogni volta. Senza, chi legge la tabella vede quali sedi condividono
  // la stessa chiave.
  assert.notEqual(cifra(chiaro), cifra(chiaro));

  // ⚠️ Manomesso = VUOTO, mai un valore parziale. Con AES-CBC questo test
  // passerebbe restituendo spazzatura, e Stripe direbbe solo «invalid key».
  const rotto = cifrato.slice(0, -4) + "AAAA";
  assert.equal(decifra(rotto), "", "un testo manomesso e' stato accettato");

  // Un valore scritto PRIMA della cifratura si rilegge com'e': i clienti
  // di oggi hanno le chiavi in chiaro, e rifiutarle vorrebbe dire rompere
  // i pagamenti nel momento esatto del rilascio.
  assert.equal(decifra("sk_live_vecchia"), "sk_live_vecchia");

  delete process.env.SECRETS_KEY;
});

/* La rete 7: il client Stripe globale non deve tornare.
   Era `export const stripe`, un Proxy pronto all'uso: un oggetto che si
   adopera senza dire di chi e'. E' esattamente il modo in cui l'incasso
   finisce sul conto sbagliato senza che niente si lamenti. */
test("nessuno usa piu' un client Stripe senza nominare la sede", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");

  const colpevoli = [];
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    // Un import di `stripe` (il nome nudo) da lib/stripe non esiste piu'.
    for (const m of testo.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*lib\/stripe"/g)) {
      const nomi = m[1].split(",").map((x) => x.trim().replace(/^type\s+/, ""));
      if (nomi.includes("stripe")) {
        colpevoli.push(`${f} → importa { stripe }`);
      }
    }
  }
  assert.deepEqual(colpevoli.sort(), [], `client Stripe anonimo:\n  ${colpevoli.join("\n  ")}`);

  // E in `lib/stripe.ts` non c'e' piu' niente da esportare con quel nome.
  // ⚠️ Sul codice senza commenti: il commento che spiega questa regola cita
  // per forza la cosa che vieta, e si accusava da solo.
  const sorgente = soloCodice(readFileSync("src/lib/stripe.ts", "utf8"));
  assert.equal(
    /export\s+const\s+stripe\b/.test(sorgente),
    false,
    "il client globale e' tornato in lib/stripe.ts",
  );
});

/* La rete 8: ogni checkout dice di chi e' l'incasso.
   `ambito` e' un campo OBBLIGATORIO del parametro, quindi il compilatore
   lo pretende gia'. Questo test esiste per il giorno in cui qualcuno lo
   rendera' facoltativo «per comodita'»: allora il compilatore tacera' e
   parlera' questo. */
test("ogni creaCheckout* dichiara l'ambito dell'incasso", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src/pages");

  const senza = [];
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    for (const m of testo.matchAll(/creaCheckout(?:Session|Bon|Supplemento)\s*\(\s*\{/g)) {
      // Il blocco degli argomenti, fino alla parentesi graffa di chiusura
      // allo stesso livello. Le chiamate qui sono tutte oggetti letterali.
      let i = testo.indexOf("{", m.index), livello = 0, fine = i;
      for (; fine < testo.length; fine++) {
        if (testo[fine] === "{") livello++;
        else if (testo[fine] === "}" && --livello === 0) break;
      }
      const blocco = testo.slice(i, fine + 1);
      // `ambito: conto` oppure `ambito,` in forma breve: dire di chi e'
      // l'incasso si puo' fare in due modi, e sono buoni tutti e due.
      if (!/\bambito\s*[:,}]/.test(blocco)) {
        senza.push(`${f}:${testo.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(senza.sort(), [], `checkout senza ambito:\n  ${senza.join("\n  ")}`);
});

/* La rete 9: un elenco solo di chiavi segrete.
   `locations.ts` decide quali chiavi accetta, `sede.ts` decide su quale
   variabile d'ambiente ripiegare. Due elenchi separati vorrebbero dire
   una chiave che si salva e che nessuno rilegge mai — con la spunta
   verde accanto. */
test("le chiavi segrete hanno un elenco solo, e ognuna il suo ripiego", () => {
  const sedeTs = readFileSync("src/lib/admin/sede.ts", "utf8");
  const elenco = /CHIAVI_SEGRETE\s*=\s*\[([^\]]*)\]/.exec(sedeTs);
  assert.ok(elenco, "CHIAVI_SEGRETE non trovato in sede.ts");
  const chiavi = [...elenco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(chiavi.length > 0);

  const mappa = /DA_AMBIENTE[^=]*=\s*\{([\s\S]*?)\n\};/.exec(sedeTs);
  assert.ok(mappa, "DA_AMBIENTE non trovato in sede.ts");
  for (const k of chiavi) {
    assert.match(
      mappa[1],
      new RegExp(`\\b${k}\\s*:\\s*import\\.meta\\.env\\.${k.toUpperCase()}\\b`),
      `${k} non ha il suo ripiego d'ambiente scritto per esteso`,
    );
  }

  // ⚠️ Scritto per esteso e non `import.meta.env[nome]`: Vite sostituisce
  // guardando il testo, e un accesso calcolato renderebbe `undefined` nel
  // build — pagamenti che funzionano in dev e non in produzione.
  assert.equal(
    /import\.meta\.env\s*\[/.test(soloCodice(sedeTs)),
    false,
    "accesso calcolato a import.meta.env: non viene sostituito nel build",
  );

  // E l'API non tiene una copia dell'elenco.
  const api = readFileSync("src/pages/api/admin/locations.ts", "utf8");
  assert.match(api, /SEGRETI[^=]*=\s*CHIAVI_SEGRETE/, "locations.ts ha un elenco suo");
});

/* La rete 10: un segreto non si scrive mai in chiaro.
   La tentazione e' salvare comunque «per non bloccare l'utente». Riesce,
   e per questo e' il guasto peggiore: spunta verde, pagamento funzionante,
   chiave leggibile a chiunque apra un backup. */
test("l'API rifiuta di salvare un segreto senza poterlo cifrare", () => {
  const api = readFileSync("src/pages/api/admin/locations.ts", "utf8");
  const ramo = api.slice(api.indexOf("body.secret_key !== undefined"));
  const upsert = ramo.indexOf("location_secrets");
  const guardia = ramo.indexOf("cifraturaPronta()");
  assert.ok(guardia >= 0, "manca il controllo su SECRETS_KEY");
  // La guardia sta PRIMA della scrittura del valore.
  const scrittura = ramo.indexOf("cifra(valore)");
  assert.ok(scrittura > guardia, "si cifra senza aver controllato la chiave madre");
  assert.ok(upsert >= 0);
  assert.equal(
    /value:\s*valore\b/.test(ramo),
    false,
    "il valore in chiaro finisce ancora nel database",
  );
});

/* La rete 11: una chiave che non si apre non e' una chiave che manca.
   ------------------------------------------------------------
   Scritta il 15/09/2026, dopo essermi accorto che la prima versione di
   `leggiSegreto` univa i due casi in un `suo || ambiente`. Quel `||` e'
   il punto esatto in cui i soldi di una societa' finiscono su un'altra
   senza che niente si lamenti: la riga c'e', non si apre, e il motore
   incassa tranquillo con la chiave del .env. */
test("un segreto illeggibile si ferma, uno assente ripiega", () => {
  // Nessuna riga: e' una configurazione, non un guasto. E' il caso dei
  // quattro clienti a sede unica, e deve restare silenzioso.
  assert.equal(scegliSegreto(null, "sk_env", "stripe_secret_key"), "sk_env");
  // Nessuna riga e nemmeno l'ambiente: vuoto, e decide chi chiama.
  assert.equal(scegliSegreto(null, "", "stripe_secret_key"), "");

  // La chiave della sede vince sull'ambiente, sempre.
  assert.equal(scegliSegreto("sk_sede", "sk_env", "stripe_secret_key"), "sk_sede");

  // ⚠️ Riga presente che non si apre: si FERMA. Non ripiega, nemmeno se
  // l'ambiente avrebbe una chiave perfettamente funzionante — anzi,
  // soprattutto allora, perche' e' il caso in cui il guasto riuscirebbe.
  assert.throws(
    () => scegliSegreto("", "sk_env", "stripe_secret_key"),
    SegretoIlleggibile,
    "una chiave illeggibile e' ripiegata sull'ambiente: incasso sul conto sbagliato",
  );
  // E il messaggio dice cosa fare, non solo che c'e' un problema.
  assert.throws(() => scegliSegreto("", "", "stripe_webhook_secret"), /SECRETS_KEY/);
});

/* ============================================================
   LA HOME DELL'ADMIN — ogni tile guarda la sede selezionata
   ------------------------------------------------------------
   La home e' fatta di tile che si riempiono ognuna con la sua
   chiamata. Una che dimentica la sede non da' errore e non si
   vede: mostra dei numeri, giusti per un altro punto vendita.
   E' il guasto peggiore di tutto il multi-sede, perche' e'
   CREDIBILE — 12 prenotazioni sono 12 prenotazioni, e nessuno
   va a contarle a mano.

   La rete legge le `fetch()` della home, trova il file di ogni
   endpoint, e pretende che dichiari dove sta. Tre modi leciti:

     ambitoDiRichiesta  la sede scelta nell'header. E' la norma.
     x-sede             endpoint pubblico a cui la home dice
                        esplicitamente quale punto vuole.
     MARCHIO            elenco qui sotto: roba che per costruzione
                        e' del gruppo, con scritto il perche'.

   Tutto il resto e' rosso. Una tile nuova che si dimentica la
   sede fallisce qui, non davanti al ristoratore.
   ============================================================ */
const HOME_MARCHIO = {
  "/api/admin/events":
    "eventi locali di Bruxelles (app_config): sono della citta', non di un punto",
  "/api/admin/home-layout":
    "disposizione delle tile (app_config): e' una preferenza di chi guarda",
  "/api/admin/search-console":
    "Search Console (app_config): un dominio solo per tutto il gruppo",
  "/api/admin/images":
    "pulizia dello Storage: filtrare qui vorrebbe dire CANCELLARE i file " +
    "di un'altra sede perche' non si vedono. Vedi la nota in images.ts",
};

test("ogni tile della home legge la sede selezionata", () => {
  const home = readFileSync("src/pages/admin/index.astro", "utf8");

  // Gli endpoint chiamati dalla home. ⚠️ Sul testo CON le stringhe: e'
  // proprio la stringa dell'URL che si sta cercando.
  const punti = [...new Set([...home.matchAll(/fetch\(\s*"(\/api\/[^"?]+)/g)].map((m) => m[1]))];
  assert.ok(punti.length > 8, `trovati solo ${punti.length} endpoint: la ricerca non funziona`);

  // Chi riceve l'header `x-sede` in questa pagina: la home glielo dice.
  const conHeader = new Set();
  for (const m of home.matchAll(/fetch\(\s*"(\/api\/[^"?]+)[^;]{0,300}?hSede\(\)/g)) {
    conHeader.add(m[1]);
  }

  const senza = [];
  for (const p of punti) {
    if (HOME_MARCHIO[p]) continue;      // dichiarato del gruppo, con motivo
    if (conHeader.has(p)) continue;     // la home dice quale punto vuole

    let f = `src/pages${p}.ts`;
    if (!esiste(f)) f = `src/pages${p}/index.ts`;
    assert.ok(esiste(f), `${p}: endpoint non trovato (${f})`);
    if (!/ambitoDiRichiesta/.test(soloCodice(readFileSync(f, "utf8")))) senza.push(`${p} (${f})`);
  }
  assert.deepEqual(
    senza.sort(),
    [],
    `tile della home che non guardano la sede selezionata:\n  ${senza.join("\n  ")}`,
  );
});

/* E l'elenco delle eccezioni non deve marcire: una voce che parla
   di un endpoint che la home non chiama piu' e' una riga che
   qualcuno leggera' come se fosse ancora vera. */
test("l'elenco «e' del marchio» della home non contiene voci morte", () => {
  const home = readFileSync("src/pages/admin/index.astro", "utf8");
  const punti = new Set([...home.matchAll(/fetch\(\s*"(\/api\/[^"?]+)/g)].map((m) => m[1]));
  const morte = Object.keys(HOME_MARCHIO).filter((p) => !punti.has(p));
  assert.deepEqual(morte.sort(), [], `eccezioni per endpoint che la home non chiama piu': ${morte.join(", ")}`);
  // E ognuna deve avere un motivo scritto, non una stringa vuota.
  for (const [p, perche] of Object.entries(HOME_MARCHIO)) {
    assert.ok(String(perche).length > 20, `${p}: manca il motivo`);
  }
});

/* La parte SSR: la home si disegna la prima volta sul server, e
   quei dati arrivano da `caricaHomeData(ambito)`. Se dentro ci
   fosse una lettura che non passa l'ambito, la prima schermata
   sarebbe di un'altra sede e si correggerebbe da sola al primo
   aggiornamento — cioe' il genere di cosa che si vede una volta,
   non si riesce a rifare, e si finisce per dare per sbagliata. */
test("i dati SSR della home passano tutti dall'ambito", () => {
  const src = soloCodice(readFileSync("src/lib/admin/caricaHomeData.ts", "utf8"));

  // La funzione prende l'ambito e non se lo inventa.
  assert.match(src, /export async function caricaHomeData\(\s*ambito: Ambito/);
  assert.equal(
    /ambitoPubblico|SEDE_UNICA|tutteLeSedi/.test(src),
    false,
    "caricaHomeData si sceglie una sede da sola invece di usare quella ricevuta",
  );

  // Ogni lettura di tabella dichiara l'ambito. `leggi("x", ambito, …)` va
  // bene; un `supabaseAdmin.from("x")` nudo no — la' il filtro non c'e'.
  const nude = [...src.matchAll(/supabaseAdmin\s*\.from\(\s*""\s*\)/g)];
  assert.equal(nude.length, 0, "caricaHomeData legge una tabella senza passare dall'ambito");

  // E la home gliel'ho passato davvero.
  const pagina = soloCodice(readFileSync("src/pages/admin/index.astro", "utf8"));
  assert.match(
    pagina,
    /caricaHomeData\(\s*await ambitoDiRichiesta\(/,
    "la home non passa a caricaHomeData la sede della richiesta",
  );
});

/* ============================================================
   ORDINI — dove finiscono i soldi e di chi sono le righe
   ------------------------------------------------------------
   Un ordine tocca tre cose che nel multi-sede possono sbagliare
   in silenzio: la riga (di quale punto e'), il prezzo (le
   varianti sono per punto) e il conto (di quale societa').
   Nessuna delle tre da' errore quando sbaglia.
   ============================================================ */

/* La rete 12: mezzo Stripe non e' Stripe.
   Scritta quando abbiamo deciso di nascondere il link di pagamento. */
test("il link di pagamento si offre solo se le due meta' del conto sono la stessa", () => {
  // Tutto dall'ambiente: e' l'installazione a sede unica di oggi.
  assert.equal(pagamentoOnlinePronto("ambiente", "ambiente"), true);
  // Tutto dalla sede: e' il gruppo configurato bene.
  assert.equal(pagamentoOnlinePronto("sede", "sede"), true);

  // ⚠️ MEZZE CONFIGURAZIONI. La chiave e' della sede, la firma dell'ambiente:
  // l'evento «pagato» arriva firmato dal conto della sede e viene verificato
  // con il segreto di un altro. Non verifica. L'ordine resta «in attesa» per
  // sempre, i soldi sono su Stripe, e in cucina non arriva niente.
  assert.equal(pagamentoOnlinePronto("sede", "ambiente"), false);
  assert.equal(pagamentoOnlinePronto("ambiente", "sede"), false);

  // E se ne manca una, non se ne parla.
  for (const f of ["sede", "ambiente", "nessuna"]) {
    assert.equal(pagamentoOnlinePronto("nessuna", f), false, `chiave assente, firma ${f}`);
    assert.equal(pagamentoOnlinePronto(f, "nessuna"), false, `firma assente, chiave ${f}`);
  }
});

/* La rete 13: il bottone nascosto non e' un controllo.
   Chi manda la richiesta e' il browser — uno schermo rimasto aperto da
   stamattina, per dire. Il server deve rifiutare per conto suo. */
test("un ordine «link» si rifiuta lato server se la sede non incassa", () => {
  const api = soloCodice(readFileSync("src/pages/api/admin/orders.ts", "utf8"));
  assert.match(
    api,
    /pagamentoOnlineAttivo\(\s*ambito\s*\)/,
    "il POST degli ordini non controlla se questa sede puo' incassare",
  );
  // E il controllo sta PRIMA dell'inserimento: rifiutare dopo aver creato
  // l'ordine vorrebbe dire lasciarne in giro di monchi.
  const guardia = api.indexOf("pagamentoOnlineAttivo");
  const insert = api.indexOf("inserisciRiga(");
  assert.ok(guardia >= 0 && insert > guardia, "si controlla dopo aver inserito l'ordine");

  // Lato pagina: il bottone parte nascosto dal SERVER, e il reset del modale
  // non lo fa riapparire (ci si era gia' cascati con `style.display = ""`).
  const pag = readFileSync("src/pages/admin/orders.astro", "utf8");
  assert.match(pag, /id="nc-link"[\s\S]{0,200}data-off=\{pagaOnline \? undefined : "1"\}/);
  assert.equal(
    /nc-link"\) as HTMLElement\)\.style\.display = "";/.test(pag),
    false,
    "il reset del modale rimette il link di pagamento senza guardare data-off",
  );
});

/* La rete 14: ogni lettura e ogni scrittura degli ordini passa dal filtro.
   `orders` e' una tabella di sede, e `supabaseAdmin` scavalca la RLS: sotto
   al codice non c'e' nessuna rete. Un `.from("orders")` nudo in questi file
   vuol dire gli ordini di un'altra societa' sullo schermo — o, in una
   UPDATE, l'ordine di un'altra societa' cambiato. */
test("nessuno legge o scrive `orders` scavalcando il filtro di sede", () => {
  // ⚠️ SU TUTTO `src/`, non su un elenco di file scritto a mano. Un elenco
  // non conosce il file che qualcuno aggiungera' domani — ed e' proprio
  // quello il file che dimentichera' il filtro. (Scritto dopo aver provato
  // con l'elenco: si era gia' lasciate fuori le tre pagine
  // `order-confirm.astro`, che leggevano `orders` nude.)
  const FILE = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) FILE.push(p);
    }
  })("src");

  const nude = [];
  for (const f of FILE) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/supabaseAdmin\s*\.from\(\s*"orders"\s*\)/g)) {
      nude.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    nude.sort(),
    [],
    "letture di «orders» fuori dal passaggio obbligato (usa `leggi(\"orders\", ambito, …)`, " +
      `e se l'ambito giusto e' l'aggregato scrivilo per nome):\n  ${nude.join("\n  ")}`,
  );
});

/* La rete 15: un ordine non nasce mai senza sede.
   `inserisci` lo garantisce gia' — `sedeDaScrivere` lancia sull'aggregato —
   ma qui si prova la regola vera, non la si deduce dal codice. */
test("un ordine non si crea nell'aggregato, e nasce sempre con la sua sede", () => {
  // Con una sede scelta, la riga la porta scritta.
  assert.equal(sedeDaScrivere("orders", sede(JOURDAN)), JOURDAN);
  // A sede unica resta null, ed e' giusto: non c'e' niente da separare.
  assert.equal(sedeDaScrivere("orders", SEDE_UNICA), null);
  // ⚠️ E dall'aggregato non si crea niente: «tutte le sedi» non e' un posto
  // dove si prende un ordine, e' un modo di guardare.
  assert.throws(() => sedeDaScrivere("orders", tutteLeSedi()), /aggregato|tutte/i);
});

/* La rete 16: i tre posti dove l'aggregato E' la risposta giusta.
   Sono letture che partono da un SEGRETO in mano a chi chiama — l'id di
   sessione Stripe, il token di annullo — e li' il segreto e' gia'
   l'autorizzazione. Filtrando, il pagamento di due sedi su tre resterebbe
   per sempre «in attesa» e il link «annulla» non farebbe niente.

   Devono essere pochi, dichiarati, e con il perche' scritto accanto. */
const AMMESSI_AGGREGATO = {
    "src/pages/api/stripe-webhook.ts":
      "Stripe chiama con l'id della sessione e non sa niente di sedi: la firma e' l'autorizzazione",
    "src/pages/api/order-cancel.ts":
      "l'ordine si trova con il suo cancel_token, che e' un segreto: il token E' l'autorizzazione",
    // ⚠️ Stessa forma dell'annullo: il servizio di stampa non sa fare login e
    // non sa niente di sedi — ha solo l'indirizzo del ticket. Filtrando per
    // sede, la stampa funzionerebbe per il primo punto e per gli altri non
    // uscirebbe niente, senza nessun errore da nessuna parte. L'ORDINE pero'
    // si rilegge nell'ambito della sua riga, non nell'aggregato.
    "src/pages/api/print/[token].ts":
      "il ticket si trova con il suo token, che e' un segreto: il token E' l'autorizzazione",
    // ⚠️ Le versioni radice e /en erano uscite dal motore il 16/09/2026 con le
    // altre pagine vetrina. Rinascono NEI CLIENTI (25/09/2026): il ritorno da
    // Stripe e' una pagina del sito pubblico, e ogni cliente ha la sua. Qui nel
    // motore non esistono, e va bene: il motore non ha un sito.
    "src/pages/demo01/order-confirm.astro":
      "la pagina di ritorno da Stripe ha l'id di sessione, che e' l'autorizzazione",
    // ⚠️ Vale per TUTTE le lingue del cliente: la chiave si cerca senza il
    // prefisso (vedi `chiaveAmmessi` qui sotto).
    "src/pages/order-confirm.astro":
      "ritorno da Stripe sul sito del cliente: chi torna dal pagamento non dice " +
      "da quale punto, e l'id di sessione E' l'autorizzazione",
    // ⚠️ Educazione Napoletana tiene il corpo della pagina in UN componente
    // condiviso dalle tre lingue, invece di tre pagine gemelle: il percorso
    // non e' sotto `src/pages`, quindi `chiaveAmmessi` non lo riporta a
    // `order-confirm.astro` e va dichiarato per nome. La ragione e' la stessa:
    // chi torna da Stripe non dice da quale punto ha ordinato.
    "src/components/pages/OrderConfirmPage.astro":
      "ritorno da Stripe, corpo condiviso fra le lingue: l'id di sessione E' l'autorizzazione",
    "src/pages/api/reservation.ts":
      "i link «modifier» e «annuler» arrivano da un'email: il cliente non ha " +
      "scelto nessun punto sul sito e non deve doverlo fare. Il cancel_token e' " +
      "un uuid non indovinabile ed e' LUI l'autorizzazione; la sede la dice poi " +
      "la riga trovata. Filtrando, due clienti su tre si vedevano rispondere " +
      "«lien invalide» su una prenotazione che esisteva",
    "src/pages/api/cron/auto-complete-orders.ts":
      "il cron non nasce da una richiesta e non ha nessuna sede scelta: e' manutenzione del gruppo",
    "src/pages/api/admin/coupons.ts":
      "il numero di utilizzi DEVE contare quello che il limite fa rispettare, e il " +
      "limite (verificaLimitiUso) conta gli ordini di tutte le sedi: il coupon e' del " +
      "marchio. Con la sede selezionata l'admin mostrava «40 / 100» su un codice gia' " +
      "esaurito a 100 — un numero e' peggio di nessun numero quando e' sbagliato",
    "src/pages/api/admin/clients.ts":
      "il cliente e' del MARCHIO: la sua spesa e le sue visite sono quelle del gruppo, " +
      "non quelle che ha lasciato a un punto solo",
    "src/lib/admin/caricaClienti.ts":
      "stessa lista, disegnata sul server: deve vedere esattamente quello che vede l'API",
    "src/lib/rappelReservations.ts":
      "il promemoria e' un cron: nessuna sede scelta, e riguarda i clienti di tutti i punti",
    "src/lib/newsletterSend.ts":
      "la rubrica e' del MARCHIO: una persona che ordina qui e prenota la' riceve " +
      "una copia sola, quindi i destinatari si contano sul gruppo",
};

/**
 * La chiave dell'elenco, SENZA il prefisso di lingua del cliente.
 *
 * ⚠️ `src/pages/it/order-confirm.astro` e `src/pages/nl/order-confirm.astro`
 * sono la STESSA pagina in un'altra lingua. Il motore non sa quali lingue ha
 * un cliente e non deve saperlo — e' la lezione gia' scritta in
 * `src/lib/seo/sitemapRegole.ts`, dove elencare `/order-confirm` e
 * `/en/order-confirm` avrebbe lasciato in sitemap le pagine italiane e
 * olandesi di L'Huile. Qui il difetto sarebbe l'opposto: con i percorsi
 * esatti, L'Huile (fr/en/it/nl) diventerebbe rossa su due pagine identiche a
 * una dichiarata, e la cura ovvia — aggiungere due righe al motore —
 * significherebbe mettere le lingue di un cliente dentro il motore.
 *
 * `api` non ci casca: sono tre lettere, non due.
 */
const chiaveAmmessi = (f) => f.replace(/^src\/pages\/[a-z]{2}\//, "src/pages/");

/** I file che chiamano `tutteLeSedi()`. Lo calcolano tutt'e due le prove qui
 *  sotto: una ne cerca di non dichiarati, l'altra di dichiarati a vuoto. */
function fileCheUsanoAggregato() {
  // ⚠️ Su TUTTO `src/`, non solo su `src/pages`. La prima versione guardava
  // solo le pagine e si era gia' lasciata fuori due usi veri in `src/lib`
  // (il promemoria delle prenotazioni e la lista clienti del server). Un
  // elenco di cartelle invecchia esattamente come un elenco di file.
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");
  return file
    .filter((f) => f !== "src/lib/admin/sede.ts" && f !== "src/lib/admin/sedeRegole.ts")
    .filter((f) => /\btutteLeSedi\(\)/.test(soloCodice(readFileSync(f, "utf8"))));
}

test("l'aggregato negli ordini si usa solo dove e' dichiarato", () => {
  const nonDichiarati = fileCheUsanoAggregato().filter((f) => !AMMESSI_AGGREGATO[chiaveAmmessi(f)]);
  assert.deepEqual(
    nonDichiarati.sort(),
    [],
    `usano l'aggregato senza dichiararlo:\n  ${nonDichiarati.join("\n  ")}`,
  );
});

/**
 * E ogni voce ammessa deve essere ancora vera — MA SOLO NEL MOTORE.
 *
 * ⚠️ Un file che NON ESISTE non e' un'eccezione morta: un cliente vero
 * cancella le pagine `demo01`, che sono il modello e non il suo sito. La
 * prima versione le dava per scontate e diventava rossa su 450 Gradi appena
 * arrivava il merge.
 *
 * ⚠️ E nemmeno un file che ESISTE ma legge in un altro modo. Il 25/09/2026
 * abbiamo dichiarato `src/pages/order-confirm.astro`, che nel motore non c'e'
 * e in un cliente si'. Negli altri quattro clienti quella pagina esiste da
 * sempre e legge l'ordine direttamente da `supabaseAdmin`, senza passare da
 * `tutteLeSedi()`: sarebbe stata contata come eccezione morta, e la prova
 * sarebbe diventata rossa su quattro repo in una volta.
 *
 * Tenere onesto l'elenco e' un lavoro DEL MOTORE. In un cliente, se una
 * dichiarazione del motore sia ancora usata non e' una domanda che abbia
 * senso fare.
 */
test.skipIf(!SONO_IL_MOTORE)("le eccezioni sull'aggregato sono ancora vere", () => {
  const usanti = fileCheUsanoAggregato();
  const morte = Object.keys(AMMESSI_AGGREGATO)
    .filter((f) => existsSync(f))
    .filter((f) => !usanti.includes(f));
  assert.deepEqual(morte.sort(), [], `dichiarati ma non usano piu' l'aggregato: ${morte.join(", ")}`);
});

/* ============================================================
   PRENOTAZIONI — la sala e' un posto fisico
   ------------------------------------------------------------
   Gli ordini sbagliano sui soldi; le prenotazioni sbagliano
   sullo SPAZIO. Un tavolo e' un oggetto che sta in una stanza:
   una prenotazione accettata a Stockel che occupa i tavoli di
   Jourdan non e' un numero sbagliato, e' gente in piedi sulla
   porta il sabato sera.
   ============================================================ */

/* La rete 17: l'inventario COMPLETO di chi scavalca il filtro.
   ------------------------------------------------------------
   Non un elenco di file da controllare — l'elenco di tutti i
   posti in cui una tabella di sede si legge senza passare da
   `leggi/inserisci/aggiorna/cancella`. Si ricava da CLASSIFICA e
   si scandisce tutto `src/`, quindi non puo' restare indietro.

   Ogni voce ha il perche' scritto qui. Non e' burocrazia: il
   giorno che qualcuno aggiunge una lettura nuda, o questo test
   diventa rosso, o quella persona deve scrivere una frase che
   spieghi perche' va bene — e scrivendola si accorge se non va
   bene. E' l'unica difesa che abbiamo, perche' sotto c'e'
   `supabaseAdmin`, che scavalca la RLS. */
const SCAVALCANO = {
  "src/lib/admin/sede.ts":
    "e' il passaggio obbligato: location_config/settings/secrets li legge per definizione lui",
  "src/lib/appConfigCache.ts":
    "cache per sede di location_config, gia' chiavata sull'id del punto",
  "src/lib/googleBusiness.ts":
    "sincronizzazione recensioni: la sede si ricava dalla scheda Google, non dal filtro",
  "src/lib/menuStato.ts":
    "filtra a mano su ambito.id: la lettura e' gia' di un punto solo",
  "src/lib/push.ts":
    "cancella endpoint dichiarati morti da Apple/Google: vanno via di qualunque punto siano",
  "src/pages/api/admin/docs.ts":
    "i documenti si separano per PERCORSO nel bucket, non per colonna (vedi radiceDocs)",
  "src/pages/api/admin/gift-cards.ts":
    "i riscatti si LEGGONO su tutto il gruppo (un buono si compra qui e si spende la'), " +
    "si SCRIVONO per sede",
  // ⚠️ `images.ts` non c'e' piu' (16/09/2026): l'unica tabella di sede che
  // leggeva nuda era `agenda_events`, diventata mista. Continua a leggere
  // `menu_items` e `popups` senza filtro, e va bene: una pulizia dello
  // Storage che filtra CANCELLA i file che non vede. La ragione resta
  // scritta nel file; qui non serve piu', e una voce che non serve piu' e'
  // una voce che qualcuno leggera' come se fosse ancora vera.
  "src/pages/api/admin/gift-cards-pdf.ts":
    "releve' contabile: legge i riscatti INTERI apposta, perche' la meta' " +
    "interessante e' quello che e' successo ALTROVE (i nostri buoni onorati " +
    "da un'altra societa'). Filtrando, quella riga sarebbe sempre zero — e " +
    "uno zero sembra un dato, non un buco. Il taglio per sede lo fa " +
    "`relevePunto`, che ha i suoi test",
  "src/pages/api/admin/locations.ts":
    "e' il pannello che amministra le sedi: guardarle tutte e' il suo mestiere",
  "src/pages/api/admin/push.ts":
    "onConflict su `endpoint` da solo: e' unico al mondo e non esiste un indice a due colonne",
};

test("ogni lettura che scavalca il filtro di sede e' dichiarata", () => {
  const reg = readFileSync("src/lib/admin/sedeRegole.ts", "utf8");
  const diSede = Object.keys(CLASSIFICA).filter((t) => CLASSIFICA[t] === "sede");
  assert.ok(diSede.length > 10, "CLASSIFICA non ha abbastanza tabelle di sede");
  void reg;

  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");

  const trovati = new Set();
  for (const f of file) {
    const src = readFileSync(f, "utf8");
    for (const t of diSede) {
      if (new RegExp(`supabaseAdmin\\s*\\.from\\(\\s*"${t}"\\s*\\)`).test(src)) trovati.add(f);
    }
  }

  const nonDichiarati = [...trovati].filter((f) => !SCAVALCANO[f]);
  assert.deepEqual(
    nonDichiarati.sort(),
    [],
    "leggono una tabella di sede senza il filtro e senza dire perche':\n  " +
      `${nonDichiarati.join("\n  ")}\n(se e' voluto, aggiungilo a SCAVALCANO con la ragione)`,
  );

  const morte = Object.keys(SCAVALCANO).filter((f) => !trovati.has(f));
  assert.deepEqual(morte.sort(), [], `dichiarati ma non scavalcano piu' niente: ${morte.join(", ")}`);

  // ⚠️ E le tabelle della SALA non compaiono mai qui. Se un giorno una di
  // queste finisse in un'eccezione, vorrebbe dire prenotazioni o tavoli di
  // un'altra sede: nessuna ragione e' abbastanza buona.
  for (const t of ["reservations", "restaurant_tables", "service_closures", "zone_closures", "orders"]) {
    for (const f of file) {
      assert.equal(
        new RegExp(`supabaseAdmin\\s*\\.from\\(\\s*"${t}"\\s*\\)`).test(readFileSync(f, "utf8")),
        false,
        `${f}: legge «${t}» senza filtro, e per questa tabella non ci sono eccezioni`,
      );
    }
  }
});

/* La rete 18: un cron non ha nessuna sede selezionata.
   ------------------------------------------------------------
   `ambitoPubblico()` rende la PRIMA sede. E' un ripiego onesto
   per il sito pubblico, che una sede ce l'ha; per un cron e' una
   scelta a caso travestita da valore predefinito.

   Il 16/09/2026 il promemoria delle prenotazioni faceva
   esattamente questo: i clienti di due pizzerie su tre non lo
   ricevevano mai. Il cron rispondeva «sent: 4» e sembrava
   funzionare — un'email che non parte non lascia traccia da
   nessuna parte. */
test("nessun lavoro automatico si sceglie la sede con ambitoPubblico", () => {
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.ts$/.test(nome)) file.push(p);
    }
  })("src");

  // Chi e' «un lavoro automatico»: gli endpoint sotto api/cron e tutto
  // quello che chiamano di primo livello in lib/.
  // ⚠️ `sede.ts` fuori: e' il file che DEFINISCE `ambitoPubblico`, e lo
  // richiama come ripiego in `ambitoPubblicoChiesto`. Accusarlo vorrebbe dire
  // che la rete non distingue chi scrive la regola da chi la usa male.
  const DEFINIZIONE = "src/lib/admin/sede.ts";
  const cron = file.filter((f) => f.includes("/api/cron/"));
  assert.ok(cron.length >= 4, `trovati solo ${cron.length} cron: la ricerca non funziona`);

  const catena = new Set(cron);
  for (const f of cron) {
    for (const m of soloCodice(readFileSync(f, "utf8")).matchAll(/from\s+""/g)) void m;
    for (const m of readFileSync(f, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
      const rel = m[1];
      if (!rel.startsWith(".")) continue;
      const base = join(f, "..", rel);
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (esiste(cand)) catena.add(cand);
    }
  }

  catena.delete(DEFINIZIONE);
  const colpevoli = [...catena].filter((f) => /\bambitoPubblico\(\)/.test(soloCodice(readFileSync(f, "utf8"))));
  assert.deepEqual(
    colpevoli.sort(),
    [],
    "lavori automatici che prendono la PRIMA sede invece di dire quale vogliono:\n  " +
      `${colpevoli.join("\n  ")}\n(usa tutteLeSedi() se e' del gruppo, o un giro su elencoSedi() se e' per punto)`,
  );
});

/* La rete 19: la sala si filtra, sempre e su tutto.
   Le quattro tabelle che dicono quanti posti ci sono e quando
   sono chiusi. Se una sola non filtrasse, la disponibilita'
   mostrata al cliente sarebbe la somma di tre ristoranti. */
test("le tabelle della sala si filtrano per sede, e i giorni speciali vedono anche il marchio", () => {
  const SALA = ["reservations", "restaurant_tables", "service_closures", "zone_closures"];
  for (const t of SALA) {
    assert.equal(CLASSIFICA[t], "sede", `${t} non e' classificata come tabella di sede`);
    assert.deepEqual(
      filtroPer(t, sede(JOURDAN)),
      { tipo: "sede", valore: JOURDAN },
      `${t}: dentro un punto si vedrebbero anche gli altri`,
    );
    // E non si scrive nell'aggregato: una prenotazione sta in UNA sala.
    assert.throws(() => sedeDaScrivere(t, tutteLeSedi()), /aggregato|tutte/i, `${t}`);
  }

  // ⚠️ `special_days` e' MISTA, ed e' l'unica della sala a esserlo: Natale
  // chiude tutti, i lavori chiudono un punto solo. Dentro una sede si devono
  // vedere le proprie chiusure E quelle del marchio — vederne una sola delle
  // due vuol dire aprire un giorno di festa, o chiudere per lavori altrui.
  assert.equal(CLASSIFICA.special_days, "mista");
  const f = filtroPer("special_days", sede(JOURDAN));
  assert.equal(f.tipo, "sede-o-marchio", "special_days non guarda piu' il marchio");
  assert.match(f.espressione, new RegExp(JOURDAN));
  assert.match(f.espressione, /null/i);
});

/* La rete 20: chi calcola la disponibilita' dichiara di quale
   sala parla. Sono le funzioni che stanno fra il database e il
   numero di coperti liberi: un ambito facoltativo qui e' un
   ambito dimenticato. */
test("il calcolo della disponibilita' riceve sempre la sala di cui parla", () => {
  const OBBLIGATORIO = [
    ["src/lib/planSalle.ts", /ambito: Ambito/],
    ["src/lib/admin/caricaResaGiorno.ts", /ambito: Ambito/],
    ["src/lib/admin/statsResa.ts", /ambito: Ambito/],
  ];
  for (const [f, re] of OBBLIGATORIO) {
    const src = soloCodice(readFileSync(f, "utf8"));
    assert.match(src, re, `${f}: l'ambito non e' un parametro dichiarato`);
    // ⚠️ E non ci deve essere nessun `ambito?:` — un parametro facoltativo e'
    // un parametro dimenticato, e qui dimenticarlo vuol dire sommare le sale.
    assert.equal(
      /ambito\?\s*:/.test(src),
      false,
      `${f}: l'ambito e' facoltativo, quindi prima o poi non lo passera' nessuno`,
    );
    assert.equal(
      /ambitoPubblico\(\)/.test(src),
      false,
      `${f}: si sceglie una sala da solo invece di usare quella ricevuta`,
    );
  }
});

/* ============================================================
   EMAIL E NOTIFICHE — l'errore che finisce per strada
   ------------------------------------------------------------
   Gli ordini sbagliano sui soldi, le prenotazioni sullo spazio.
   Le email sbagliano sul MONDO FISICO: nome, indirizzo, telefono
   e mittente. Una conferma di Stockel con la via di Schaerbeek
   non e' un numero storto su uno schermo — e' una persona che
   suona a un citofono sbagliato, con la pizza che si fredda.

   E' anche l'unico guasto del multi-sede che il ristoratore non
   vede mai: l'email parte, il log dice «inviata», e la sola
   persona che se ne accorge e' il cliente.
   ============================================================ */

/* La rete 21: i dati del ristorante si chiedono sempre per un punto. */
test("i dati del ristorante si chiedono per una sede, mai in generale", () => {
  // ⚠️ Testo integrale, non `soloCodice`: qui si controlla proprio il
  // contenuto di una stringa (la chiave di cache).
  const src = readFileSync("src/lib/ristorante.ts", "utf8");

  // Parametro OBBLIGATORIO. Facoltativo = dimenticato, e dimenticarlo non
  // da' nessun errore: da' l'indirizzo giusto di un'altra pizzeria.
  assert.match(src, /export async function datiRistorante\(\s*ambito: Ambito\s*\)/);
  assert.equal(/datiRistorante\(\s*ambito\?\s*:/.test(src), false, "l'ambito e' diventato facoltativo");

  // ⚠️ E la cache e' PER SEDE. Con una chiave sola, la prima email di un
  // punto riempiva la cache e per un minuto tutti gli altri mandavano il suo
  // indirizzo — sessanta secondi di email sbagliate, non richiamabili.
  assert.match(src, /"ristorante:dati"\s*\+\s*\(ambito\.modo === "sede" \? `:\$\{ambito\.id\}` : ""\)/);

  // Nessuno la chiama a mani vuote, in nessun file.
  const file = [];
  (function scorri(dir) {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) scorri(p);
      else if (/\.(ts|astro)$/.test(nome)) file.push(p);
    }
  })("src");
  const nude = [];
  for (const f of file) {
    const testo = readFileSync(f, "utf8");
    for (const m of testo.matchAll(/datiRistorante\(\s*\)/g)) {
      nude.push(`${f}:${testo.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(nude.sort(), [], `datiRistorante() senza sede:\n  ${nude.join("\n  ")}`);
});

/* La rete 22: chi manda email non legge la configurazione a mano.
   `appConfigIn/Eq` sovrappongono la sede all'installazione e hanno la cache
   per punto; una query diretta su `app_config` rende SEMPRE il marchio, e
   non lo dice. */
test("le notifiche leggono la configurazione dal passaggio per sede", () => {
  const DICHIARATI = {
    "src/lib/temaBrand.ts":
      "i colori sono l'identita' visiva del MARCHIO: 450 Gradi e' un marchio " +
      "solo anche se sono tre societa'",
  };
  const FILE = ["src/lib/notifications.ts", "src/lib/ristorante.ts", "src/lib/temaBrand.ts", "src/lib/newsletterSend.ts"];
  const colpevoli = [];
  for (const f of FILE) {
    if (DICHIARATI[f]) continue;
    // Il nome della tabella e' una stringa: va cercato nel testo vero.
    const src = readFileSync(f, "utf8");
    if (/supabaseAdmin\s*\.from\(\s*"app_config"\s*\)/.test(src)) colpevoli.push(f);
  }
  assert.deepEqual(
    colpevoli.sort(),
    [],
    "leggono una tabella a mano invece che da appConfigIn/Eq (che sovrappone la sede):\n  " +
      colpevoli.join("\n  "),
  );
  for (const [f, perche] of Object.entries(DICHIARATI)) {
    assert.ok(esiste(f), `${f}: dichiarato ma non esiste piu'`);
    assert.ok(String(perche).length > 20, `${f}: manca il motivo`);
  }
});

/* La rete 23: la sede viaggia CON IL FATTO.
   ------------------------------------------------------------
   La stessa email puo' partire da tre contesti diversi — l'admin,
   il webhook di Stripe, un cron — e in due su tre non c'e'
   nessuna sede selezionata. Il fatto invece e' uno solo e la sua
   sede ce l'ha scritta sopra. Stessa regola del conto Stripe:
   chi incassa lo decide l'ordine, non chi guarda lo schermo. */
test("ogni riga che diventa un'email porta la sua sede, e non e' facoltativa", () => {
  const src = readFileSync("src/lib/notifications.ts", "utf8");

  for (const nome of ["OrdineNotifica", "ResaEmail", "ResaReview"]) {
    const i = src.indexOf(`interface ${nome} {`);
    assert.ok(i > 0, `interfaccia ${nome} non trovata`);
    const corpo = src.slice(i, src.indexOf("\n}", i));
    assert.match(corpo, /\n\s*location_id: string \| null;/, `${nome}: manca location_id`);
    // ⚠️ `location_id?:` renderebbe il campo facoltativo, e il compilatore
    // smetterebbe di indicare i punti di chiamata che se lo dimenticano.
    assert.equal(/location_id\?\s*:/.test(corpo), false, `${nome}: location_id e' facoltativo`);
  }

  // E dentro, l'ambito si ricava dalla RIGA, non da una richiesta.
  const codice = soloCodice(src);
  assert.ok(
    (codice.match(/const ambito = ambitoDiRiga\(/g) ?? []).length >= 15,
    "le funzioni email non ricavano piu' l'ambito dalla riga",
  );
  for (const vietato of ["ambitoDiRichiesta", "ambitoPubblico"]) {
    assert.equal(
      new RegExp(`\\b${vietato}\\(`).test(codice),
      false,
      `notifications.ts usa ${vietato}: la sede di un'email e' del fatto, non di chi la manda`,
    );
  }
});

/* La rete 24: le righe da cui nasce un'email selezionano la sede.
   Il tipo obbligatorio protegge il codice nuovo, ma non un `as
   unknown as ResaEmail` su una SELECT che non ha chiesto la
   colonna: li' a runtime arriva `undefined`, `ambitoDiRiga` rende
   SEDE_UNICA e l'email esce con i dati del marchio. In silenzio. */
test("le SELECT che alimentano le email chiedono location_id", () => {
  const CAMPI = [
    ["src/pages/api/reservation.ts", /const CAMPI_EMAIL =\s*\n\s*"id, location_id,/],
    ["src/pages/api/admin/zone-closure-impact.ts", /const CAMPI = "id, location_id,/],
    ["src/pages/api/admin/special-days-impact.ts", /const CAMPI =\s*\n\s*"id, location_id,/],
    ["src/lib/rappelReservations.ts", /"id,location_id,date,/],
  ];
  for (const [f, re] of CAMPI) {
    assert.match(readFileSync(f, "utf8"), re, `${f}: la SELECT delle email non chiede location_id`);
  }

  // Il promemoria: la riga deve anche DICHIARARLO, altrimenti TypeScript non
  // sa che c'e' e il campo si perde per strada.
  const rappel = readFileSync("src/lib/rappelReservations.ts", "utf8");
  assert.match(rappel, /interface RowResa \{[\s\S]{0,400}location_id: string \| null;/);
  assert.match(rappel, /location_id: r\.location_id/);
});

/* ============================================================
   CHIAVI DI CONFIGURAZIONE CHE SONO DELLA SEDE (20/09/2026)

   `CLASSIFICA` dice di che livello e' una TABELLA. Ma `app_config` e' una
   tabella sola, del marchio, in cui vivono chiavi di natura diversa: il tema
   e' dell'installazione, «cucina chiusa» e' di UNA porta che chiude.

   Il guasto trovato su 450 Gradi: il bottone «Fermer» SCRIVE con
   `scriviConfig(ambito)` — quindi in `location_config` della sede — mentre
   `checkout.ts` e `caricaToday.ts` LEGGEVANO `app_config` a mano, cioe' il
   marchio. Risultato: cucina chiusa che continuava a ricevere ordini, con il
   ristoratore che vedeva il pulsante rosso e si credeva protetto.

   ⚠️ Scrivere per sede e leggere per marchio non da' nessun errore: da' un
   valore vecchio, sempre plausibile. Per questo serve una rete.
   ============================================================ */
/* ⚠️ QUI C'ERA una rete con UNA chiave sola — `CHIAVI_DI_SEDE =
   ["orders_closed"]` — e un commento che diceva «l'elenco cresce man mano che
   si classificano le altre chiavi». Il 20/09/2026 sono state classificate
   tutte e 81, e la rete si e' spostata in `tests/config.test.mjs`, dove
   guarda tutte le chiavi di sede invece di una, risolve anche quelle passate
   come costanti (`K_LOCATION`) e distingue `app_config` da `location_config`.

   Un elenco che qualcuno deve ricordarsi di allungare non e' una rete: e' un
   promemoria travestito da prova. Questa invece parte dalla classifica, e una
   chiave nuova ci finisce dentro da sola.

   Anche `timezone` aveva il suo commento-promemoria qui, e il 21/09/2026 e'
   stato mantenuto: girata la variabile globale, la riga di
   `CLASSIFICA_CONFIG` e' passata da "marchio" a "sede" e la rete ha elencato
   da sola i diciannove file da aprire. Le prove stanno in
   `tests/fuso.test.mjs`. */

test("chi decide se la cucina e' chiusa sa di quale sede parla", () => {
  for (const f of ["src/pages/api/checkout.ts", "src/lib/admin/caricaToday.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(
      /appConfigEq\("orders_closed",\s*ambito/.test(src),
      `${f}: la chiusura della cucina va letta con l'ambito, altrimenti il bottone «Fermer» di una sede non ferma niente`,
    );
  }
  // E nel checkout l'ambito deve essere calcolato PRIMA del controllo:
  // sotto, leggerebbe il marchio e lascerebbe passare l'ordine.
  const co = readFileSync("src/pages/api/checkout.ts", "utf8");
  assert.ok(
    co.indexOf("ambitoPubblicoChiesto(request)") < co.indexOf('appConfigEq("orders_closed"'),
    "in checkout.ts l'ambito si calcola dopo il controllo di chiusura: il controllo leggerebbe il marchio",
  );
});
