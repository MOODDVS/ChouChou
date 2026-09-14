// Multi-sede: le regole di filtro, provate senza database.
// `sedeRegole.ts` non importa niente apposta — cosi' questi test girano
// sulla funzione VERA, non su una copia che puo' divergere.
import assert from "node:assert/strict";
import { test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
      if (!/\bambito\b|\bSEDE_UNICA\b/.test(chiamata)) {
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

test("multi-sede spento: sede unica, chiunque tu sia", () => {
  assert.deepEqual(scegliSede({ multiAttivo: false, sedi: SEDI, sedeUtente: A }), SEDE_UNICA);
  assert.deepEqual(scegliSede({ multiAttivo: false, sedi: [], sedeChiesta: B }), SEDE_UNICA);
});

test("acceso ma senza sedi: niente da separare", () => {
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: [] }), SEDE_UNICA);
});

test("chi e' legato a una sede resta sulla sua, qualunque cosa chieda", () => {
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeUtente: A, sedeChiesta: B }), sede(A));
});

test("chi vede tutte ottiene quella che chiede, se esiste", () => {
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeChiesta: B }), sede(B));
  // sede inventata o non piu' attiva → la prima, non l'aggregato
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeChiesta: "cccccccc-1111-2222-3333-444444444444" }), sede(A));
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI }), sede(A));
});

test("una sede sparita non apre le porte: si vede il VUOTO", () => {
  // il responsabile era legato a una sede disattivata o cancellata
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeUtente: "dddddddd-1111-2222-3333-444444444444" }), sede(NESSUNA_SEDE));
  // e un id malformato non deve nemmeno lanciare
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeUtente: "tutte" }), sede(NESSUNA_SEDE));
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeUtente: "location_id.is.null" }), sede(NESSUNA_SEDE));
});

test("l'aggregato si ottiene solo chiedendolo per nome", () => {
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeChiesta: CHIESTA_TUTTE }), tutteLeSedi());
  // a multi-sede spento non esiste nessun aggregato: c'e' una sede sola
  assert.deepEqual(scegliSede({ multiAttivo: false, sedi: SEDI, sedeChiesta: CHIESTA_TUTTE }), SEDE_UNICA);
  // e chi e' legato a un punto non lo ottiene nemmeno chiedendolo: e' proprio
  // il tentativo da cui ci si difende, e non deve dare errore, solo non valere
  assert.deepEqual(scegliSede({ multiAttivo: true, sedi: SEDI, sedeUtente: A, sedeChiesta: CHIESTA_TUTTE }), sede(A));
});

test("scegliSede non rende l'aggregato per DIMENTICANZA", () => {
  // Il pericolo non e' l'aggregato chiesto: e' la sede che manca e diventa
  // aggregato in silenzio. Nessuno di questi casi lo e'.
  const casi = [
    { multiAttivo: true, sedi: SEDI },
    { multiAttivo: true, sedi: SEDI, sedeChiesta: "" },
    { multiAttivo: true, sedi: SEDI, sedeUtente: null, sedeChiesta: null },
    { multiAttivo: false, sedi: SEDI },
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
  const nelSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();

  // Nate DOPO il multi-sede: `location_id` e' NOT NULL, non possono
  // avere righe storiche orfane e non vanno nell'elenco.
  const SENZA_STORICO = ["location_config", "location_settings", "location_secrets", "menu_sold_out"];
  const attese = di("sede").filter((t) => !SENZA_STORICO.includes(t)).sort();

  assert.deepEqual(nelSql, attese,
    `l'elenco SQL non combacia con CLASSIFICA.\n  solo nel SQL: ${nelSql.filter((t) => !attese.includes(t))}\n  solo in CLASSIFICA: ${attese.filter((t) => !nelSql.includes(t))}`);

  // E nessuna mista/marchio ci si e' infilata: e' l'errore silenzioso.
  for (const t of nelSql) {
    assert.equal(CLASSIFICA[t], "sede", `${t} e' «${CLASSIFICA[t]}», non «sede»: riempirla cancellerebbe il senso di NULL`);
  }
});
