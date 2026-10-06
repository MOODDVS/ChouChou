/**
 * LA FASCIA DELLA GIORNATA — Google, prenotazioni, ordini.
 *
 * Il markup della fascia sta in un COMPONENTE (Giornata.astro) e chi lo
 * riempie sta in un'altra pagina (admin/index.astro), che lo cerca per id.
 * Nessuno dei due si accorge se l'altro cambia: `getElementById` di un id che
 * non esiste rende `null`, e un `if (!el) return` scritto per prudenza
 * trasforma la svista in «non succede niente». E' andata esattamente cosi':
 * `.j-dx` aveva solo la classe, e le tile non salivano mai.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const HOME = readFileSync("src/pages/admin/index.astro", "utf8");
const FASCIA = readFileSync("src/components/admin/home/Giornata.astro", "utf8");

test("ogni id cercato nella fascia esiste nel markup", () => {
  const cercati = [...new Set([...HOME.matchAll(/getElementById\("(j-[a-z0-9-]+)"\)/g)].map((m) => m[1]))];
  const esistono = new Set([...(FASCIA + HOME).matchAll(/id="(j-[a-z0-9-]+)"/g)].map((m) => m[1]));
  assert.ok(cercati.length > 10, "la lettura degli id non ha trovato niente: regex da rivedere");
  const fantasmi = cercati.filter((k) => !esistono.has(k));
  assert.deepEqual(fantasmi, [], `id cercati e mai scritti nel markup:\n  ${fantasmi.join("\n  ")}`);
});

test("una fascia senza colonne non lascia mezzo schermo vuoto", () => {
  // Spente prenotazioni E ordini, la fascia e' solo Google: o la riga la
  // finiscono due tile salite dalla griglia, o Google si prende la pagina.
  // Quello che non deve succedere e' la terza via — Google stretto a sinistra
  // e due terzi di niente a destra — ed e' lo stato in cui si cade se qualcuno
  // rimette le misure dentro `.j-niente` invece di lasciarle a `.jour`.
  assert.ok(/\.jour\.j-niente:not\(\.j-salite\) \{ grid-template-columns: 1fr; min-height: 0; \}/.test(HOME),
    "la fascia nuda non torna a una colonna sola");
  assert.ok(/\.jour\.j-niente \.j-due \{ display: none; \}/.test(HOME),
    "le colonne spente si tengono ancora l'altezza");

  // ⚠️ L'ordine conta: le tile che salgono sono quelle VISIBILI, e quali lo
  // sono lo si sa solo dopo il layout salvato. `promuovi()` chiamata prima
  // farebbe salire la prima tile del sorgente, magari una tile spenta.
  const dopoLayout = HOME.indexOf("promuovi();");
  const layout = HOME.indexOf("applicaLayout(DEFAULT_LAYOUT);");
  assert.ok(layout > 0 && dopoLayout > layout, "promuovi() non aspetta il layout salvato");
  assert.ok(/mdd:giornata/.test(HOME), "la fascia non avvisa chi gestisce le tile");
});
