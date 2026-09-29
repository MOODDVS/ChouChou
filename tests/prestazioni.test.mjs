/**
 * PRESTAZIONI — cio' che PageSpeed misura davvero.
 *
 * Il motore non ha un sito: ce l'hanno i clienti. Quello che il motore puo'
 * fare e' non mettere zavorra nei mattoni che tutti usano, e queste prove
 * difendono le decisioni prese il 21/09/2026.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

function fileAstro(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileAstro(p, fuori);
    else if (v.endsWith(".astro")) fuori.push(p);
  }
  return fuori;
}
const ASTRO = fileAstro("src");
const CONFIG = readFileSync("astro.config.mjs", "utf8");
const senzaCommenti = (t) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

test("nessuno chiede piu' i font a Google a ogni visita", () => {
  // ⚠️ Due ragioni, e la seconda non e' tecnica.
  //
  // VELOCITA': due handshake verso un terzo dominio prima che il browser
  // possa disegnare una lettera, sul percorso critico. Su mobile e' il pezzo
  // piu' grosso dell'LCP di un sito vetrina.
  //
  // PRIVACY: un foglio servito da Google porta l'IP del visitatore a Google a
  // ogni visita. In Germania un tribunale l'ha gia' giudicata una violazione
  // del GDPR, e questi siti hanno una pagina privacy che promette altro.
  const colpevoli = [];
  for (const f of [...ASTRO, ...fileTs("src")]) {
    if (/fonts\.(googleapis|gstatic)\.com/.test(senzaCommenti(readFileSync(f, "utf8")))) {
      colpevoli.push(f);
    }
  }
  assert.deepEqual(colpevoli, [], "tornano a chiedere i font a Google");
});

function fileTs(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileTs(p, fuori);
    else if (/\.(ts|tsx)$/.test(v)) fuori.push(p);
  }
  return fuori;
}

test("le famiglie si dichiarano in un posto solo, e quelle usate esistono", () => {
  // ⚠️ Prima c'erano ventitre' elenchi di famiglie e pesi scritti a mano, e
  // divergevano gia': alcune pagine chiedevano Nunito Sans 400;600;700, altre
  // 400;700, altre 400;600;700;900. Il browser scaricava insiemi diversi
  // pagina per pagina, e nessuno sapeva piu' quale fosse quello giusto.
  const dichiarate = new Set([...CONFIG.matchAll(/cssVariable: "(--font-[a-z]+)"/g)].map((m) => m[1]));
  assert.ok(dichiarate.size >= 2, "le famiglie non sono piu' dichiarate in astro.config.mjs");
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  const usate = [...F.matchAll(/cssVariable="(--font-[a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usate.length > 0, "Fonts.astro non chiede piu' nessuna famiglia");
  const orfane = usate.filter((v) => !dichiarate.has(v));
  assert.deepEqual(orfane, [], "famiglie chieste ma non dichiarate: la pagina non compila");
});

test("chi mostra i font li importa, e da un posto solo", () => {
  const rotti = [];
  for (const f of ASTRO) {
    const s = readFileSync(f, "utf8");
    const usa = /<Fonts[\s/]/.test(s);
    const imp = /import Fonts from "([^"]+)"/.exec(s);
    if (usa && !imp) rotti.push(`${f}: usa <Fonts /> senza importarlo`);
    if (!usa && imp) rotti.push(`${f}: importa Fonts e non lo usa`);
    if (usa && imp && !resolve(dirname(f), imp[1]).endsWith(join("src", "components", "Fonts.astro"))) {
      rotti.push(`${f}: importa un altro Fonts`);
    }
  }
  assert.deepEqual(rotti, []);
});

test("i font dell'admin stanno in AdminHead, non anche nelle pagine", () => {
  // ⚠️ Il codemod li aveva messi in tutte e due: `<Font>` emette il suo CSS e
  // i suoi preload ogni volta che compare, quindi tredici pagine avrebbero
  // precaricato lo stesso file due volte. Un preload doppio non e' gratis:
  // ruba banda al vero LCP, e il browser lo scrive in console.
  const doppi = [];
  for (const f of ASTRO) {
    if (f.endsWith("AdminHead.astro")) continue;
    const s = readFileSync(f, "utf8");
    if (/<AdminHead[\s/]/.test(s) && /<Fonts[\s/]/.test(s)) doppi.push(f);
  }
  assert.deepEqual(doppi, [], "pagine che caricano i font due volte");
  assert.match(readFileSync("src/components/admin/AdminHead.astro", "utf8"), /<Fonts[^>]*\/>/,
    "AdminHead ha smesso di caricare i font: tutte le pagine admin restano senza");
});

test("si precarica solo cio' che serve al primo schermo", () => {
  // Un `preload` di troppo e' banda rubata al vero LCP. La firma a mano sta
  // in un saluto, non e' il primo pixel che conta: si carica e basta.
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  assert.match(F, /cssVariable="--font-body" preload/, "il testo dev'essere precaricato");
  assert.doesNotMatch(F, /cssVariable="--font-mano"[^>]*preload/, "la firma a mano non va precaricata");
});

test("il componente Font si importa dal percorso, non da «astro:fonts»", () => {
  // ⚠️ Questa prova esiste per un errore che `astro check` NON vede: in
  // Astro 7.3 `astro:fonts` e' il nome del plugin Vite, non un modulo
  // importabile. Con `import { Font } from "astro:fonts"` i test passano,
  // `astro check` passa, e poi la BUILD fallisce con «Rolldown failed to
  // resolve import». E' esattamente il tipo di cosa che si scopre in
  // produzione se nessuno lancia `npm run build` prima di pubblicare.
  const F = readFileSync("src/components/Fonts.astro", "utf8");
  assert.match(F, /import Font from "astro\/components\/Font\.astro"/);
  assert.doesNotMatch(F.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, " "), /from "astro:fonts"/,
    "«astro:fonts» non e' un modulo: la build fallisce");
});

/* ============================================================
   LE IMMAGINI — riservare il posto, o la pagina salta
   ============================================================ */

/**
 * Perche' un `<img>` puo' non portare le dimensioni e restare giusto.
 *
 * ⚠️ Questa rete legge il TESTO del tag: non vede il foglio di stile. Su un
 * sito che riserva lo spazio col contenitore segnalava codice corretto — su
 * ChouChou 24 tag su 33 — e in tre casi chiedeva di PEGGIORARE la pagina:
 * `.ev-media img` ha `aspect-ratio: 16 / 10`, e un attributo `height` sopra
 * quella regola da' due dimensioni definite al browser, che allora ignora
 * l'aspect-ratio. Obbedire avrebbe rotto le immagini che erano a posto.
 *
 * Il motivo si scrive SUL TAG, non in un elenco qui: questo file e' del motore
 * e il merge lo riscrive nei repo dei clienti, quindi un elenco per-cliente
 * sparirebbe al primo aggiornamento. Scritto sul tag, muore col tag.
 *
 *  - `css`      il posto lo riserva il foglio di stile: altezza definita o
 *               `aspect-ratio`, sull'immagine o sul contenitore. Si mette dopo
 *               aver GUARDATO la regola, non per far passare la prova.
 *  - `overlay`  l'immagine non e' nel flusso (lightbox, modale): uno
 *               spostamento del contenuto non puo' esistere.
 *  - `naturale` formato variabile PER SCELTA — una galleria che non ritaglia,
 *               dove l'altezza la decide la foto. Il costo e' noto e accettato.
 */
const POSTI = ["css", "overlay", "naturale"];

test("le pagine PUBBLICHE del motore non hanno <img> senza posto riservato", () => {
  // ⚠️ Solo le pubbliche: l'admin sta dietro login e PageSpeed non lo misura.
  // Il CLS lo paga il cliente in 4G, non chi gestisce il locale dal Mac.
  // ⚠️ `Immagine.astro` e' escluso: E' il componente, l'unico posto dove un
  // `<img>` nudo ci deve stare. Una rete che accusa la cura invece della
  // malattia e' una rete che qualcuno disattiva.
  const pubbliche = ASTRO.filter(
    (f) => !f.includes(`${"/"}admin${"/"}`) && !f.endsWith("Immagine.astro"),
  );
  const nudi = [];
  for (const f of pubbliche) {
    for (const m of readFileSync(f, "utf8").matchAll(/<img[^>]*>/g)) {
      const t = m[0];
      const posto = t.match(/data-posto="([a-z]+)"/)?.[1];
      if (posto && POSTI.includes(posto)) continue;
      if (!/\bwidth=/.test(t) && !/aspect-ratio/.test(t)) nudi.push(`${f}: ${t.slice(0, 70)}`);
    }
  }
  assert.deepEqual(nudi, [], "usa <Immagine>, che le dimensioni le pretende");
});

test("un `data-posto` scritto male non zittisce niente", () => {
  // Senza questa prova un refuso (`data-posto="genitore"`) passerebbe per una
  // dichiarazione valida e spegnerebbe il controllo su quel tag, in silenzio.
  const sbagliati = [];
  for (const f of ASTRO) {
    for (const m of readFileSync(f, "utf8").matchAll(/data-posto="([^"]*)"/g)) {
      if (!POSTI.includes(m[1])) sbagliati.push(`${f}: data-posto="${m[1]}"`);
    }
  }
  assert.deepEqual(sbagliati, [], `i valori ammessi sono: ${POSTI.join(", ")}`);
});

test("<Immagine> si ferma in BUILD se non sa che posto riservare", () => {
  // ⚠️ La cura per il CLS e' banale — riservare il posto — ed e' proprio per
  // questo che si dimentica: la pagina funziona lo stesso, semplicemente
  // salta. Un componente che lo pretende e' l'unico modo perche' la domanda
  // venga fatta nel momento in cui qualcuno sta guardando.
  const I = readFileSync("src/components/Immagine.astro", "utf8");
  assert.match(I, /if \(!rapporto && \(!width \|\| !height\)\) \{[\s\S]*?throw new Error/,
    "<Immagine> ha smesso di pretendere le dimensioni");
  // La primaria non si rimanda mai: rimandare l'LCP e' peggiorarlo di proposito.
  assert.match(I, /primaria \? "eager" : "lazy"/);
  assert.match(I, /fetchpriority=\{primaria \? "high" : undefined\}/);
});

test("una sola immagine `primaria` per pagina", () => {
  // Se tutto e' prioritario, niente lo e': due `fetchpriority="high"` si
  // annullano e il browser torna a decidere da solo.
  const troppe = [];
  for (const f of ASTRO) {
    const n = [...readFileSync(f, "utf8").matchAll(/<Immagine[^>]*\sprimaria[\s/>]/g)].length;
    if (n > 1) troppe.push(`${f}: ${n}`);
  }
  assert.deepEqual(troppe, []);
});

test("la ricetta per i clienti esiste e dice cosa il merge NON porta", () => {
  // ⚠️ `astro.config.mjs` e' merge=ours: il blocco dei font non arriva da
  // solo in nessun cliente. Se questo file smette di dirlo, il prossimo
  // cliente configurato resta con i font di Google e nessuno se ne accorge.
  const R = readFileSync("PRESTAZIONI.md", "utf8");
  assert.match(R, /merge=ours/, "la ricetta non avverte piu' che il merge non porta il blocco font");
  assert.match(R, /Immagine/, "la ricetta non spiega piu' il componente immagine");
});

/* ------------------------------------------------------------------ *
 * I FONT: chi scrive il nome a mano li spegne, e nessuno se ne accorge
 * ------------------------------------------------------------------ */

// Astro non registra le famiglie col loro nome: le registra con un nome
// CON HASH — `Quicksand-062645fc554f8359` — e l'unico modo per arrivarci e'
// la variabile dichiarata in `astro.config.mjs`. Quindi `font-family:
// "Quicksand"` non e' piu' «la stessa cosa scritta diversamente»: e' un nome
// senza nessun `@font-face`, e il testo ricade sul font di sistema.
//
// ⚠️ E' gia' successo, il 21/09/2026: dopo il passaggio ai font locali
// diciannove file ridichiaravano `--font-title: "Quicksand", …` dentro il
// proprio `<style>`. La loro vinceva sulla regola di Astro, e TUTTI i titoli
// del pannello hanno smesso di essere in grassetto. `npm test`, `astro check`
// e `npm run build` erano tutti verdi: se ne e' accorto il cliente, a occhio.
const BLOCCO_FONT = CONFIG.slice(CONFIG.indexOf("fonts: ["));
const FAMIGLIE = [...BLOCCO_FONT.matchAll(/name:\s*"([^"]+)",[\s\S]{0,120}?cssVariable:\s*"(--font-[a-z]+)"/g)]
  .map(([, nome, variabile]) => ({ nome, variabile }));

test("astro.config dichiara le famiglie con nome e variabile", () => {
  // Se questa lista si svuota le due prove qui sotto passerebbero a vuoto.
  assert.ok(FAMIGLIE.length >= 5, `lette solo ${FAMIGLIE.length} famiglie in astro.config.mjs`);
});

// ⚠️ Solo i file AGGANCIATI al sistema font di Astro. Un cliente puo' avere
// pagine pubbliche sue, ancora coi <link> di Google e coi nomi scritti a mano:
// li' il nome letterale FUNZIONA, e queste prove girano anche nei repo dei
// clienti. Il guasto e' mescolare le due cose nello stesso file.
const AGGANCIATI = ASTRO.filter((f) => {
  if (f.endsWith("components/Fonts.astro")) return false; // e' lui a spiegarlo
  const t = readFileSync(f, "utf8");
  return /<Fonts\b/.test(t) || /AdminHead/.test(t) || /var\(--font-[a-z]+\)/.test(t);
});

test("i file agganciati ai font del motore sono tanti quanti sembrano", () => {
  // Senza questa, le due prove qui sotto potrebbero passare su zero file.
  assert.ok(AGGANCIATI.length >= 20, `solo ${AGGANCIATI.length} file agganciati`);
});

test("nessuno scrive a mano il nome di una famiglia dichiarata", () => {
  const colpevoli = [];
  for (const f of AGGANCIATI) {
    const testo = senzaCommenti(readFileSync(f, "utf8"));
    for (const { nome } of FAMIGLIE) {
      if (testo.includes(`"${nome}"`)) colpevoli.push(`${f}: "${nome}"`);
    }
  }
  assert.deepEqual(colpevoli, [],
    "il nome letterale non ha nessun @font-face: si usa var(--font-…)");
});


/**
 * I CARATTERI CHE CI SONO GIA', e per cui non c'e' niente da dichiarare.
 *
 * ⚠️ La regola qui sopra vieta il nome scritto a mano perche' un nome senza
 * `@font-face` non ha nessun file dietro: il testo ricade in silenzio sul
 * font di sistema. Ma per `Arial, Helvetica, sans-serif` il font di sistema
 * E' L'INTENZIONE, non l'incidente — non c'e' niente da scaricare e niente
 * da mancare. La regola stava bocciando il caso che non descrive.
 *
 * Trovato su Educazione Napoletana il 29/09/2026: il corpo del testo e'
 * Arial. Le alternative erano cambiare il font del sito per far passare una
 * prova, o tenersi una rossa per sempre: due modi di far perdere valore alla
 * rete.
 *
 * ⚠️ L'ELENCO E' CHIUSO, e non e' pigrizia. «Qualsiasi valore senza
 * virgolette» avrebbe lasciato passare `Quicksand, sans-serif` — che e'
 * ESATTAMENTE il guasto che questa prova esiste per prendere. Un carattere
 * che non e' in questo elenco va dichiarato, o va spiegato perche' no.
 */
const DI_SISTEMA = new Set([
  // le famiglie generiche del CSS
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  // le pile di sistema che i browser risolvono senza scaricare niente
  "-apple-system", "blinkmacsystemfont",
  // i caratteri preinstallati praticamente ovunque
  "arial", "helvetica", "georgia", "verdana", "tahoma", "courier",
]);

/** `true` se ogni pezzo della pila e' un carattere che il visitatore ha gia'. */
function soloDiSistema(valore) {
  if (valore.includes('"') || valore.includes("'")) return false;
  const pezzi = valore.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return pezzi.length > 0 && pezzi.every((x) => DI_SISTEMA.has(x));
}

test("nessuna pagina riscrive una variabile dei font con un nome a mano", () => {
  // Il `<style>` della pagina vince su quello iniettato da Astro, quindi
  // riscrivere `--font-title: "Quicksand"` sostituisce il nome CON HASH con
  // uno che non ha nessun `@font-face`: il testo ricade sul font di sistema.
  //
  // ⚠️ Ma un RINVIO a un'altra famiglia dichiarata non ha quel problema: il
  // valore e' il nome con hash, e quello esiste. Ed e' l'unico modo perche' i
  // componenti del motore dentro un sito cliente — il widget di prenotazione,
  // il popup, le pagine legali — usino i font DI QUEL cliente invece dei
  // nostri. ChouChou lo fa cosi':
  //
  //     html:root { --font-title: var(--font-titolo); }
  //
  // (`html:root` e non `:root`: vince sull'iniezione di Astro per
  // specificita', non per ordine di comparsa nel `<head>`.)
  const dichiarate = new Set(FAMIGLIE.map((x) => x.variabile));
  const colpevoli = [];
  for (const f of AGGANCIATI) {
    const testo = senzaCommenti(readFileSync(f, "utf8"));
    for (const { variabile } of FAMIGLIE) {
      for (const m of testo.matchAll(new RegExp(`${variabile}\\s*:([^;}]*)`, "g"))) {
        const valore = m[1].trim();
        const rinvio = valore.match(/^var\(\s*(--font-[a-z]+)\s*\)$/);
        if (rinvio && dichiarate.has(rinvio[1])) continue;
        if (soloDiSistema(valore)) continue;
        colpevoli.push(`${f}: ${variabile}: ${valore.slice(0, 40)}`);
      }
    }
  }
  assert.deepEqual(colpevoli, [],
    "la variabile la definisce Astro: si legge, o si rinvia a un'altra dichiarata");
});

test("una pila di caratteri di sistema non e' un lasciapassare", () => {
  // ⚠️ L'eccezione qui sopra vale SOLO per caratteri che il visitatore ha
  // gia'. Se un giorno diventasse «tutto cio' che non ha virgolette», la
  // prova smetterebbe di prendere il guasto per cui e' nata — e nessuno se
  // ne accorgerebbe, perche' resterebbe verde.
  assert.equal(soloDiSistema("Arial, Helvetica, sans-serif"), true);
  assert.equal(soloDiSistema("sans-serif"), true);
  // Una famiglia che va scaricata resta vietata, con o senza virgolette.
  assert.equal(soloDiSistema("Quicksand, sans-serif"), false);
  assert.equal(soloDiSistema('"Quicksand", sans-serif'), false);
  assert.equal(soloDiSistema("Burford, system-ui, sans-serif"), false);
  // E una pila vuota non passa per «tutti di sistema».
  assert.equal(soloDiSistema(""), false);
});

test("ogni pagina che usa un font ha i font", () => {
  // Una variabile non definita non e' un errore: `font-family: var(--font-serif)`
  // senza nessuna dichiarazione e' semplicemente il font di sistema. Silenzioso.
  const scoperte = [];
  for (const f of AGGANCIATI) {
    if (!/src[/\\](pages|layouts)[/\\]/.test(f)) continue;
    const testo = readFileSync(f, "utf8");
    if (!/var\(--font-[a-z]+\)/.test(testo)) continue;
    if (/<Fonts\b|AdminHead|Layout\b/.test(testo)) continue;
    scoperte.push(f);
  }
  assert.deepEqual(scoperte, [], "usa var(--font-…) ma nessuno dichiara le famiglie");
});

test("nessuna variabile dei font e' dichiarata due volte", () => {
  // Astro NON si ferma: scrive due righe di avviso in build — «Several font
  // families have been registered for the … cssVariable» — e tiene l'ULTIMA.
  // In build quegli avvisi passano in mezzo a tutto il resto, e il risultato e'
  // una famiglia che sparisce senza che niente si rompa.
  const viste = new Map();
  const doppie = [];
  for (const { nome, variabile } of FAMIGLIE) {
    if (viste.has(variabile)) doppie.push(`${variabile}: ${viste.get(variabile)} e ${nome}`);
    else viste.set(variabile, nome);
  }
  assert.deepEqual(doppie, [], "l'ultima dichiarazione vince e l'altra sparisce");
});

test("i pesi dichiarati sono quelli che c'erano, non quelli che sembrano giusti", () => {
  // ⚠️ IL SECONDO GUASTO DEL 21/09/2026, e il CSS non c'entrava niente.
  //
  // Prima le pagine chiedevano a Google `Quicksand:wght@700`: UNA faccia sola.
  // Per la regola di accostamento CSS, quando il peso chiesto non esiste il
  // browser prende il piu' vicino — e col 700 solo, QUALSIASI peso diventava
  // 700. I `font-weight: 500` e `600` sparsi nel pannello non avevano mai
  // fatto niente: i titoli erano in grassetto per assenza di alternative.
  //
  // Dichiarando 500/600/700 «per completezza» ognuna di quelle regole ha
  // trovato la sua faccia, e tutti i titoli sono dimagriti. Stessa storia per
  // Nunito Sans: le 39 regole `font-weight: 800` finivano sul 900, perche'
  // l'800 non era mai stato scaricato.
  //
  // Quindi: questi elenchi NON si allargano per simmetria. Aggiungere un peso
  // e' un cambio di resa su tutto il pannello, e va visto a occhio.
  // ⚠️ La chiave e' la VARIABILE, non il nome della famiglia. Un cliente puo'
  // dichiarare la stessa famiglia una seconda volta coi pesi del SUO sito
  // (ChouChou: Quicksand [700] sul pannello, [400,500,600,700] sul sito) e per
  // Astro sono due famiglie distinte, perche' la chiave unica e'
  // cssVariable + nome + provider e il nome con hash comprende i pesi.
  // Con la chiave sul nome, la seconda dichiarazione copriva la prima e questa
  // prova diceva che il pannello era cambiato quando non era vero.
  const pesi = Object.fromEntries(
    [...BLOCCO_FONT.matchAll(/cssVariable:\s*"(--font-[a-z]+)",[\s\S]{0,900}?weights:\s*\[([^\]]*)\]/g)]
      .map(([, variabile, lista]) => [variabile, lista.split(",").map((n) => Number(n.trim()))]),
  );
  assert.deepEqual(pesi["--font-title"], [700],
    "Quicksand del pannello con piu' di un peso: i titoli si smagriscono");
  assert.deepEqual(pesi["--font-body"], [400, 600, 700, 900],
    "l'800 di Nunito Sans non e' mai esistito: le 39 regole font-weight:800 contavano sul 900");
});
