/**
 * LA FASCIA DELLA GIORNATA — Google, prenotazioni, ordini.
 *
 * Il markup della fascia sta in un COMPONENTE (Giornata.astro) e chi lo
 * riempie sta in un'altra pagina (admin/index.astro), che lo cerca per id.
 * Nessuno dei due si accorge se l'altro cambia: `getElementById` di un id che
 * non esiste rende `null`, e un `if (!el) return` scritto per prudenza
 * trasforma la svista in «non succede niente». E' andata esattamente cosi':
 * `.j-dx` aveva solo la classe, e le tile non salivano mai (quella macchina
 * non c'e' piu': la fascia e' una griglia di sezioni).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// ⚠️ Via i commenti PRIMA di cercare: qui dentro si cercano classi e
// selettori, e i commenti di questi file nominano proprio quelli che devono
// essere spariti — un test che si accontenta della propria spiegazione.
const nudo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HOME = readFileSync("src/pages/admin/index.astro", "utf8");
const FASCIA = readFileSync("src/components/admin/home/Giornata.astro", "utf8");

test("ogni id cercato nella fascia esiste nel markup", () => {
  const cercati = [...new Set([...HOME.matchAll(/getElementById\("(j-[a-z0-9-]+)"\)/g)].map((m) => m[1]))];
  const esistono = new Set([...(FASCIA + HOME).matchAll(/id="(j-[a-z0-9-]+)"/g)].map((m) => m[1]));
  assert.ok(cercati.length > 10, "la lettura degli id non ha trovato niente: regex da rivedere");
  const fantasmi = cercati.filter((k) => !esistono.has(k));
  assert.deepEqual(fantasmi, [], `id cercati e mai scritti nel markup:\n  ${fantasmi.join("\n  ")}`);
});

test("le sezioni sono figlie DIRETTE della griglia, senza involucri", () => {
  // ⚠️ Qui sta tutto il guadagno del disegno a sezioni, e si perde in una
  // riga. Finche' le sezioni sono figlie della stessa griglia, una sezione
  // spenta esce dal flusso e le altre scorrono nella sua casella da sole.
  // Basta che qualcuno ne avvolga due «per tenerle insieme» — com'erano
  // prenotazioni e ordini dentro `.j-due` — e il buco torna: l'involucro
  // tiene il posto anche quando e' vuoto, e si ricomincia a contare le
  // colonne accese in JavaScript per rimediare.
  const markup = nudo(FASCIA);
  const sezioni = [...markup.matchAll(/<div class="j-col /g)].length;
  assert.ok(sezioni >= 4, `la fascia ha ${sezioni} sezioni: il markup non e' piu' quello`);

  for (const classe of ["j-dx", "j-due", "j-sola", "j-niente", "j-salite", "j-tiles"]) {
    assert.doesNotMatch(markup, new RegExp(`class="[^"]*\\b${classe}\\b`),
      `la fascia e' tornata ad avere un involucro (${classe}): le sezioni non si compongono piu' da sole`);
    assert.doesNotMatch(nudo(HOME), new RegExp(`\\.${classe}[\\s{.,:]`),
      `${classe} e' tornato nel CSS della Accueil: era la macchina del «mezzo schermo vuoto»`);
  }
});

test("la didascalia del piede sta sulla linea, in ogni colonna che ce l'ha", () => {
  // ⚠️ La frasetta sopra i numeri («ultimi 30 giorni», «la piu' vecchia da 2
  // giorni») porta LEI il filo, col suo `::after`. La regola era scritta per
  // Google e poi copiata per i giorni speciali, come elenco di nomi: la
  // lavagnetta, che ha la stessa frase, era rimasta fuori — e nella stessa
  // fascia, a un centimetro di distanza, c'erano due piedi diversi. Un elenco
  // di nomi va allungato a mano, e chi se ne scorda non lo sa.
  const css = nudo(HOME);
  assert.match(css, /\.j-per::after\s*\{[^}]*content/,
    "la didascalia non porta piu' la sua linea");
  assert.doesNotMatch(css, /\.j-[a-z0-9-]+\s+\.j-per::after/,
    "la linea della didascalia e' tornata un elenco di colonne: la prossima che ne avra' una resta fuori");
  // ⚠️ E quando la frase tace (lavagnetta senza ritardi) la linea deve tornare
  // sui numeri: se no, nei giorni in cui va tutto bene il piede sparisce.
  assert.match(css, /\.j-per:empty \+ \.j-nums/,
    "senza questa riga, nei giorni in cui la frase tace i numeri restano senza niente sopra");
});

test("ogni scatola della fascia e' LA STESSA scatola", () => {
  // ⚠️ Era un elenco di nomi dentro una regola sola
  // (`.j-oggi-blocco, .j-g-blocco, .j-serv`): funzionava, ma andava allungato
  // ogni volta che una colonna voleva una scatola, e chi se ne scordava la
  // ridisegnava a mano — un bordo, un'ombra e un raggio «uguali», cioe'
  // leggermente diversi. Adesso la scatola e' una classe sola e i nomi
  // specifici restano per cio' che CAMBIA (il blocco Google e' elastico, i
  // servizi spariscono da vuoti).
  const markup = nudo(FASCIA);
  const scatole = [...markup.matchAll(/class="([^"]*\b(?:j-oggi-blocco|j-g-blocco|j-serv|j-vis-box)\b[^"]*)"/g)];
  assert.ok(scatole.length >= 4, `trovate ${scatole.length} scatole: il markup non e' piu' quello`);
  for (const m of scatole) {
    assert.match(m[1], /\bj-box\b/, `questa scatola non e' quella condivisa: class="${m[1]}"`);
  }
  assert.equal((nudo(HOME).match(/\.j-box\s*\{/g) ?? []).length, 1,
    "la scatola della fascia e' disegnata in piu' di un posto");
});

test("le colonne sono alte quanto lo schermo, e l'aria in fondo si misura dal bordo", () => {
  // ⚠️ L'altezza della fascia e' una SOTTRAZIONE DALLO SCHERMO, e i pezzi
  // che toglie sono una decisione, non un dettaglio. L'intestazione va tolta
  // sempre: sta sopra e occupa tutta la larghezza. L'isola dei link NO: e'
  // larga mezza pagina e sta in mezzo, e toglierla costava a ogni colonna, su
  // tutta la larghezza, lo spazio di una barra che ne copre solo il centro —
  // cinque righe di lista in meno su un tablet. La fascia ci passa sotto di
  // proposito, e quel che le finisce dietro e' l'aria sotto i numeri.
  const css = nudo(HOME);
  const riga = css.match(/--j-col-piena:[^;]+;/);
  assert.ok(riga, "l'altezza della fascia non si chiama piu' `--j-col-piena`: le media query che la riaccendono restano a mani vuote (e `auto` vince)");
  const formula = riga[0];
  assert.match(formula, /100dvh/, "l'altezza delle colonne non parte piu' dallo schermo");
  assert.ok(formula.includes("var(--h-header"),
    "la formula non toglie piu' l'intestazione: le colonne sforano in alto");
  // ⚠️ DOVE SI FERMA LA COLONNA e' detto in misure dell'isola, non con un
  // numero: stacco dal bordo + due terzi dell'isola, cioe' «si ferma a due
  // terzi» scritto come lo si direbbe a voce. Un numero a mano — il `3rem`
  // di prima — e' vero su una scala sola: sul tablet l'isola e' piu' bassa e
  // il punto si sposta, e nessuno sarebbe andato a riscriverlo.
  const aria = css.match(/--j-col-sotto:[^;]+;/);
  assert.ok(aria, "la fascia non dice piu' dove si ferma in fondo (`--j-col-sotto`)");
  assert.ok(aria[0].includes("var(--h-nav-gap") && /var\(--h-nav-h[^)]*\)\s*\*\s*2\s*\/\s*3/.test(aria[0]),
    "il punto d'arrivo della fascia non e' piu' legato all'isola (stacco + due terzi dell'altezza): su una delle due scale finisce nel posto sbagliato");
  assert.ok(formula.includes("var(--j-col-sotto"),
    "la formula non usa piu' l'aria in fondo: la colonna torna incollata al bordo");
  assert.ok(!formula.includes("var(--h-nav"),
    "la fascia e' tornata a togliere tutta l'isola dei link: ogni colonna perde l'altezza di una barra che ne copre solo il centro");
  // Il minimo: su uno schermo basso la sottrazione darebbe una colonna alta
  // due righe. Li' e' giusto che sfori la PAGINA, non che ogni colonna
  // diventi una fessura.
  assert.match(formula, /max\(\s*var\(--j-col-min,\s*\d+px/,
    "la fascia non ha piu' un minimo in pixel: su uno schermo basso ogni colonna diventa una fessura");
});

test("il piede di ogni pagina admin lascia passare l'isola, e non a occhio", () => {
  // ⚠️ Il `padding` in fondo al `main` esiste per UNA ragione: l'isola
  // galleggia e l'ultima riga della pagina non deve finirle dietro. Erano
  // `8rem` e `6rem` scelti a occhio, cioe' la stessa misura dell'isola
  // riscritta a mano due volte — e sul tablet i 6rem col piede a 13px facevano
  // 78px contro un'isola da 58: gia' due numeri che non si parlavano.
  const head = nudo(readFileSync("src/components/admin/AdminHead.astro", "utf8"));
  assert.match(head, /main\{[^}]*padding:[^;}]*var\(--h-nav\)/,
    "il piede del `main` e' tornato un numero a mano: il giorno in cui l'isola cambia altezza, nessuno lo aggiorna");
  // ⚠️ Le due misure del telaio devono esserci in ENTRAMBE le scale:
  // dichiarate solo per il desktop, il tablet userebbe la barra alta del
  // desktop su una barra bassa.
  // ⚠️ `--h-nav` e' la SOMMA dei due pezzi, non un terzo numero: chi ci
  // passa sotto a meta' ha bisogno dell'altezza da sola.
  assert.match(head, /--h-nav:\s*calc\(\s*var\(--h-nav-h\)\s*\+\s*var\(--h-nav-gap\)/,
    "`--h-nav` e' tornata un numero per conto suo: puo' smettere di combaciare con i due pezzi da cui dovrebbe nascere");
  for (const v of ["--h-header", "--h-nav-h", "--h-nav-gap"]) {
    assert.ok((head.match(new RegExp(`${v}:`, "g")) ?? []).length >= 2,
      `${v} e' dichiarata una volta sola: una delle due scale (desktop / iPad al dito) resta col numero dell'altra`);
  }
});

test("sotto la fascia c'e' il marchio, e non una linea che non separa piu' niente", () => {
  // ⚠️ La linea sotto la fascia c'era per dire dove finivano le colonne e dove
  // cominciavano le tile. Le tile sono diventate colonne una dopo l'altra, e
  // quel filo e' rimasto in fondo alla pagina a separare la fascia da NIENTE:
  // una riga che promette qualcosa sotto, e sotto non c'e' niente.
  const css = nudo(HOME);
  const regola = css.match(/\.jour\s*\{[\s\S]*?\}/);
  assert.ok(regola, "la fascia non ha piu' la sua regola");
  assert.doesNotMatch(regola[0], /border-bottom/,
    "la linea sotto la fascia e' tornata: separa la giornata da niente");
  // Il marchio del PRODOTTO (non quello del cliente, che sta nell'intestazione)
  // e la sua versione bianca, quella che esiste in `public/restohub/`.
  assert.match(nudo(HOME), /class="j-marchio"[^>]*aria-hidden/,
    "il marchio in fondo non c'e' piu', o non e' piu' nascosto a chi legge con la voce");
  assert.match(HOME, /\/restohub\/wordmark-negative\.svg/,
    "il marchio non punta piu' al disegno bianco del prodotto");
});

test("nella cartella della Accueil non restano componenti che nessuno mette in pagina", () => {
  // ⚠️ Un componente che nessuno importa non da' nessun segnale: non si
  // rompe, non compare nei test, non rallenta niente. Semplicemente, un
  // giorno qualcuno lo apre per capire come funziona la home e legge il
  // codice di una tile che non esiste piu' da mesi — e lo modifica.
  // Qui ne sono rimasti sei tutti insieme (Commandes, Reservations, Google,
  // Horaires, Cuisine, Statistiques) mentre la fascia della giornata si
  // prendeva il loro contenuto.
  const vivi = readdirSync("src/components/admin/home").filter((f) => f.endsWith(".astro"));
  const dimenticati = vivi.filter((f) => !HOME.includes(f.replace(".astro", "")));
  assert.deepEqual(dimenticati, [], "questi componenti non sono importati da nessuna parte: o si usano o si cancellano");
});
