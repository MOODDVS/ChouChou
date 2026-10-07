/**
 * IL PIANO DI SALA — nome e posto di un tavolo nuovo.
 *
 * Il difetto, trovato il 07/10/2026 guardando una mappa: nome e posizione
 * venivano dal CONTEGGIO dei tavoli (`slTavoli.length`). Finche' si aggiunge e
 * basta funziona. Basta cancellarne uno in mezzo e il conto torna indietro:
 * il tavolo dopo nasce con un nome gia' usato, esattamente sopra un tavolo che
 * c'e' gia'. Nessun errore, nessun test rosso — due riquadri sovrapposti e due
 * «T6» in una sala, che si vedono solo se qualcuno apre quella mappa.
 *
 * Qui si guarda il SORGENTE, perche' quel codice vive in uno <script> di
 * settings.astro e non si puo' importare. Si prova che il conteggio non sia
 * tornato, e che le due funzioni che cercano il posto libero ci siano.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const SET = readFileSync("src/pages/admin/settings.astro", "utf8");
/** Il blocco che crea un tavolo nuovo. */
const BLOCCO = SET.slice(SET.indexOf('".sl-add:not(.sl-decor-add)"'), SET.indexOf('".sl-add:not(.sl-decor-add)"') + 1200);

test("un tavolo nuovo non prende nome e posto dal conteggio", () => {
  assert.ok(BLOCCO, "il bottone che aggiunge un tavolo non si trova piu': il test guarda la parte sbagliata");
  assert.doesNotMatch(BLOCCO, /slTavoli\.length/,
    "il tavolo nuovo torna a contare i tavoli: cancellandone uno, il prossimo nasce sopra un altro e con un nome gia' preso");
  assert.match(BLOCCO, /slNomeLibero\(/, "il nome non si cerca piu' fra quelli liberi");
  assert.match(BLOCCO, /slPostoLibero\(/, "il posto non si cerca piu' fra quelli liberi");
});

test("le due funzioni guardano DAVVERO cosa c'e' gia'", () => {
  // ⚠️ Una `slNomeLibero` che rendesse sempre «T1» passerebbe il test di
  // sopra e rifarebbe il difetto. Qui si chiede che leggano `slTavoli`.
  const nome = SET.slice(SET.indexOf("function slNomeLibero("), SET.indexOf("function slNomeLibero(") + 400);
  assert.match(nome, /slTavoli\.map\(\(t\) => t\.name\)/, "slNomeLibero non guarda i nomi gia' usati");

  const posto = SET.slice(SET.indexOf("function slPostoLibero("), SET.indexOf("function slPostoLibero(") + 600);
  assert.match(posto, /slTavoli\.some\(/, "slPostoLibero non guarda dove stanno gli altri tavoli");
});
