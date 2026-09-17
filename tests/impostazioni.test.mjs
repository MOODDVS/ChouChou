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
import { CLASSIFICA } from "../src/lib/admin/sedeRegole.ts";

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

test("i link si salvano per il GRUPPO, e si vede nella chiamata", () => {
  assert.match(API, /scriviConfig\(ambitoPut, Object\.fromEntries\(linkPuliti\), "gruppo"\)/);
});

test("Général si salva per SEDE, tranne il fuso orario", () => {
  // ⚠️ E l'eccezione NON e' «questo campo e' condiviso» (il ragionamento
  // scartato): e' che il CODICE ne supporta uno solo. `TIMEZONE` in
  // `slots.ts` e' una variabile di modulo mutabile, letta da venti file e
  // condivisa fra tutte le richieste del processo. Un fuso per sede darebbe
  // un'impostazione che non fa niente — peggio che non averla.
  assert.match(API, /const fuso = generalPulito\.filter\(\(\[k\]\) => k === "timezone"\);/);
  assert.match(API, /scriviConfig\(ambitoPut, Object\.fromEntries\(fuso\), "gruppo"\)/);
  assert.match(API, /scriviConfig\(ambitoPut, Object\.fromEntries\(resto\)\)/,
    "il resto di Général non si salva piu' per sede");
  assert.match(API, /TIMEZONE.*variabile di modulo mutabile/s,
    "il motivo dell'eccezione non e' piu' scritto: senza, sembra una scelta di prodotto");
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
  // ⚠️ Nessuna di queste passa "gruppo": il livello predefinito di
  // `scriviConfig` e' «sede», ed e' quello che serve.
  const gruppo = [...API.matchAll(/scriviConfig\([\s\S]{0,120}?"gruppo"\)/g)].length;
  assert.equal(gruppo, 2, `le scritture di GRUPPO devono restare due (link e fuso), trovate ${gruppo}`);
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
  assert.match(API, /const \{ valori: cfg, marchio \} = await leggiConfig\(ambito,/);
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
