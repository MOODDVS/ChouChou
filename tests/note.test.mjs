/**
 * LA LAVAGNETTA — e il ripiego che perdeva i dati senza dirlo.
 *
 * `admin_notes` e' cresciuta per migrazioni: `tags` (#34), `done_at` (#78),
 * `done_by` (#79), `due_at` e `repeat` (#80). Le migrazioni si lanciano a mano,
 * una per Supabase, quindi un cliente puo' avere le prime e non le ultime, e
 * l'API deve funzionare lo stesso.
 *
 * Il 07/10/2026 funzionava — ma male: il ripiego era UNO SOLO e tornava alle
 * colonne di partenza, cioe' buttava via tutte le colonne nuove insieme. Su un
 * database senza la #80, una nota salvata con l'etichetta «Important» si
 * salvava davvero, senza etichetta. Nessun errore, la nota nella colonna, il
 * tag sparito, e i filtri scomparsi con lui perche' non c'era piu' nessuna
 * etichetta in nessuna nota.
 *
 * Qui si guarda che il ripiego resti quello giusto: una colonna alla volta.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const API = readFileSync("src/pages/api/admin/notes.ts", "utf8");

test("il ripiego toglie UNA colonna alla volta, non tutte insieme", () => {
  assert.match(API, /function colonnaMancante\(/,
    "l'API non sa piu' QUALE colonna manca: senza quello il ripiego torna a buttarle via tutte");
  assert.match(API, /function conRipiego[\s\S]{0,600}fuori\.add\(manca\)/,
    "il ripiego non toglie piu' la singola colonna mancante prima di riprovare");

  // ⚠️ Il difetto vecchio in una riga: un secondo tentativo scritto a mano con
  // un corpo ridotto. Se ricompare, i dati tornano a sparire in silenzio.
  assert.doesNotMatch(API, /select\(SELECT_BASE\)/,
    "c'e' di nuovo un ripiego che chiede le sole colonne di partenza: le altre si perdono tutte insieme");
});

test("togliendo TUTTE le colonne nuove si arriva esattamente alle colonne di partenza", () => {
  // ⚠️ Se le due liste si scollano — una colonna nuova scritta in `SELECT` e
  // dimenticata in `COLONNE_NUOVE` — il ripiego non la toglierebbe mai e
  // l'errore si ripeterebbe uguale a ogni giro, fino a rispondere 500 a un
  // cliente che ha solo una migrazione indietro.
  const sel = API.match(/const SELECT = "([^"]+)"/)?.[1] ?? "";
  const base = API.match(/const SELECT_BASE = "([^"]+)"/)?.[1] ?? "";
  const nuove = (API.match(/const COLONNE_NUOVE = \[([^\]]+)\]/)?.[1] ?? "")
    .split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  assert.ok(sel && base && nuove.length, "le tre liste dell'API non si leggono piu': regex da rivedere");

  const resta = sel.split(", ").filter((c) => !nuove.includes(c)).join(", ");
  assert.equal(resta, base,
    `togliendo le colonne nuove resta «${resta}», che non e' l'elenco di partenza «${base}»`);
});

test("cancellare una nota e' da admin, e lo decide il server", () => {
  // ⚠️ Il cestino nascosto in CSS e' un cestino che c'e': chi conosce
  // l'indirizzo manda la richiesta lo stesso.
  assert.match(API, /function puoCancellare\([\s\S]{0,200}ruoloDi\(staff\) !== "user"/,
    "la regola di chi puo' cancellare non sta piu' nell'API");
  assert.match(API, /if \(delId\) \{\s*\n\s*if \(!puoCancellare\(staff\)\) return nonAutorizzato\(\);/,
    "la cancellazione non controlla piu' il ruolo prima di eseguire");
});

test("i tag sono liberi: si controlla quanti e quanto lunghi, non quali", () => {
  // Qui c'era un elenco chiuso di tre, e ogni altro tag veniva buttato via
  // senza dirlo: la nota si salvava, la parola spariva.
  assert.doesNotMatch(API, /TAGS_VALIDI/,
    "e' tornato l'elenco chiuso dei tag: tutto quello che non e' in lista sparisce in silenzio");
  assert.match(API, /MAX_TAG\b/, "non c'e' piu' un tetto al numero di etichette per nota");
  assert.match(API, /MAX_TAG_LEN\b/, "non c'e' piu' un tetto alla lunghezza di un'etichetta");
});
