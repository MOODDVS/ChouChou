/**
 * I COMPONENTI CONDIVISI — un nome, una faccia.
 *
 * ⚠️ IL GUASTO CHE QUESTA PROVA TIENE CHIUSO, e che non si vede mai da dentro
 * una pagina sola. `.m-tab` era dichiarato TRE volte — Accueil, Menu, Agenda —
 * con tre fondi diversi: gli stessi tab cambiavano aspetto passando da un
 * modale all'altro. `.ibtn` era ridipinto dentro la colonna delle note, e la
 * colonna nata dopo si e' ritrovata il tondo vuoto accanto a uno pieno che
 * diceva la stessa cosa. Nessuno di questi e' un errore: ognuno, nel suo file,
 * sembra una scelta ragionevole. Si vedono solo mettendo due schermi uno
 * accanto all'altro — cioe' quando li vede il ristoratore.
 *
 * LA REGOLA. Una pagina puo' SISTEMARE un componente condiviso (dove sta,
 * quanto spazio ha intorno, quanto e' largo) ma non RIDIPINGERLO: fondo,
 * colore, bordo, tondo, carattere e imbottitura appartengono al file del
 * componente, in `src/styles/`. Chi ha bisogno di una variante la scrive LA'
 * con un nome (`.btn-primary`, `.sw-sold`, `.btn-danger`), cosi' la seconda
 * pagina che la vuole la trova invece di riscriverla.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** I componenti con una FORMA: quelli che si riconoscono a colpo d'occhio. */
const COMPONENTI = ["btn", "ibtn", "fld", "rh-filter", "rh-filters", "m-tab", "m-tabs", "md-btn", "switch", "track"];
/** Le proprieta' che sono il suo aspetto, non la sua posizione. */
const VESTITO = [
  "background", "background-color", "color", "border", "border-color",
  "border-radius", "font-family", "font-size", "font-weight",
  "text-transform", "letter-spacing", "padding",
];

/** Solo il PANNELLO: il sito pubblico non carica `styles/button.css`, e il suo
 *  `.btn` e' un altro bottone in un altro mondo. */
function fileAdmin(dir = "src", out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) fileAdmin(p, out);
    else if (p.endsWith(".astro") && (p.includes("/admin") || p.includes("admin/"))) out.push(p);
  }
  return out;
}

const senzaCommenti = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");

test("nessuna pagina ridipinge un componente condiviso", () => {
  const colpe = [];
  for (const f of fileAdmin()) {
    const testo = readFileSync(f, "utf8");
    for (const blocco of testo.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []) {
      const css = senzaCommenti(blocco);
      for (const [, sel, corpo] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const s = sel.replace(/\s+/g, " ").trim();
        // ⚠️ `(?![\w-])`: senza, `.btn` prenderebbe anche `.btn-print` e
        // `.btn-cancel`, che sono bottoni LORO con un nome loro — la prova
        // griderebbe su venti righe oneste e nessuno la guarderebbe piu'.
        if (!COMPONENTI.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(s))) continue;
        const props = corpo.split(";").filter((p) => p.includes(":")).map((p) => p.split(":")[0].trim());
        const vestito = props.filter((p) => VESTITO.includes(p));
        if (vestito.length) colpe.push(`${f} → ${s} { ${vestito.join(", ")} }`);
      }
    }
  }
  assert.deepEqual(colpe, [],
    "queste regole ridipingono un componente condiviso dentro una pagina:\n  " + colpe.join("\n  ") +
    "\n  La variante va scritta in src/styles/ con un nome suo (vedi .btn-primary, .sw-sold).");
});

test("i tab dei modali sono la pastiglia condivisa", () => {
  // ⚠️ Non basta che le pagine non lo ridipingano: `.m-tab` deve ESISTERE in
  // un posto, se no e' una classe senza faccia e il primo che la usa se la
  // ridisegna — ricominciando da capo.
  const filtri = readFileSync("src/styles/filters.css", "utf8");
  assert.match(filtri, /\.m-tab\b/, "`.m-tab` non e' piu' definito con le pastiglie dei filtri");
  assert.match(filtri, /\.m-tab\.is-on/, "il tab acceso non e' piu' definito dove sta quello spento");
});

test("il bottone pieno delle colonne e' una variante, non una regola per colonna", () => {
  const bottoni = readFileSync("src/styles/button.css", "utf8");
  assert.match(bottoni, /\.btn-primary\s*\{/, "`.btn-primary` non c'e' piu': ogni colonna si riscrivera' il suo bottone pieno");
  const fascia = readFileSync("src/components/admin/home/Giornata.astro", "utf8");
  const pieni = [...fascia.matchAll(/class="btn btn-sm btn-primary"/g)].length;
  assert.ok(pieni >= 2, `solo ${pieni} bottoni della fascia usano la variante condivisa: le colonne stanno divergendo di nuovo`);
  // ⚠️ E nessuna colonna deve essere rimasta col tondo mentre l'altra ha la
  // pastiglia: due comandi diversi per la stessa cosa, uno accanto all'altro.
  // (Il tondo in se' va benissimo dove la parola non ci sta — le frecce del
  // carosello sono `.ibtn.ibtn-sm`: qui si guardano i DUE comandi che aprono
  // un modale in cima a una colonna.)
  assert.doesNotMatch(fascia, /class="ibtn[^"]*" id="(notes-add|spx-add)"/,
    "una colonna della fascia e' tornata al tondo mentre l'altra ha la pastiglia");
});

test("il form dei giorni speciali usa i campi e i bottoni di tutti", () => {
  // ⚠️ Vive in DUE posti — Réglages e il modale della Accueil — ed e' quello
  // che gli era costato una grafica sua: nel modale i campi li vestiva
  // `field.css`, in Réglages no, e invece di mettere la classe condivisa si
  // era riscritto fondo, bordo e tondo.
  const spf = readFileSync("src/components/admin/SpecialDaysForm.astro", "utf8");
  assert.match(spf, /class="fld spf-from"/, "le date non usano il campo condiviso");
  assert.match(spf, /class="fld spf-note"/, "la nota non usa il campo condiviso");
  assert.match(spf, /class="rh-filter spf-t-closed/, "«chiuso / aperto» non usa la pastiglia condivisa");
  assert.match(spf, /class="md-btn md-btn-primary spf-add"/, "«Aggiungi» non e' il bottone di conferma dei modali");
  assert.doesNotMatch(senzaCommenti(spf), /\.spf input\[type="text"\]/, "il form si e' riscritto la grafica dei campi");
  // `is-active` era il nome locale di uno stato che il pannello chiama `is-on`.
  assert.doesNotMatch(spf, /is-active/, "resta il nome locale `is-active` al posto di `is-on`");
});

test("un cestino solo, in tutta la Accueil", () => {
  // ⚠️ Nella stessa pagina ce n'erano TRE scritti a mano — `.note-del` nelle
  // note, `.evm-del` nel modale, e quello condiviso nei giorni speciali — con
  // tre bordi, tre rossi e tre misure per lo stesso gesto. E ognuno si era
  // riscritto anche la guardia a due tocchi, che e' la cosa che protegge dal
  // cancellare per sbaglio: tre copie di una regola di sicurezza sono tre
  // occasioni perche' una resti indietro.
  const HOME = readFileSync("src/pages/admin/index.astro", "utf8");
  const bottoni = [...HOME.matchAll(/<button[^>]*>\$\{TRASH_ICON\}<\/button>/g)].map((m) => m[0]);
  assert.ok(bottoni.length >= 3, `trovati solo ${bottoni.length} cestini: la lettura non funziona piu'`);
  const fuori = bottoni.filter((b) => !/class="[^"]*\bibtn ibtn-danger\b/.test(b));
  assert.deepEqual(fuori, [], "questi cestini non sono il bottone condiviso:\n  " + fuori.join("\n  "));
});
