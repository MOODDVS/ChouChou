/* ==========================================================================
   I SOLDI CHE NESSUNO HA PRESO (20/10/2026).

   Un ordine «à encaisser» mai incassato, un conto aperto col resto da pagare:
   il tablet lo ricorda ogni mezz'ora, il riepilogo del mattino lo scrive in
   rosso. E un conto aperto non sparisce piu' da solo.
   ========================================================================== */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const LIB = leggi("src/lib/admin/daIncassare.ts");
const NAV = leggi("src/components/admin/AdminNav.astro");

test("una regola sola per il tablet e per il riepilogo", () => {
  assert.match(leggi("src/pages/api/admin/orders.ts"), /da_incassare[\s\S]{0,400}cosaDaIncassare\(ambito\)/);
  assert.match(leggi("src/lib/admin/dailyBrief.ts"), /cosaDaIncassare\(ambito, new Date\(\), 0\)/);
});

test("gli ordini: da incassare, da piu' di 30 minuti, ultimi 7 giorni", () => {
  assert.match(LIB, /ORDINE_DIMENTICATO_MIN = 30/);
  assert.match(LIB, /\.eq\("status", "pending"\)\s*\.eq\("payment_method", "onsite"\)/);
  assert.match(LIB, /minus\(\{ days: 7 \}\)/);
});

test("i conti: solo aperti, col resto, a tavolo finito", () => {
  // ⚠️ Prima della fine del tavolo un conto aperto e' una cena in corso.
  assert.match(LIB, /\.eq\("tab_status", "open"\)/);
  assert.match(LIB, /if \(String\(r\.date\) < oggi\) return true;/);
  assert.match(LIB, /arrivo\.plus\(\{ minutes: hold \}\)/);
  assert.match(LIB, /\.filter\(\(c\) => c\.resto_cents > 0\)/);
});

test("il tablet ricorda ogni mezz'ora, e non scavalca un altro toast", () => {
  assert.match(NAV, /const OGNI_MS = 30 \* 60 \* 1000;/);
  // L'ora dell'ultimo avviso sopravvive al cambio di pagina.
  assert.match(NAV, /localStorage\.setItem\(CHIAVE_INCASSI/);
  assert.match(NAV, /if \(tEl\.classList\.contains\("show"\)\) return;/);
  // Resta finche' qualcuno non lo tocca, come la chiamata.
  assert.match(NAV, /function mostraIncassi[\s\S]*?apriToast\(0\);/);
  // Niente da incassare → la prossima dimenticanza si dice subito.
  assert.match(NAV, /if \(!ordini\.length && !conti\.length\) \{ scriviUltimo\(null\); return; \}/);
});

test("le parole del promemoria esistono in tutte e cinque le lingue", () => {
  const I = leggi("src/i18n/admin.ts");
  for (const k of ["nav.toastCollect", "nav.toastCollectMulti", "nav.toastCollectRest", "nav.toastCollectHint"]) {
    const riga = I.split("\n").find((l) => l.includes(`"${k}":`));
    assert.ok(riga, k);
    for (const l of ["fr", "en", "it", "nl", "es"]) assert.match(riga, new RegExp(`\\b${l}: "`), `${k} ${l}`);
  }
});

test("un conto aperto non si chiude da solo con la prenotazione", () => {
  // ⚠️ L'auto-«Fini» chiudeva la prenotazione, e con lei spariva il conto.
  const C = leggi("src/lib/admin/caricaResaGiorno.ts");
  assert.match(C, /if \(tab === "pending" \|\| tab === "open"\) return false;/);
});

test("Commandes mostra i conti aperti anche dei giorni prima", () => {
  // La lettura sta in contiSala dal 22/10/2026: la usano il tablet e il palmare.
  const T = leggi("src/pages/api/admin/table-tabs.ts");
  assert.match(T.slice(T.indexOf("export const GET"), T.indexOf("export const POST")), /await contiApertiDellaSala\(ambito\)/);
  const C = leggi("src/lib/admin/contiSala.ts");
  const get = C.slice(C.indexOf("export async function contiApertiDellaSala"), C.indexOf("export type RiassuntoConto"));
  assert.doesNotMatch(get, /\.eq\("date", oggi\)/, "a mezzanotte un conto aperto spariva con il suo resto");
  assert.match(get, /\.gte\("date", daData\)/);
  assert.match(get, /\.neq\("status", "cancelled"\)/);
  assert.match(leggi("src/pages/admin/orders.astro"), /giornoDiConto\(c\)/);
});
