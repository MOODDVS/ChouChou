/**
 * RÉGLAGES — la pagina del RISTORATORE, scheda per scheda.
 *
 * Qui non si configura l'installazione (quello e' il super admin): si
 * configura il proprio locale. E la domanda che decide tutto e', per ogni
 * scheda: questa cosa e' di UN POSTO FISICO, o del gruppo?
 *
 * ⚠️ La regola e' per SCHEDA, non per campo. La strada del campo — condiviso
 * per difetto, con una catena cliccabile accanto a ogni etichetta — era stata
 * provata e scartata: un gruppo puo' avere tre nomi, tre loghi e tre identita'
 * diverse, quindi non esiste nessun elenco di «campi che valgono di sicuro
 * per tutti» che sia vero anche per il cliente dopo. Una scheda invece si sa
 * cosa contiene: gli orari sono di una porta che apre e chiude, i link sono
 * di un sito, e il sito e' uno solo anche con tre punti.
 *
 * ⚠️ E il guasto, qui, e' silenzioso in tutte e due le direzioni: un dato di
 * gruppo salvato per sede cambia una pizzeria sola (si vede al primo cambio
 * di sede, e non si capisce); un dato di sede salvato per il gruppo cambia
 * anche gli altri due (e non si vede affatto, finche' qualcuno non se ne
 * lamenta).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { CLASSIFICA, appartenenzaConfig } from "../src/lib/admin/sedeRegole.ts";

const API = readFileSync("src/pages/api/admin/settings.ts", "utf8");
const PAGINA = readFileSync("src/pages/admin/settings.astro", "utf8");

/* ============================================================
   L'INVENTARIO: otto schede, e di chi e' ognuna
   ============================================================ */

/** `etichetta` e' come la scheda si chiama NELLA MAPPA dentro `settings.ts`
 *  (in francese, come la vede il ristoratore); la chiave e' il `data-tab`
 *  del codice. Sono due nomi diversi della stessa cosa, e il test li tiene
 *  agganciati — altrimenti la mappa puo' parlare di schede che non esistono
 *  piu', o tacere su una nuova. */
const SCHEDE = {
  general: {
    etichetta: "Général",
    livello: "sede",
    perche: "indirizzo, telefono, email, mittenti: sono di un posto fisico",
    eccezione: "timezone",
  },
  horaire: { etichetta: "Horaires", livello: "sede", perche: "gli orari sono di una porta che apre e chiude" },
  reservations: { etichetta: "Réservations", livello: "sede", perche: "sezioni, servizi e capienza sono di una sala" },
  cuisine: { etichetta: "Cuisine", livello: "sede", perche: "l'email della cucina e' di quella cucina" },
  notifications: { etichetta: "Notifications", livello: "sede", perche: "il recap arriva al responsabile di quel punto" },
  liens: { etichetta: "Liens", livello: "gruppo", perche: "un solo sito pubblico, quindi un solo Facebook" },
  team: { etichetta: "Team", livello: "mista", perche: "il personale e' del punto, ma qualcuno gira fra i punti" },
  documents: { etichetta: "Documents", livello: "sede", perche: "tre societa', tre set di contratti" },
};

test("le schede della pagina sono quelle dichiarate, ne' una di piu' ne' una di meno", () => {
  // ⚠️ Una scheda nuova non dichiarata qui e' una scheda di cui nessuno ha
  // deciso il livello — e il livello sbagliato non da' nessun errore.
  const nelCodice = [...new Set(
    [...PAGINA.matchAll(/<div class="section" data-tab="([a-z]+)"/g)].map((m) => m[1]),
  )].sort();
  assert.deepEqual(nelCodice, Object.keys(SCHEDE).sort());
  for (const [nome, s] of Object.entries(SCHEDE)) {
    assert.ok(["sede", "gruppo", "mista"].includes(s.livello), `${nome}: livello strano`);
    assert.ok(s.perche.length > 20, `${nome}: manca il perche'`);
    assert.ok(s.etichetta, `${nome}: manca l'etichetta usata nella mappa`);
  }
});

test("⚠️ la mappa scritta nel codice dice la verita'", () => {
  // ⚠️ Il 16/09/2026 questo commento diceva «Liens · Team · Documents → del
  // GRUPPO», e per Team e Documents era FALSO. Il codice era giusto, la mappa
  // no — e una mappa sbagliata e' peggio di nessuna mappa, perche' si legge
  // invece di andare a guardare. Questo test la tiene onesta.
  for (const [nome, s] of Object.entries(SCHEDE)) {
    const riga = new RegExp(`^\\s*\\*\\s+${s.etichetta}\\s+(SEDE|GRUPPO|MISTA)`, "m");
    const m = riga.exec(API);
    assert.ok(m, `la mappa in settings.ts non nomina piu' la scheda «${nome}»`);
    assert.equal(m[1].toLowerCase(), s.livello, `la mappa dice il livello sbagliato per «${nome}»`);
  }
});

test("le schede che hanno una TABELLA combaciano con CLASSIFICA", () => {
  // ⚠️ Due verita' sullo stesso fatto e' il modo in cui si smette di sapere
  // quale vale. Il livello dichiarato nella pagina e la classificazione della
  // tabella devono essere la stessa cosa.
  assert.equal(CLASSIFICA.team, SCHEDE.team.livello);
  assert.equal(CLASSIFICA.admin_docs_meta, SCHEDE.documents.livello);
  // ⚠️ `settings` e' classificata «marchio», e NON e' una contraddizione: e'
  // la tabella degli orari dell'INSTALLAZIONE. Gli orari della sede vivono in
  // `location_settings`, che e' un'altra tabella — perche' `day_of_week` e'
  // la chiave naturale e due sedi non possono avere due martedi' nella stessa.
  // La scheda resta «sede»: e' `leggiOrari` a sovrapporre i due piani.
  assert.equal(CLASSIFICA.settings, "marchio");
  assert.equal(CLASSIFICA.location_settings, "sede");
});

/* ============================================================
   COSA SI SCRIVE DOVE
   ============================================================ */

test("i link si salvano per il GRUPPO — e adesso a saperlo e' la CHIAVE", () => {
  // ⚠️ Fino al 20/09/2026 questa prova guardava la chiamata: `scriviConfig(…,
  // "gruppo")`. Era il chiamante a scegliere il livello, e chi aggiungeva un
  // campo doveva indovinare. Adesso lo dice `CLASSIFICA_CONFIG`, una volta.
  assert.match(API, /scriviConfig\(ambitoPut, Object\.fromEntries\(linkPuliti\)\)/);
  for (const k of ["facebook", "instagram", "tripadvisor"]) {
    assert.equal(appartenenzaConfig("link_" + k), "marchio", `link_${k} dovrebbe essere del marchio`);
  }
  // ⚠️ L'eccezione che paga tre schede Google: porta il prefisso dei link ed
  // e' di sede. Senza, chi mangia a Schaerbeek recensisce Stockel.
  assert.equal(appartenenzaConfig("link_google_review"), "sede");
});

test("Général si salva per SEDE — fuso compreso, da oggi", () => {
  // Una sola chiamata, senza separare niente a mano: `scriviConfig` manda
  // ogni chiave dove deve andare, anche mescolate nello stesso salvataggio.
  assert.match(API, /scriviConfig\(ambitoPut, Object\.fromEntries\(generalPulito\)\)/);
  assert.doesNotMatch(API, /const fuso = generalPulito\.filter/,
    "la separazione a mano e' tornata: adesso decide CLASSIFICA_CONFIG");
  for (const k of ["company_name", "company_vat", "restaurant_name", "public_phone", "brand_logo"]) {
    assert.equal(appartenenzaConfig(k), "sede", `${k} dovrebbe essere di sede`);
  }
  // ⚠️ IL FUSO ERA L'ECCEZIONE DI QUESTA SCHEDA, e non perche' fosse giusto:
  // perche' il codice ne supportava uno solo — `TIMEZONE` in `slots.ts` era
  // una variabile di modulo condivisa fra tutte le richieste. Tolta di li' il
  // 21/09/2026, l'eccezione e' sparita: il fuso e' di un posto fisico come
  // l'indirizzo. Le prove del refactor stanno in tests/fuso.test.mjs.
  assert.equal(appartenenzaConfig("timezone"), "sede");
  assert.doesNotMatch(API, /UNA eccezione dentro/,
    "la mappa in settings.ts promette ancora un'eccezione che non c'e' piu'");
  // ⚠️ L'icona sta col PANNELLO, che e' uno: era «sede», e il risultato era
  // una favicon salvata su una sede che adminBoot non avrebbe mai riletto.
  assert.equal(appartenenzaConfig("brand_favicon"), "marchio");
  assert.equal(appartenenzaConfig("brand_app_icon"), "marchio");
});

test("Cuisine, Réservations e Notifiche si salvano per SEDE", () => {
  for (const chiamata of [
    /scriviConfig\(ambitoPut, \{ kitchen_email: email \}\)/,
    /scriviConfig\(ambitoPut, Object\.fromEntries\(resaPulito\)\)/,
    /scriviConfig\(ambito, \{ daily_brief_hour: ora \}\)/,
    /scriviConfig\(ambito, \{ daily_brief_email: em \}\)/,
    /scriviConfig\(ambito, \{ daily_brief_enabled:/,
    /scriviConfig\(ambito, \{ orders_closed:/,
  ]) {
    assert.match(API, chiamata, `manca o e' cambiata: ${chiamata}`);
  }
  // ⚠️ NESSUNA sceglie piu' il livello a mano. Il parametro non esiste piu':
  // c'erano due chiamate «gruppo» (link e fuso) e tutte le altre implicite —
  // due verita' sulla stessa domanda, e chi aggiungeva un campo indovinava.
  const gruppo = [...API.matchAll(/scriviConfig\([\s\S]{0,160}?"gruppo"\)/g)].length;
  assert.equal(gruppo, 0, `qualcuno sceglie ancora il livello a mano: ${gruppo} chiamate`);
  for (const k of ["kitchen_email", "orders_closed", "daily_brief_hour", "reservation_zones"]) {
    assert.equal(appartenenzaConfig(k), "sede", `${k} dovrebbe essere di sede`);
  }
});

test("l'email cucina si salva anche VUOTA, e su una sede il vuoto eredita", () => {
  // ⚠️ Il guasto era `if (email)`: con la lista vuota il salvataggio si
  // saltava del tutto. Togliere l'ultimo indirizzo non aveva effetto, e al
  // ricaricamento riappariva quello di prima — sembrava che il campo non si
  // potesse svuotare, ed era vero.
  assert.doesNotMatch(API, /if \(email\) \{/,
    "la lista vuota salta di nuovo il salvataggio: non si riesce a togliere l'ultimo indirizzo");

  // CASO 1 — una sede attiva, lista vuota: si TOGLIE l'eccezione e la sede
  // torna a ereditare dal marchio. NON si scrive un'eccezione vuota: quella
  // manderebbe i ticket di quel punto sull'.env o in nessun posto, e un ordine
  // che nessuna cucina vede non da' errore e non lascia una riga nei log.
  assert.match(API, /cancellaConfig\(ambitoPut, \["kitchen_email"\]\)/,
    "il vuoto su una sede non toglie piu' l'eccezione");

  // CASO 2 — livello marchio, lista vuota: si salva '' , e chi legge ripiega
  // su KITCHEN_EMAIL dell'.env. Qui non c'e' nessuna eccezione da togliere.
  assert.match(API, /scriviConfig\(ambitoPut, \{ kitchen_email: "" \}\)/,
    "il vuoto al livello marchio non si salva piu'");

  // ...e la lista piena continua a salvarsi dove la manda CLASSIFICA_CONFIG.
  assert.match(API, /scriviConfig\(ambitoPut, \{ kitchen_email: email \}\)/);
});

test("cancellaConfig toglie la riga di QUESTA sede, e solo la sua", () => {
  // Fino al 26/09/2026 in `location_config` non c'era nessuna cancellazione:
  // una sede che aveva salvato una volta non tornava mai piu' a ereditare, per
  // nessuna chiave. Questa e' la primitiva che mancava.
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /export async function cancellaConfig/, "cancellaConfig e' sparita");

  // ⚠️ Senza `.eq("location_id", ambito.id)` la delete porterebbe via
  // l'eccezione di TUTTE le sedi: un campo svuotato in un punto azzererebbe
  // gli altri due, e nessuno collegherebbe le due cose.
  assert.match(
    sede,
    /from\("location_config"\)\s*\n?\s*\.delete\(\)\s*\n?\s*\.eq\("location_id", ambito\.id\)\s*\n?\s*\.in\("key", diSede\)/,
    "la delete su location_config non e' piu' limitata a una sede e a certe chiavi",
  );

  // Con `unica` / `tutte` non esiste nessuna eccezione da togliere: il valore
  // del marchio E' il valore. Uscire subito, non cancellare `app_config`.
  assert.match(sede, /ambito\.modo !== "sede"\) return null/,
    "cancellaConfig potrebbe arrivare a toccare app_config");
});

test("la pagina distingue un'email cucina ereditata da una propria", () => {
  // ⚠️ Un campo pieno coi dati del marchio sembra un dato proprio, e chi lo
  // salva senza toccarlo se lo porta a casa come eccezione per sempre. Con la
  // cancellazione si puo' tornare indietro, ma la cosa va comunque detta.
  assert.match(API, /kitchen_email_ereditata: ambito\.modo === "sede" && !sovrascritte\.has\("kitchen_email"\)/,
    "la GET non dice piu' se l'email cucina e' ereditata");
  assert.match(PAGINA, /kitchen_email_ereditata \? "" : "none"/,
    "la pagina non mostra piu' l'avviso di valore ereditato");
});

test("gli orari si scrivono con scriviOrari, che sdoppia da solo", () => {
  // `settings` ha `day_of_week` come chiave naturale, quindi la variante per
  // sede non puo' stare nella stessa tabella: vive in `location_settings`.
  // L'unita' di sovrascrittura e' il GIORNO INTERO, non il campo — mescolare
  // il pranzo di uno e la cena dell'altra darebbe orari che nessuno ha mai
  // scritto, e nessuno saprebbe da dove vengono.
  assert.match(API, /scriviOrari\(/);
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /\.from\("location_settings"\)\s*\n?\s*\.upsert\(conSede, \{ onConflict: "location_id,day_of_week" \}\)/);
});

/* ============================================================
   LA LETTURA: si vede il proprio, e sotto quello del gruppo
   ============================================================ */

test("si legge con l'ambito della richiesta, e si sa cosa e' ereditato", () => {
  // ⚠️ `leggiConfig` rende sia `valori` (quello che vale QUI) sia `marchio`
  // (quello dell'installazione). La pagina usa il secondo per mostrare da
  // dove viene un valore che la sede non ha ancora scritto: senza, un campo
  // pieno di dati del marchio sembra un dato proprio, e chi lo salva senza
  // toccarlo se lo porta a casa come eccezione per sempre.
  assert.match(API, /const ambito = await ambitoDiRichiesta\(request, staff\);/);
  // ⚠️ Questa riga fissava la destrutturazione esatta — `{ valori: cfg,
  // marchio }` — e il giorno che ne e' servita una terza (`sovrascritte`, per
  // dire se un valore e' ereditato) e' diventata rossa senza che niente si
  // fosse rotto. Adesso guarda le tre cose UNA PER UNA: aggiungerne una quarta
  // non fa piu' rumore, togliere una delle tre si'.
  assert.match(API, /await leggiConfig\(ambito,/);
  for (const nome of ["valori: cfg", "marchio", "sovrascritte"]) {
    assert.ok(
      new RegExp(`const \\{[^}]*\\b${nome}\\b[^}]*\\} = await leggiConfig`).test(API),
      `la GET non legge piu' \`${nome}\` da leggiConfig`,
    );
  }
});

test("dall'aggregato non si salva niente in Réglages", () => {
  // «Tutte le sedi» e' di sola lettura: `sedeDaScrivere` lancia. Qui si
  // controlla che la pagina non provi comunque a farlo — e soprattutto che
  // il selettore dell'aggregato non compaia in questa pagina.
  assert.equal(/x-sede": "tutte"/.test(PAGINA), false,
    "Réglages ha cominciato a chiedere l'aggregato, dove non si puo' scrivere");
  assert.equal(/rh-tutte/.test(PAGINA), false,
    "il bottone «Tutte le sedi» e' comparso in Réglages");
});

/* ============================================================
   TEAM E DOCUMENTI: le due schede con una regola loro
   ============================================================ */

test("una persona del team e' di QUESTO punto, salvo diverso avviso", () => {
  // ⚠️ Default opposto ai pop-up e all'agenda, e per una ragione: il
  // personale lavora in un posto. Chi gira fra i punti e' l'eccezione, e la
  // si dice con l'interruttore. `=== true` e non `!== false`: senza il
  // campo, la persona resta di questo punto.
  const team = readFileSync("src/pages/api/admin/team.ts", "utf8");
  assert.match(team, /inserisci\("team", ambito, v\.valori!, body\.all_locations === true\)/);
  assert.match(team, /campi\.location_id = body\.all_locations === true \? null : ambito\.id;/);
});

test("i documenti si separano per PERCORSO, non per colonna", () => {
  // ⚠️ La lista dei documenti si costruisce leggendo lo Storage: un file
  // senza riga di metadati non avrebbe nessuna sede da cui farsi filtrare.
  // Quindi la separazione sta nel percorso — e con l'ID, non con lo slug,
  // che si cambia dall'admin.
  const docs = readFileSync("src/pages/api/admin/docs.ts", "utf8");
  assert.match(docs, /radiceDocs\(ambito\)/);
  const regole = readFileSync("src/lib/admin/sedeRegole.ts", "utf8");
  assert.match(regole, /return ambito\.modo === "sede" \? `sedi\/\$\{ambito\.id\}\/` : "";/);
});


/* ============================================================
   IL CALENDARIO E' UNO SOLO, ED E' QUELLO DEL MARCHIO
   ============================================================ */

/** Campi data nativi ancora in giro, con la ragione. Vuoto e' l'obiettivo,
 *  ed e' lo stato dal 16/09/2026: gli ultimi tre erano in `google.astro`. */
const DATE_NATIVE = {};

test("i campi data usano il calendario del marchio, non quello del browser", () => {
  // `<input type="date">` apre il datepicker del SISTEMA: fondo grigio,
  // tipografia del browser, «Clear»/«Today» in inglese qualunque lingua
  // abbia scelto l'utente. In mezzo a una pagina brandizzata si vede subito,
  // e non e' un bug che qualcuno segnalera': e' solo brutto, e resta.
  const cartella = "src/pages/admin";
  const colpevoli = readdirSync(cartella)
    .filter((f) => f.endsWith(".astro"))
    .filter((f) => {
      const src = readFileSync(`${cartella}/${f}`, "utf8")
        // I fogli di stile NOMINANO `input[type="date"]` per vestirlo: quello
        // e' un selettore, non un campo. Via il <style> prima di guardare.
        .replace(/<style[\s\S]*?<\/style>/g, " ");
      return /<input[^>]*type=["']date["']/.test(src);
    })
    .filter((f) => !DATE_NATIVE[f]);
  assert.deepEqual(colpevoli.sort(), [], `campi data nativi non dichiarati: ${colpevoli.join(", ")}`);
});

test("le date si leggono da `data-iso`, mai dal testo scritto", () => {
  // Il campo del calendario brand mostra 31/12/2026 e tiene 2026-12-31 in
  // `data-iso`. Confrontare o salvare il TESTO non da' errore: mette
  // dicembre prima di gennaio, e la data arriva al database in un formato
  // che nessuno rilegge.
  const src = readFileSync("src/pages/admin/marketing.astro", "utf8");
  for (const campo of ["cpDs", "cpDe", "grFrom", "grTo"]) {
    assert.ok(
      !new RegExp(`${campo}\\.value\\s*[|>=<]`).test(src),
      `${campo}.value usato come dato: serve ${campo}.dataset.iso`,
    );
  }
});


/* ============================================================
   UN CALENDARIO SOLO, NON UNO PER PAGINA
   ============================================================ */

/** Pagine che hanno ancora la LORO copia del calendario. Da migrare a
 *  `lib/admin/datepicker.ts`: qui non si aggiunge niente, si toglie. */
const CALENDARIO_COPIATO = [
  "src/pages/admin/agenda.astro",
  "src/pages/admin/index.astro",
  "src/pages/admin/menu.astro",
  "src/pages/admin/orders.astro",
  "src/pages/admin/reservations.astro",
  "src/pages/admin/settings.astro",
  "src/components/admin/SpecialDaysForm.astro",
];

test("nessuna pagina nuova si scrive il suo calendario", () => {
  // Lo STILE era gia' stato unificato in styles/datepicker.css, e il commento
  // in cima a quel foglio racconta com'era finita: «5-6 duplicati, alcune
  // vecchie e disallineate». Il COMPORTAMENTO era rimasto copiato in otto
  // file, e la copia numero nove stava per nascere in google.astro.
  //
  // Copie della stessa regola non danno errore: divergono. Una impara a
  // guardare nel passato e le altre no, e chi legge non sa quale sia quella
  // giusta — lo sono tutte, ognuna per la sua pagina.
  const cartelle = ["src/pages/admin", "src/components/admin"];
  const copie = [];
  for (const c of cartelle) {
    for (const f of readdirSync(c).filter((x) => x.endsWith(".astro"))) {
      const src = readFileSync(`${c}/${f}`, "utf8");
      // Il segno di una copia: si costruisce il proprio pannello.
      if (/className\s*=\s*["']dp-panel["']/.test(src)) copie.push(`${c}/${f}`);
    }
  }
  const nuove = copie.filter((f) => !CALENDARIO_COPIATO.includes(f));
  assert.deepEqual(nuove.sort(), [], `calendari copiati non dichiarati: ${nuove.join(", ")}`);

  const migrate = CALENDARIO_COPIATO.filter((f) => !copie.includes(f));
  assert.deepEqual(migrate.sort(), [], `gia' migrate, togliere dall'elenco: ${migrate.join(", ")}`);
});

test("chi usa il calendario condiviso legge la data, non il testo", () => {
  for (const f of ["src/pages/admin/marketing.astro", "src/pages/admin/google.astro"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /creaDatepicker\(/, `${f} non usa il calendario condiviso`);
    assert.ok(
      !/<input[^>]*class=["'][^"']*\bf-date\b[^"']*["'][^>]*type=["']date["']/.test(src),
      `${f} mescola il campo brand con quello nativo`,
    );
  }
});

// ============================================================
// Il link «lascia una recensione» e' di una SCHEDA GOOGLE, non del marchio.
// Tre societa' = tre schede = tre link. Con un link solo, chi ha cenato a
// Schaerbeek lascia la recensione a Stockel: arriva davvero, al posto
// sbagliato, e dall'admin non si capisce perche'. Per questo sta in Général
// (che si salva sulla sede scelta in alto) e NON nei Liens, che il GET legge
// apposta dal livello del marchio.
// ============================================================
test("il link recensioni Google sta in Général, non nei Liens", () => {
  const lista = API.match(/const CHIAVI_LINK = \[([^\]]*)\]/);
  assert.ok(lista, "CHIAVI_LINK non e' piu' riconoscibile in settings.ts");
  assert.ok(
    !lista[1].includes("google_review"),
    "google_review e' tornato fra i link: quelli si leggono dal marchio, e il link della scheda Google e' di UNA sede",
  );

  // Si scrive dalla scheda della sede in /admin/super, accanto al Place ID:
  // e' l'indirizzo pubblico della stessa scheda Google, ed e' configurazione
  // che si mette una volta, non un campo del ristoratore.
  const sup = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.ok(sup.includes('id="loc-greview"'), "manca il campo nella modale della sede");
  assert.ok(sup.includes("review_url:"), "il campo non viene salvato: resterebbe sempre vuoto");

  const api = readFileSync("src/pages/api/admin/locations.ts", "utf8");
  assert.ok(
    /body\.review_url !== undefined[\s\S]{0,400}link_google_review/.test(api),
    "la PATCH non scrive `link_google_review`: e' la chiave che l'email di recensione legge",
  );
  assert.ok(
    /scriviConfig\(ambitoDiRiga\(id\), \{ link_google_review/.test(api),
    "il link va scritto sulla SEDE della riga, non a livello di marchio",
  );
});

test("chi legge il link recensioni puo' dire di quale sede", () => {
  const links = readFileSync("src/lib/links.ts", "utf8");
  assert.ok(
    /export async function linkGoogleReview\(ambito\?: Ambito\)/.test(links),
    "linkGoogleReview deve accettare un ambito: senza, un gruppo manda tutti sulla stessa scheda",
  );
  assert.ok(
    !/from\("app_config"\)[\s\S]{0,200}link_google_review/.test(links),
    "linkGoogleReview legge app_config a mano: scavalca lo strato delle sedi",
  );
});

test("un tab spento si nasconde, non si smonta", () => {
  // ⚠️ IL GUASTO (30/09/2026): la pagina Impostazioni restava su
  // «Chargement…» per chiunque non fosse super admin, su un cliente che
  // aveva spento qualche tab. La sezione veniva tolta dal DOM, e il codice
  // che riempie i campi faceva `prepEl.value = …` su un elemento che non
  // c'era piu': `Cannot read properties of null`, lo script moriva, e
  // «Chargement…» non veniva mai tolto.
  //
  // ⚠️ Non l'ha visto nessuno per settimane: l'API rispondeva 200, `astro
  // check` era verde (il `as HTMLInputElement` gli dice che l'elemento c'e'
  // sempre) e per il super admin — cioe' per chi prova — funzionava tutto.
  const src = readFileSync("src/pages/admin/settings.astro", "utf8");
  assert.doesNotMatch(
    src,
    /\.section\[data-tab="\$\{tk\}"\]`\)\?\.remove\(\)/,
    "la sezione di un tab spento viene smontata: i campi che stanno dentro diventano null e il caricamento si ferma a meta'",
  );
  assert.match(src, /sezSpenta\.dataset\.spento = "1"/);
  // E chi mostra i tab deve rispettare lo spegnimento, o la sezione
  // tornerebbe visibile al primo cambio di tab.
  assert.match(src, /sec\.dataset\.spento === "1" \? "none"/);
});
