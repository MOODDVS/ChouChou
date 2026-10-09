/**
 * LE CHIAVI DI app_config — scritte per sede, lette per marchio.
 *
 * E' il guasto che abbiamo trovato tre volte a mano, e tre volte non c'era
 * niente nei log: `scriviConfig` salva in `location_config` quando c'e' una
 * sede selezionata, e chi rilegge con `from("app_config")` prende il valore
 * dell'installazione senza saperlo. Il ristoratore chiude la cucina, il
 * bottone diventa rosso, e gli ordini continuano ad arrivare.
 *
 * `events.ts`, poi `link_google_review`, poi `orders_closed`. Tre volte per
 * caso. Queste prove lo trovano da sole.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { SONO_IL_MOTORE } from "./ambiente.mjs";
import { join } from "node:path";
import {
  CLASSIFICA_CONFIG,
  FAMIGLIE_CONFIG,
  appartenenzaConfig,
  configDiSede,
  tabellaConfig,
} from "../src/lib/admin/sedeRegole.ts";
import { CHIAVI_ORDINI } from "../src/lib/ordiniRegole.ts";

/**
 * GLI ELENCHI DI CHIAVI DICHIARATI ALTROVE.
 *
 * ⚠️ Questa mappa esiste perche' la rete e' stata cieca una volta. Fino al
 * 01/10/2026 `letture()` sapeva leggere solo `leggiConfig(ambito, ["a","b"])`
 * con l'array scritto li'. `ordiniOpzioni.ts` passa invece una COSTANTE —
 * `leggiConfig(ambito, CHIAVI_ORDINI)` — e le quattro chiavi dei pagamenti
 * sono nate, sono state scritte dalla pagina Impostazioni e non sono mai
 * entrate in CLASSIFICA_CONFIG. Il salvataggio di QUALSIASI campo di quella
 * pagina moriva con un errore in faccia al ristoratore.
 *
 * Un elenco che non e' qui dentro non viene ignorato: fa fallire la prova,
 * col nome della costante. Meglio un test che chiede di essere aggiornato che
 * una rete che non guarda.
 */
const ELENCHI_CHIAVI = new Map([
  ["CHIAVI_ORDINI", CHIAVI_ORDINI],
]);

const SEDE_UNICA = { modo: "unica" };
const UNA_SEDE = { modo: "sede", id: "11111111-1111-1111-1111-111111111111" };

/* ------------------------------------------------------------------
   LE ECCEZIONI — dichiarate, non tollerate in silenzio

   Ogni riga e' un posto che legge una chiave DI SEDE senza ambito, con il
   motivo. L'elenco deve solo accorciarsi, e lo sta facendo: il 21/09/2026 se
   n'e' andata quella di `slots.ts` (il fuso non e' piu' una variabile
   globale). Quando il sito pubblico avra' il selettore di sede resteranno
   soltanto login e reset-password — dove una sede non esiste ancora.
   ------------------------------------------------------------------ */
const SENZA_AMBITO_AMMESSE = {
  // Nessuno e' ancora entrato: non c'e' nessuna sede da scegliere, e quello
  // che si mostra e' l'identita' dell'INSTALLAZIONE. Questa non se ne andra'.
  "src/pages/admin/login.astro": ["restaurant_name", "brand_logo", "brand_logo_negative"],
  "src/pages/admin/reset-password.astro": ["restaurant_name", "brand_logo", "brand_logo_negative"],

  // ⚠️ DA CHIUDERE — il sito pubblico non ha ancora un selettore di sede.
  // Finche' non ce l'ha, non esiste un ambito da passare: mostra i valori
  // dell'installazione. Con tre punti e un sito solo, il nome e l'indirizzo
  // in fondo alla pagina sono quelli del primo. Vedi restohub.cloud.
  "src/pages/index.astro": ["restaurant_name", "brand_logo", "brand_logo_negative", "company_street", "company_zip", "company_city", "public_phone", "public_email"],
  "src/layouts/Demo01Layout.astro": ["restaurant_name"],
  "src/pages/demo01/index.ts": ["restaurant_name"],
  "src/pages/demo01/order-confirm.astro": ["restaurant_name"],
  "src/pages/demo01/order-cancel.astro": ["restaurant_name"],
  "src/pages/demo01/feedback.astro": ["restaurant_name"],
  "src/pages/demo01/reservation/cancel.astro": ["restaurant_name"],

};

function fileSorgente(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileSorgente(p, fuori);
    else if (/\.(ts|astro)$/.test(v)) fuori.push(p);
  }
  return fuori;
}
const SORGENTI = fileSorgente("src").filter((f) => !f.endsWith("sedeRegole.ts"));

/** Le costanti-chiave visibili da un file: le sue, piu' quelle che importa.
 *  ⚠️ Senza questo la rete e' cieca proprio dove serve: `googleBusiness.ts`
 *  leggeva `K_LOCATION` — la scheda Google, che e' di sede — a livello
 *  marchio, e nessuna ricerca di stringhe lo vedeva. */
function costanti(f) {
  if (!existsSync(f)) return new Map();
  const src = readFileSync(f, "utf8");
  const K = new Map();
  for (const m of src.matchAll(/(?:export )?const ([A-Z][A-Z_0-9]*) = "([a-z_0-9]+)";/g)) K.set(m[1], m[2]);
  for (const m of src.matchAll(/^import \{([^}]*)\} from "([^"]+)";/gm)) {
    const nomi = m[1].split(",").map((x) => x.trim()).filter((x) => /^[A-Z][A-Z_0-9]*$/.test(x));
    if (!nomi.length) continue;
    try {
      const t = readFileSync(join(f, "..", m[2] + ".ts"), "utf8");
      for (const d of t.matchAll(/export const ([A-Z][A-Z_0-9]*) = "([a-z_0-9]+)";/g)) {
        if (nomi.includes(d[1])) K.set(d[1], d[2]);
      }
    } catch { /* non e' un modulo del progetto */ }
  }
  return K;
}

/** Le chiavi lette in un file, con il fatto che passi o no un ambito.
 *  ⚠️ Un file che non esiste rende []. Questa prova gira anche nei repo dei
 *  clienti, dove il motore arriva per merge, e un cliente vero cancella le
 *  pagine `demo01`: sono il modello, non il suo sito. */
function letture(f) {
  if (!existsSync(f)) return [];
  const src = readFileSync(f, "utf8");
  const K = costanti(f);
  const fuori = [];
  const risolvi = (tok) => {
    const t = tok.trim();
    const lit = t.match(/^"([a-z_0-9]+)"$/);
    return lit ? lit[1] : (K.get(t) ?? null);
  };
  // appConfigEq("x") / appConfigEq("x", ambito)
  for (const m of src.matchAll(/appConfigEq\(\s*"([a-z_0-9]+)"\s*(,)?/g)) fuori.push({ k: m[1], ambito: !!m[2] });
  // appConfigIn([...], ambito?) e leggiConfig(ambito, [...]) — il secondo ce l'ha per costruzione
  for (const m of src.matchAll(/appConfigIn\(\s*\[([^\]]*)\]\s*(,)?/g))
    for (const t of m[1].split(",")) { const k = risolvi(t); if (k) fuori.push({ k, ambito: !!m[2] }); }
  for (const m of src.matchAll(/leggiConfig\(\s*\w+\s*,\s*\[([^\]]*)\]/g))
    for (const t of m[1].split(",")) { const k = risolvi(t); if (k) fuori.push({ k, ambito: true }); }
  // leggiConfig(ambito, COSTANTE): l'elenco sta in un altro file. Se la rete
  // non lo conosce lo DICHIARA ignoto invece di saltarlo (vedi ELENCHI_CHIAVI).
  for (const m of src.matchAll(/leggiConfig\(\s*\w+\s*,\s*([A-Z][A-Z_0-9]*)\s*\)/g)) {
    const elenco = ELENCHI_CHIAVI.get(m[1]);
    if (!elenco) { fuori.push({ k: `elenco-non-dichiarato:${m[1]}`, ambito: true }); continue; }
    for (const k of elenco) fuori.push({ k, ambito: true });
  }
  // app_config grezzo. ⚠️ Conta la TABELLA della catena, non il fatto che il
  // file nomini `app_config` da qualche parte: `googleBusiness.ts` interroga
  // anche `location_config` per sapere QUALE sede dichiara una scheda, ed e'
  // una query giusta. Una rete che punisce il codice corretto e' una rete che
  // qualcuno prima o poi disattiva.
  const suAppConfig = (i) => {
    const prima = src.lastIndexOf('from("app_config")', i);
    const altra = src.lastIndexOf('.from("', i);
    return prima !== -1 && prima >= altra;
  };
  for (const m of src.matchAll(/\.eq\(\s*"key"\s*,\s*([^)]+?)\s*\)/g)) {
    if (!suAppConfig(m.index)) continue;
    const k = risolvi(m[1]); if (k) fuori.push({ k, ambito: false });
  }
  for (const m of src.matchAll(/\.in\(\s*"key"\s*,\s*\[([^\]]*)\]/g)) {
    if (!suAppConfig(m.index)) continue;
    for (const t of m[1].split(",")) { const k = risolvi(t); if (k) fuori.push({ k, ambito: false }); }
  }
  return fuori;
}

test("nessuna chiave di app_config e' senza classifica", () => {
  const ignote = new Set();
  for (const f of SORGENTI) {
    for (const { k } of letture(f)) {
      try { appartenenzaConfig(k); } catch { ignote.add(`${f}: ${k}`); }
    }
  }
  assert.deepEqual([...ignote], [], "chiavi da dichiarare in CLASSIFICA_CONFIG");
});

test("una chiave DI SEDE non si legge mai senza ambito, fuori dalle eccezioni dichiarate", () => {
  const colpevoli = [];
  for (const f of SORGENTI) {
    const ammesse = SENZA_AMBITO_AMMESSE[f] ?? [];
    for (const { k, ambito } of letture(f)) {
      let app; try { app = appartenenzaConfig(k); } catch { continue; } // l'altra prova
      if (app === "sede" && !ambito && !ammesse.includes(k)) colpevoli.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(colpevoli, [], "letture a livello marchio di una chiave che cambia per sede");
});

test.skipIf(!SONO_IL_MOTORE)("le eccezioni dichiarate esistono ancora davvero", () => {
  // ⚠️ Una rete che protegge un'eccezione gia' sparita e' un'eccezione che
  // nessuno togliera' mai piu' dall'elenco. Se il posto e' stato sistemato,
  // la riga qui sopra deve andarsene.
  const morte = [];
  for (const [f, chiavi] of Object.entries(SENZA_AMBITO_AMMESSE)) {
    if (!existsSync(f)) continue; // il cliente non ha quel file: non e' un'eccezione morta
    const viste = letture(f).filter((x) => !x.ambito).map((x) => x.k);
    for (const k of chiavi) if (!viste.includes(k)) morte.push(`${f}: ${k}`);
  }
  assert.deepEqual(morte, [], "eccezioni non piu' necessarie: toglile dall'elenco");
});

test("una chiave sconosciuta LANCIA, non passa liscia", () => {
  assert.throws(() => appartenenzaConfig("chiave_mai_vista"), /non classificata/);
  // ...e la scrittura la ferma: e' l'unico momento in cui qualcuno guarda.
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /for \(const k of chiavi\) appartenenzaConfig\(k\);/);
});

test("le famiglie classificano per prefisso, ma l'elenco esplicito vince", () => {
  assert.equal(appartenenzaConfig("link_facebook"), "marchio");
  assert.equal(appartenenzaConfig("site_hero_1"), "marchio");
  assert.equal(appartenenzaConfig("home_layout:abc-123"), "utente");
  // ⚠️ La riga che paga tre schede Google: porta il prefisso dei link ed e'
  // di sede. Senza questa precedenza, chi mangia a Schaerbeek lascia la
  // recensione sulla scheda di Stockel.
  assert.equal(appartenenzaConfig("link_google_review"), "sede");
  assert.equal(configDiSede("link_google_review"), true);
  assert.equal(configDiSede("link_facebook"), false);
});

test("con una sede selezionata, una chiave del marchio va LO STESSO in app_config", () => {
  // Altrimenti la lingua dell'admin finirebbe in location_config, e chi la
  // rilegge (adminBoot) non passa nessun ambito: scritta e mai piu' letta.
  assert.equal(tabellaConfig("admin_lang", UNA_SEDE), "app_config");
  assert.equal(tabellaConfig("admin_theme", UNA_SEDE), "app_config");
  assert.equal(tabellaConfig("home_layout:abc", UNA_SEDE), "app_config");
  assert.equal(tabellaConfig("orders_closed", UNA_SEDE), "location_config");
  // Senza una sede selezionata non esiste `location_config` in cui scrivere.
  assert.equal(tabellaConfig("orders_closed", SEDE_UNICA), "app_config");
});

test("ogni chiave delle schede di Réglages e' classificata", () => {
  // Le tre liste di settings.ts sono quello che il ristoratore salva davvero:
  // una chiave aggiunta li' e dimenticata qui e' il prossimo orders_closed.
  const s = readFileSync("src/pages/api/admin/settings.ts", "utf8");
  const mancanti = [];
  // ⚠️ Solo gli ELEMENTI dell'array, non ogni stringa fra virgolette: quelle
  // liste hanno un commento per riga, e dentro ci sono "1", "0", "rounded",
  // `bucket Storage "brand"`. La prima versione di questa prova li prendeva
  // per chiavi e falliva su codice giusto.
  const elementi = (blocco) =>
    [...blocco.matchAll(/^\s*"([a-z_0-9]+)"\s*,/gm)].map((m) => m[1]);
  for (const nome of ["CHIAVI_GENERAL", "CHIAVI_RESA"]) {
    const m = new RegExp(`const ${nome} = \\[([\\s\\S]*?)\\];`).exec(s);
    assert.ok(m, `${nome} non trovata in settings.ts`);
    const chiavi = elementi(m[1]);
    assert.ok(chiavi.length > 10, `${nome}: lette solo ${chiavi.length} chiavi, il regex non le prende piu'`);
    for (const k of chiavi) {
      try { appartenenzaConfig(k); } catch { mancanti.push(`${nome}: ${k}`); }
    }
  }
  // CHIAVI_LINK sta su una riga sola: qui gli elementi sono tutte le stringhe.
  const link = /const CHIAVI_LINK = \[(.*)\];/.exec(s);
  const social = [...link[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  assert.ok(social.length >= 8, `CHIAVI_LINK: lette solo ${social.length} chiavi`);
  for (const k of social) {
    try { appartenenzaConfig("link_" + k); } catch { mancanti.push("link_" + k); }
  }
  assert.deepEqual(mancanti, []);
});

test("chi scrive non sceglie piu' il livello: decide la classifica", () => {
  // ⚠️ `scriviConfig` aveva un parametro «livello» e i chiamanti lo
  // passavano a mano — due sorgenti di verita' per la stessa domanda. Chi
  // aggiungeva un campo doveva indovinare quale valesse.
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.doesNotMatch(sede, /livello: Livello/, "il parametro «livello» e' tornato");
  const src = SORGENTI.map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(src, /scriviConfig\([^)]*,\s*"gruppo"\)/, "qualcuno sceglie ancora il livello a mano");
});

test("sedeRegole resta senza dipendenze", () => {
  // La classifica delle chiavi sta qui apposta: si prova senza un database.
  const r = readFileSync("src/lib/admin/sedeRegole.ts", "utf8");
  const imports = [...r.matchAll(/^import .*/gm)].map((m) => m[0]).filter((l) => !l.startsWith("import type"));
  assert.deepEqual(imports, [], "sedeRegole.ts non deve importare niente");
});

test("la classifica copre davvero tutte e tre le appartenenze", () => {
  const valori = new Set(Object.values(CLASSIFICA_CONFIG));
  assert.ok(valori.has("sede") && valori.has("marchio"));
  assert.ok(FAMIGLIE_CONFIG.some((f) => f.appartenenza === "utente"));
  for (const [k, v] of Object.entries(CLASSIFICA_CONFIG)) {
    assert.ok(["marchio", "sede", "utente"].includes(v), `${k}: appartenenza sconosciuta "${v}"`);
  }
});

test("ogni file di src/config/ e' dichiarato in .gitattributes, in un verso o nell'altro", () => {
  // ⚠️ IL GUASTO, DUE VOLTE. `src/config/ticket.ts` nasce il 05/10 scrivendo
  // nella sua intestazione «questo file e' del cliente, e il motore non lo
  // tocca piu' dopo averlo creato… non si prende conflitti al merge». Era
  // falso: in .gitattributes non c'era, quindi `merge=ours` non valeva, e il
  // 09/10 un merge del motore in 450 Gradi ha stampato «Auto-merging
  // src/config/ticket.ts» su un file che non doveva nemmeno guardare. Li' e'
  // andata bene per caso; Educazione Napoletana ha un disegno TUTTO SUO in
  // quel file, e un ticket di cucina fuso col ripiego del motore non fa
  // rumore — esce storto in cucina, non a schermo.
  //
  // Era gia' successo il 06/09 con `siteImageSlots.ts` e `sitePages.ts`, per
  // la stessa ragione: una promessa scritta in un'intestazione non protegge
  // niente, protegge solo QUESTO file. La regola che protegge sta in
  // .gitattributes, e il silenzio (`unspecified`) non distingue una scelta
  // da una dimenticanza. Quindi: ogni file va NOMINATO, anche quando la
  // risposta e' «del motore». La riga la si scrive il giorno che il file
  // nasce; questa prova e' quello che se ne accorge se non succede.
  //
  // Da riga di comando: `git check-attr merge -- src/config/*.ts`.
  if (!SONO_IL_MOTORE) return;
  // ⚠️ Si guardano le REGOLE, non il testo del file. Prima questa prova
  // faceva `regole.includes("src/config/ticket.ts")`: passava anche togliendo
  // la riga, perche' il nome del file compare pure nel commento che spiega
  // perche' la riga esiste. Una rete che si accontenta di trovare la parola
  // approva proprio il caso che deve bocciare — provato togliendo la riga.
  const dichiarati = new Set(
    readFileSync(".gitattributes", "utf8")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r && !r.startsWith("#"))
      .map((r) => r.split(/\s+/)[0]),
  );
  const scoperti = readdirSync("src/config")
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !dichiarati.has(`src/config/${f}`));
  assert.deepEqual(
    scoperti,
    [],
    `file di src/config/ non dichiarati in .gitattributes: ${scoperti.join(", ")}. ` +
      "Scrivi una riga: `merge=ours` se e' del cliente, `merge` se e' del motore — col perche'.",
  );
});
