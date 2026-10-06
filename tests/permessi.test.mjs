/**
 * PERMESSI — la porta, non il cartello.
 *
 * Prima di oggi il ruolo era un suggerimento: la nav nascondeva i link nel
 * browser, e `settings` e `super` si difendevano dentro uno <script>, cioe'
 * dopo che la pagina era gia' stata mandata. Un «utente» che scriveva
 * /admin/stats riceveva il fatturato del giorno gia' calcolato dal server e
 * incollato nell'HTML.
 *
 * Queste prove guardano due cose: la regola (pura) e il fatto che qualcuno la
 * applichi davvero PRIMA di rendere la pagina.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  chiavePagina,
  pagineConsentite,
  puoVederePagina,
  pagineDiDefault,
  pulisciPagine,
  PAGINE_SOLO_ADMIN,
  PAGINE_SOLO_SUPER,
  API_PAGINA,
  PAGINA_APERTA,
  chiaveApi,
  puoChiamareApi,
  funzioneAccesa,
} from "../src/lib/admin/permessiRegole.ts";

const TUTTE = ["orders", "reservations", "clients", "menu", "stats", "marketing", "assets", "print", "agenda", "settings"];

test("dal percorso alla pagina", () => {
  assert.equal(chiavePagina("/admin"), "home");
  assert.equal(chiavePagina("/admin/"), "home");
  assert.equal(chiavePagina("/admin/stats"), "stats");
  assert.equal(chiavePagina("/admin/stats/"), "stats");
  assert.equal(chiavePagina("/admin/super"), "super");
  assert.equal(chiavePagina("/admin/menu?tab=food"), "menu");
  assert.equal(chiavePagina("/"), "");
  assert.equal(chiavePagina("/reservation"), "");
});

test("il super vede tutto, anche cio' che l'installazione ha spento", () => {
  const p = pagineConsentite({ ruolo: "super", nascoste: ["stats", "marketing"], tutte: TUTTE });
  for (const k of TUTTE) assert.ok(p.includes(k), k);
  assert.ok(p.includes("super"));
});

test("l'admin vede tutto TRANNE cio' che l'installazione ha spento", () => {
  const p = pagineConsentite({ ruolo: "admin", nascoste: ["marketing"], tutte: TUTTE });
  assert.ok(p.includes("stats"), "le statistiche sono sue");
  assert.ok(p.includes("settings"));
  assert.ok(!p.includes("marketing"), "spenta per l'installazione");
  assert.ok(!p.includes("super"), "la pagina MOODD non e' dell'admin");
});

test("l'utente senza caselle si comporta come prima", () => {
  // Nessuno ha ancora deciso per lui: e' il comportamento storico, e nessun
  // utente gia' creato deve cambiare comportamento con questa modifica.
  const p = pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE });
  for (const k of PAGINE_SOLO_ADMIN) assert.ok(!p.includes(k), k);
  assert.ok(p.includes("orders"));
  assert.ok(p.includes("reservations"));
});

test("le caselle comandano: se spuntate, valgono loro", () => {
  const p = pagineConsentite({ ruolo: "user", pagineUtente: ["orders", "reservations"], nascoste: [], tutte: TUTTE });
  assert.deepEqual(p, ["orders", "reservations"]);
  // Anche piu' del default storico, se il proprietario lo vuole.
  const q = pagineConsentite({ ruolo: "user", pagineUtente: ["stats"], nascoste: [], tutte: TUTTE });
  assert.deepEqual(q, ["stats"]);
});

test("un elenco VUOTO non vuol dire «tutto»", () => {
  // La distinzione che conta: [] = «niente», null = «mai deciso». Se fossero
  // la stessa cosa, togliere l'ultima casella darebbe accesso a tutto.
  assert.deepEqual(pagineConsentite({ ruolo: "user", pagineUtente: [], nascoste: [], tutte: TUTTE }), []);
  assert.ok(pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE }).length > 0);
});

test("l'installazione vince sulle caselle", () => {
  // Spuntare una pagina che il cliente ha spento non la riaccende.
  const p = pagineConsentite({ ruolo: "user", pagineUtente: ["orders", "marketing"], nascoste: ["marketing"], tutte: TUTTE });
  assert.deepEqual(p, ["orders"]);
});

test("/admin/super e' solo del super, e la home e' di tutti", () => {
  for (const ruolo of ["admin", "user"]) {
    assert.equal(puoVederePagina("super", { ruolo, pagineUtente: null, nascoste: [], tutte: TUTTE }), false, ruolo);
    assert.equal(puoVederePagina("home", { ruolo, pagineUtente: [], nascoste: [], tutte: TUTTE }), true, ruolo);
  }
  assert.equal(puoVederePagina("super", { ruolo: "super", nascoste: [], tutte: TUTTE }), true);
  for (const k of PAGINE_SOLO_SUPER) assert.ok(!TUTTE.includes(k), `${k} non deve essere spuntabile`);
});

test("una pagina sconosciuta non viene bloccata", () => {
  // Login, reset-password e la prossima pagina che qualcuno aggiunge non
  // passano da PAGINE_ADMIN: negare cio' che non si conosce le spegnerebbe
  // senza che nessuno capisca perche'.
  assert.equal(puoVederePagina("qualcosa-di-nuovo", { ruolo: "user", pagineUtente: [], nascoste: [], tutte: TUTTE }), true);
});

test("cio' che arriva dal modale viene ripulito", () => {
  assert.deepEqual(pulisciPagine(["orders", "orders", "ORDERS"], TUTTE), ["orders"]);
  assert.deepEqual(pulisciPagine(["orders", "pippo", "<script>"], TUTTE), ["orders"]);
  assert.deepEqual(pulisciPagine([], TUTTE), []);
  assert.equal(pulisciPagine(null, TUTTE), null, "null resta null: «mai deciso»");
  assert.equal(pulisciPagine(undefined, TUTTE), null);
  assert.equal(pulisciPagine("orders", TUTTE), null, "una stringa non e' un elenco");
});

test("il default del modale e' quello che l'utente vede davvero", () => {
  assert.deepEqual(
    pagineDiDefault(TUTTE),
    pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE }),
    "le caselle spuntate all'apertura devono combaciare col comportamento senza caselle",
  );
});

// ---------- che qualcuno la applichi ----------
test("il middleware chiude la porta PRIMA di rendere la pagina", () => {
  const mw = readFileSync("src/middleware.ts", "utf8");
  assert.ok(mw.includes("puoVederePagina"), "il middleware non controlla i permessi");
  assert.ok(mw.includes("chiavePagina"), "il middleware non ricava la pagina dal percorso");
  assert.ok(
    /puoVederePagina[\s\S]{0,400}context\.redirect\("\/admin"/.test(mw),
    "il controllo non porta a un redirect: sarebbe un calcolo senza conseguenze",
  );
});

test("la sessione porta le pagine firmate, non il browser", () => {
  const auth = readFileSync("src/lib/admin/adminAuth.ts", "utf8");
  assert.ok(/pages\??:\s*string\[\]/.test(auth), "StaffUser non porta le pagine");
  assert.ok(
    /payload\.app_metadata\?\.pages/.test(auth),
    "le pagine non vengono lette da app_metadata del JWT: se arrivassero dal corpo della richiesta, un utente potrebbe darsele da solo",
  );
});

// ============================================================
// LE API (20/09/2026)
// Chiudere le pagine non bastava: /admin/stats era sbarrata e
// /api/admin/stats rispondeva lo stesso. Una serratura sulla porta e la
// finestra aperta.
// ============================================================
test("ogni API admin e' nella mappa", () => {
  // Il rischio di una mappa e' che resti indietro: un file nuovo non elencato
  // nascerebbe APERTO, in silenzio. Qui la dimenticanza costa un test rosso.
  const radice = "src/pages/api/admin";
  const trovate = [];
  (function scorri(dir, prefisso) {
    for (const n of readdirSync(dir)) {
      const p = `${dir}/${n}`;
      if (statSync(p).isDirectory()) scorri(p, `${prefisso}${n}/`);
      else if (n.endsWith(".ts")) trovate.push(prefisso + n.replace(/\.ts$/, ""));
    }
  })(radice, "");

  const mancanti = trovate.filter((k) => !(k in API_PAGINA)).sort();
  assert.deepEqual(
    mancanti,
    [],
    `API non classificate: resterebbero aperte a chiunque senza che nessuno lo decida.\n  ${mancanti.join("\n  ")}`,
  );

  const fantasmi = Object.keys(API_PAGINA).filter((k) => !trovate.includes(k)).sort();
  assert.deepEqual(fantasmi, [], "la mappa elenca API che non esistono piu'");
});

test("il fatturato non si legge senza la pagina Statistiche", () => {
  const ctx = { ruolo: "user", pagineUtente: ["orders", "reservations"], nascoste: [], tutte: TUTTE };
  for (const api of ["stats", "stats-reservations", "traffic"]) {
    assert.equal(puoChiamareApi(api, ctx), false, api);
  }
  assert.equal(puoChiamareApi("orders", ctx), true, "le sue pagine restano sue");
});

test("le API di MOODD sono solo di MOODD", () => {
  for (const ruolo of ["admin", "user"]) {
    for (const api of ["users", "locations", "integrations"]) {
      assert.equal(puoChiamareApi(api, { ruolo, pagineUtente: null, nascoste: [], tutte: TUTTE }), false, `${ruolo}/${api}`);
    }
  }
  assert.equal(puoChiamareApi("users", { ruolo: "super", nascoste: [], tutte: TUTTE }), true);
});

test("cio' che serve alla home resta aperto a chiunque", () => {
  // Una tile legata a una pagina sparisce da sola (data-admin-page), quindi
  // non chiama niente. Ma queste non hanno una pagina: bloccarle romperebbe
  // la dashboard di un utente che ha tutto il diritto di vederla.
  const ctx = { ruolo: "user", pagineUtente: [], nascoste: [], tutte: TUTTE };
  for (const api of ["today", "notes", "pages", "home-layout", "search-console", "events", "push", "upload"]) {
    assert.equal(puoChiamareApi(api, ctx), true, api);
  }
});

test("dal percorso al nome dell'API, anche nelle sottocartelle", () => {
  assert.equal(chiaveApi("/api/admin/stats"), "stats");
  assert.equal(chiaveApi("/api/admin/google/reviews"), "google/reviews");
  assert.equal(chiaveApi("/api/admin/stats/"), "stats");
  assert.equal(chiaveApi("/api/reservation"), "");
  assert.equal(chiaveApi("/admin/stats"), "");
});

test("il middleware chiude anche la finestra, e con un 403", () => {
  const mw = readFileSync("src/middleware.ts", "utf8");
  assert.ok(mw.includes("puoChiamareApi"), "le API non vengono controllate");
  assert.ok(
    /puoChiamareApi[\s\S]{0,300}status:\s*403/.test(mw),
    "il controllo non porta a un 403: a un'API si risponde, non si redirige — un 302 verso una pagina HTML manderebbe in confusione chi chiama",
  );
});

/* ============================================================
   L'SSR DELLA HOME — la porta chiusa e la finestra aperta (21/09/2026)
   ============================================================

   Le API sotto /api/admin/ rispondono 403 a chi non ha quella pagina. Ma la
   home PRE-CARICA cinque isole lato server e le incolla nell'HTML, e quel
   percorso non passava dal middleware: la porta era chiusa e la finestra
   aperta.

   ⚠️ Il dato non era generico. `ORDERS_SELECT` porta `customer_name`,
   `customer_email`, `customer_phone`: un utente senza la pagina «Commandes»
   trovava nel sorgente della pagina i clienti del giorno con nome, email e
   telefono. Nessun errore, nessun log: bastava guardare il sorgente.

   ⚠️ E qui avevo scritto «tanto la tile non la vedeva nemmeno». Era FALSO:
   `/api/admin/pages` non guardava le caselle del singolo utente, quindi la
   tile restava li' a prometterla. Vedi la prova qui sotto.

   La home e' l'unica pagina con questo problema, ed e' per costruzione: e'
   sempre permessa (PAGINA_HOME) e mette insieme dati di pagine che chi
   guarda puo' non avere. Le altre (orders, clients, menu, stats) pre-caricano
   i dati della LORO pagina, e il middleware ci arriva prima. */

const HOME_DATA = readFileSync("src/lib/admin/caricaHomeData.ts", "utf8");
const HOME_PAGINA = readFileSync("src/pages/admin/index.astro", "utf8");

test("l'SSR della home chiede i permessi di chi guarda", () => {
  assert.match(HOME_DATA, /caricaHomeData\(ambito: Ambito, ctx: ContestoPermessi\)/,
    "caricaHomeData non riceve piu' il contesto: l'SSR torna a servire tutto a tutti");
  assert.match(HOME_PAGINA, /await contestoDiStaff\(staff\)/,
    "la home non passa piu' il contesto a caricaHomeData");
});

test("un'isola vietata non si legge NEMMENO dal database", () => {
  // ⚠️ Toglierla solo dalla risposta chiuderebbe la falla lo stesso, ma
  // lascerebbe il server a interrogare il database per righe che butta via —
  // e chi tocca il file dopo non avrebbe modo di accorgersi che quel `.data`
  // non doveva uscire di li'.
  // ⚠️ Il nome della guardia si LEGGE dal file, non si scrive qui: questa
  // prova e' nata controllando `vedeOrdini ? ...` e si e' rotta il giorno in
  // cui quella variabile si e' chiamata `mostraOrdini` — mentre la falla che
  // doveva sorvegliare non era tornata. Cio' che conta e' che esista una
  // guardia costruita con `mostra(ctx, pagina)` e che TUTTO quello che
  // riguarda quell'isola — le letture e la risposta — passi da lei.
  const guardiaDi = (pagina) => {
    const m = HOME_DATA.match(new RegExp(`const (\\w+) = mostra\\(ctx, "${pagina}"\\)`));
    assert.ok(m, `l'isola «${pagina}» non ha piu' una guardia costruita con mostra(ctx, ...)`);
    return m[1];
  };
  const letture = [
    ["orders", 'caricaOrdiniHome('],
    ["reservations", 'caricaResaGiorno('],
    ["menu", 'caricaMenuHome('],
    ["menu", 'leggi("menu_categories"'],
    ["menu", 'leggi("menu_items"'],
  ];
  const lett = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [pagina, query] of letture) {
    const g = guardiaDi(pagina);
    assert.match(HOME_DATA, new RegExp(`${g}\\s*\\n?\\s*\\?\\s*${lett(query)}`),
      `la lettura ${query} non e' piu' condizionata alla guardia dell'isola «${pagina}»`);
  }
  // E non finisce nemmeno nella risposta.
  for (const [pagina, campo] of [["orders", "{ orders:"], ["reservations", "{ resa }"], ["menu", "{ menu:"]]) {
    assert.match(HOME_DATA, new RegExp(`\\.\\.\\.\\(${guardiaDi(pagina)} \\? ${lett(campo)}`),
      `l'isola «${pagina}» finisce nella risposta senza guardia`);
  }
});

test("le isole della home e le API rispondono alla STESSA pagina", () => {
  // ⚠️ La rete che conta. Se un giorno `/api/admin/orders` passasse sotto
  // un'altra pagina e l'SSR restasse su «orders», la home servirebbe dati
  // che l'API rifiuta — e il guasto sarebbe di nuovo invisibile.
  const ISOLE = [
    ["orders", "orders"],
    ["reservations", "reservations"],
    ["menu", "menu"],
    ["categories", "menu"],
  ];
  for (const [api, pagina] of ISOLE) {
    assert.equal(API_PAGINA[api], pagina, `l'API ${api} non e' piu' sotto la pagina «${pagina}»`);
    assert.match(HOME_DATA, new RegExp(`mostra\\(ctx, "${pagina}"\\)`),
      `l'SSR della home non guarda piu' la pagina «${pagina}»`);
  }
  // `today` resta aperta: e' lo stato della cucina, la home ne ha sempre bisogno.
  assert.equal(API_PAGINA["today"], PAGINA_APERTA);
  assert.match(HOME_DATA, /caricaToday\(ambito\),/, "today dev'essere incondizionata");
});

test("un'isola assente vale come un 403, non come un'isola vuota", () => {
  // I due rami della home — con SSR e senza — devono dire la stessa cosa
  // anche quando rifiutano. `fakeRes(undefined)` che rendesse `ok: true`
  // farebbe esplodere `(await res.json()).orders` su `undefined`.
  assert.match(HOME_PAGINA, /obj === undefined \|\| obj === null\s*\n?\s*\?\s*\{ ok: false/,
    "fakeRes tratta di nuovo un'isola assente come un'isola vuota");
});

test("il contesto dei permessi si costruisce in UN posto solo", () => {
  // ⚠️ Ce n'erano due: una nel middleware, una che stava per nascere
  // nell'SSR. Due copie della stessa domanda, e la risposta sbagliata qui
  // non da' nessun errore: da' dati che chi guarda non doveva vedere.
  const MID = readFileSync("src/middleware.ts", "utf8");
  assert.doesNotMatch(MID, /async function contestoPermessi\(/,
    "il middleware si e' ricostruito il contesto per conto suo");
  assert.match(MID, /import \{ contestoDaToken \} from ".\/lib\/admin\/permessi"/);
  const PERMESSI = readFileSync("src/lib/admin/permessi.ts", "utf8");
  assert.match(PERMESSI, /export async function contestoDiStaff\(/);
  assert.match(PERMESSI, /export async function contestoDaToken\(/);
});

test("le statistiche non si chiedono affatto", () => {
  // Prima la home le chiedeva tre volte a ogni caricamento, anche a chi non
  // ha la pagina: tre 403 in console, e l'aria di qualcosa di rotto. Si era
  // risolto mandando al client l'elenco delle sue pagine per non chiedere.
  // Poi la tile del fatturato e' sparita dalla Accueil, e la domanda giusta
  // e' diventata un'altra: il modo piu' sicuro di non chiedere male e' non
  // chiedere. Il fatturato si guarda in /admin/stats.
  assert.ok(!/api\/admin\/stats/.test(HOME_PAGINA), "la Accueil e' tornata a chiedere le statistiche");
  // E l'SSR non manda piu' l'elenco delle pagine: non lo legge piu' nessuno,
  // e un dato che nessuno legge e' un dato che nessuno aggiorna.
  assert.ok(!/pagine:/.test(HOME_DATA), "l'SSR manda ancora `pagine`, che ormai non serve a nessuno");
});

test("cio' che si NASCONDE e' cio' che non si puo' vedere, non solo cio' che il super ha spento", () => {
  // ⚠️ IL BUCO TROVATO SU 450 GRADI (21/09/2026). `/api/admin/pages` rende
  // `hidden`, e AdminNav ci toglie le voci della nav e le tile della home.
  // Quel `hidden` era `admin_pages_hidden` piu' — solo per il ruolo «user» —
  // settings e stats. Le caselle del modale utente non entravano MAI in quel
  // calcolo: chi aveva spuntato solo «Menu» vedeva lo stesso Commandes e
  // Réservations, e cliccandole tornava in home senza capire perche'.
  //
  // La porta era chiusa e il cartello diceva ancora «aperto».
  const API = readFileSync("src/pages/api/admin/pages.ts", "utf8");
  assert.match(API, /pagineConsentite\(await contestoDiStaff\(staff\)\)/,
    "hidden non si calcola piu' dai permessi veri di chi chiede");
  assert.doesNotMatch(API, /ruolo === "user" \? \[\.\.\.new Set\(\[\.\.\.hidden, \.\.\.PAGINE_SOLO_ADMIN\]\)\]/,
    "e' tornato il calcolo che ignora le caselle del singolo utente");
  // Al super la lista grezza: la sua pagina Réglages mostra e RISALVA quegli
  // interruttori, e non deve risalvare scelte che non ha fatto lui.
  assert.match(API, /isSuperUser\(staff\)\s*\n?\s*\?\s*hidden/,
    "il super deve ricevere admin_pages_hidden com'e', o Réglages si riscrive da solo");
});

test("nascosto e vietato dicono la stessa cosa, per ogni pagina", () => {
  // La nav si fida di `hidden`, il middleware di `puoVederePagina`. Se i due
  // divergono, l'interfaccia mostra una porta che non si apre — o peggio,
  // nasconde una pagina che invece funziona.
  const TUTTE = ["orders", "reservations", "clients", "menu", "stats", "marketing", "assets", "print", "agenda", "settings"];
  const ctx = { ruolo: "user", pagineUtente: ["menu"], nascoste: [], tutte: TUTTE };
  const consentite = new Set(pagineConsentite(ctx));
  const nascoste = TUTTE.filter((k) => !consentite.has(k));
  assert.deepEqual(nascoste.sort(), ["agenda", "assets", "clients", "marketing", "orders", "print", "reservations", "settings", "stats"]);
  for (const k of nascoste) {
    assert.equal(puoVederePagina(k, ctx), false, `${k}: nascosta ma apribile`);
  }
  for (const k of consentite) {
    assert.equal(puoVederePagina(k, ctx), true, `${k}: visibile ma vietata`);
  }
});

test("un pannello aperto da un'ora salva ancora: il token si rinnova", () => {
  // Il token Supabase scade dopo un'ora. Un header costruito una volta sola
  // al caricamento continua a mandare quello vecchio: ogni salvataggio torna
  // «Non autorisé» e in certi punti il campo sparisce senza spiegazione. Il
  // guasto non e' teorico: e' stato corretto in otto pagine una alla volta,
  // e restava in super, marketing, print e nel SECONDO script della home.
  //
  // ⚠️ Si guarda BLOCCO per BLOCCO, non file per file: una pagina con due
  // <script> ha due scope, e il primo che ascolta non salva il secondo —
  // e' esattamente cosi' che il difetto era sopravvissuto nella home.
  const dir = "src/pages/admin";
  const sordi = [];
  for (const nome of readdirSync(dir).filter((n) => n.endsWith(".astro"))) {
    const testo = readFileSync(`${dir}/${nome}`, "utf8");
    // Si divide sui tag VERI (a inizio riga), non sulla parola: in questo
    // repo i commenti la nominano, e dividere anche li' spezzerebbe un
    // blocco in due meta' di cui una senza il suo ascolto.
    testo.split(/^[ \t]*<script/m).slice(1).forEach((blocco, i) => {
      if (!/Bearer \$\{/.test(blocco)) return;
      if (/onAuthStateChange|authFresh\(\)/.test(blocco)) return;
      sordi.push(`${nome} (script ${i + 1})`);
    });
  }
  assert.deepEqual(sordi, [], `header dell'autorizzazione costruito e mai piu' aggiornato:\n  ${sordi.join("\n  ")}`);
});

test("spegnere una funzione non e' negare un permesso", () => {
  // Due domande diverse, e per il super hanno risposte diverse: puo' APRIRE
  // Commandes (deve: e' da li' che la riaccende) ma il locale NON prende
  // ordini, quindi la Accueil non deve mostrarne niente. Finche' era una sola
  // domanda, il super spegneva Commandes in Pages visibles e si ritrovava la
  // colonna degli ordini a dire «0 aujourd'hui» — un numero vero su una cosa
  // che non esiste.
  const ctx = { ruolo: "super", nascoste: ["orders"], tutte: TUTTE };
  assert.equal(puoVederePagina("orders", ctx), true);
  assert.equal(funzioneAccesa("orders", ctx), false);
  assert.equal(funzioneAccesa("reservations", ctx), true);
  // Una chiave sconosciuta resta accesa: cio' che si spegne si dichiara.
  assert.equal(funzioneAccesa("notes", ctx), true);
  assert.equal(funzioneAccesa("orders", { ruolo: "admin", tutte: TUTTE }), true);
});

test("la Accueil chiede «lo mostriamo?», non «puo' aprirlo?»", () => {
  // ⚠️ Prova sulla SOSTANZA: il pre-caricamento della home non deve decidere
  // con `puo`, che al super dice sempre si'. Se qualcuno lo rimette, la falla
  // non da' nessun errore — da' una colonna in piu' a chi l'aveva spenta.
  const home = readFileSync("src/lib/admin/caricaHomeData.ts", "utf8");
  for (const k of ["orders", "reservations", "menu"]) {
    assert.ok(home.includes(`mostra(ctx, "${k}")`), `l'isola ${k} non passa da mostra()`);
  }
  assert.ok(!/\bpuo\(ctx/.test(home), "caricaHomeData decide ancora con puo(ctx, ...)");
});

test("cio' che e' spento sparisce prima del primo paint", () => {
  // La regola sta nel <head> stampato dal server: nessun cookie, nessun
  // token, nessun fetch. Toglierla di qui per rimetterla dopo un fetch
  // significa un lampo di tile e una griglia che tiene il posto a una
  // colonna che spariva un istante dopo.
  const head = readFileSync("src/components/admin/AdminHead.astro", "utf8");
  assert.ok(/boot\.hiddenPages/.test(head), "AdminHead non legge le funzioni spente");
  assert.ok(/\[data-admin-page="\$\{k\}"\]\{display:none!important\}/.test(head),
    "AdminHead non nasconde cio' che e' marcato data-admin-page");
  assert.ok(/SPENTE_CSS/.test(head) && /\+ SPENTE_CSS/.test(head), "la regola non finisce nel CSS stampato");

  // E la fascia della giornata deve CONTARE le colonne vive guardando lo
  // stile calcolato: una colonna spenta da quella regola ha lo stile inline
  // vuoto, e la griglia le terrebbe il posto.
  const home = readFileSync("src/pages/admin/index.astro", "utf8");
  const blocco = home.slice(home.indexOf('["j-resa", "j-ord"]'));
  assert.ok(/getComputedStyle/.test(blocco.slice(0, 400)), "le colonne vive si contano dallo stile inline");
});
