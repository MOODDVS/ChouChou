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
