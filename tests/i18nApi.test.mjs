/**
 * MESSAGGI D'ERRORE DELLE API ADMIN — nella lingua dell'admin.
 *
 * Prima di oggi un admin in italiano cliccava «Salva», qualcosa andava
 * storto e leggeva «Enregistrement impossible». Non un guasto: il genere di
 * dettaglio che fa sembrare l'applicazione di qualcun altro.
 *
 * Le 546 stringhe francesi sotto /api/admin/ sono diventate chiavi del
 * dizionario admin, UNA per letterale: «Corps invalide» compariva in 48
 * punti e non ha 48 traduzioni diverse.
 *
 * ⚠️ Il modo in cui questo si rompe in silenzio e' preciso: `adminT`
 * restituisce la CHIAVE quando la riga non c'e'. Nessun errore, nessun
 * log — solo un toast rosso che dice «err.body». Per questo la prima rete
 * qui sotto e' la piu' importante di tutte.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { adminT, ADMIN_LANG_CODES } from "../src/i18n/admin.ts";

function fileTs(radice) {
  const fuori = [];
  for (const v of readdirSync(radice)) {
    const p = join(radice, v);
    if (statSync(p).isDirectory()) fuori.push(...fileTs(p));
    else if (v.endsWith(".ts")) fuori.push(p);
  }
  return fuori;
}

const API = fileTs("src/pages/api/admin");
const SORGENTI = API.map((f) => [f, readFileSync(f, "utf8")]);

test("ogni msg(\"...\") ha la sua riga nel dizionario", () => {
  const orfane = [];
  for (const [f, src] of SORGENTI) {
    for (const m of src.matchAll(/\bmsg\(\s*"([^"]+)"\s*\)/g)) {
      // adminT restituisce la chiave stessa se la riga manca: e' il sintomo.
      if (adminT("fr")(m[1]) === m[1]) orfane.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(orfane, [], "chiavi senza traduzione (l'utente leggerebbe la chiave)");
});

test("ogni chiave usata esiste in TUTTE e 5 le lingue, mai vuota", () => {
  const buchi = [];
  const chiavi = new Set();
  for (const [, src] of SORGENTI) for (const m of src.matchAll(/\bmsg\(\s*"([^"]+)"\s*\)/g)) chiavi.add(m[1]);
  for (const k of chiavi) {
    for (const lang of ADMIN_LANG_CODES) {
      const v = adminT(lang)(k);
      if (!v || v === k) buchi.push(`${k} [${lang}]`);
    }
  }
  assert.deepEqual(buchi, [], "traduzioni mancanti o vuote");
});

test("nessun messaggio francese e' rimasto scritto a mano nelle API admin", () => {
  // Un letterale con un accento francese in posizione `error:` / `message:`
  // e' una stringa che l'admin vedra' in francese qualunque lingua scelga.
  const residui = [];
  for (const [f, src] of SORGENTI) {
    for (const m of src.matchAll(/\b(?:error|message)\s*:\s*"([^"]{3,})"/g)) {
      if (/[éèêàçûôîœ]/i.test(m[1])) residui.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(residui, [], "messaggi ancora in francese (aggiungere la chiave al dizionario)");
});

test("ogni API che usa msg() la dichiara e importa adminT/adminLang", () => {
  const rotti = [];
  for (const [f, src] of SORGENTI) {
    if (!/\bawait msg\(/.test(src)) continue;
    if (!/async function msg\(/.test(src)) rotti.push(`${f}: manca la funzione msg()`);
    if (!/^import \{[^}]*\badminT\b/m.test(src)) rotti.push(`${f}: manca l'import di adminT`);
    if (!/^import \{[^}]*\badminLang\b/m.test(src)) rotti.push(`${f}: manca l'import di adminLang`);
    // Una `const msg` locale nasconderebbe la funzione: la chiamata diventa
    // «msg non e' una funzione», a runtime, dentro un ramo d'errore raro.
    if (/\bconst msg\b/.test(src)) rotti.push(`${f}: una const msg locale nasconde la funzione`);
  }
  assert.deepEqual(rotti, [], "API con il cablaggio i18n incompleto");
});

test("ogni \"err.*\" scritta nel codice ha la sua riga — anche quelle passate a runtime", () => {
  // Un validatore sincrono restituisce { errore: "err.price" } e il gestore
  // fa `await msg(v.errore)`: la chiave NON compare dentro msg("..."), quindi
  // la prima rete non la vede. Qui si guardano tutte le "err.*" di src/.
  const orfane = new Set();
  const visita = (dir) => {
    for (const v of readdirSync(dir)) {
      const p = join(dir, v);
      if (statSync(p).isDirectory()) { visita(p); continue; }
      if (!/\.(ts|astro|mjs)$/.test(v) || p.endsWith("i18n/admin.ts")) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/"(err\.[A-Za-z0-9_]+)"/g)) {
        if (adminT("fr")(m[1]) === m[1]) orfane.add(`${p}: ${m[1]}`);
      }
    }
  };
  visita("src");
  assert.deepEqual([...orfane], [], "chiavi err.* senza traduzione");
});

test("le 5 lingue ci sono per OGNI riga err.* del dizionario", () => {
  // Una riga con `it` dimenticato ricade sul francese senza dirlo: la lingua
  // sbagliata e' piu' insidiosa della chiave grezza, perche' sembra a posto.
  const diz = readFileSync("src/i18n/admin.ts", "utf8");
  const buchi = [];
  for (const m of diz.matchAll(/^\s+"(err\.[A-Za-z0-9_]+)":\s*\{ (.*) \},$/gm)) {
    for (const lang of ADMIN_LANG_CODES) {
      if (!new RegExp(`\\b${lang}: "`).test(m[2])) buchi.push(`${m[1]} [${lang}]`);
    }
  }
  assert.deepEqual(buchi, [], "righe del dizionario incomplete");
});
