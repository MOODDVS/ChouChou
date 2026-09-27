/**
 * IL FUSO ORARIO — la variabile globale che decideva per tutti.
 *
 * Fino al 21/09/2026 il fuso era `export let TIMEZONE` in `slots.ts`: una
 * variabile di modulo MUTABILE, riempita al primo accesso e condivisa da
 * tutte le richieste del processo. Diciannove file la importavano.
 *
 * ⚠️ Con una sede sola non si vedeva niente. Con due sedi in fusi diversi, la
 * richiesta di una cambiava il valore sotto i piedi a quella dell'altra gia'
 * partita — e il risultato non era un errore, era un ORARIO SBAGLIATO MA
 * PLAUSIBILE: un'ora di ritiro nell'email, uno slot prenotabile, un giorno
 * speciale che scompare la sera prima. Nessuno l'avrebbe mai collegato alla
 * richiesta di un'altra persona.
 *
 * Adesso il fuso viaggia di mano in mano: `fusoDi(ambito)` lo legge, chi
 * calcola lo riceve come argomento.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { calcolaSlot, FUSO_DEFAULT, fusoValido } from "../src/lib/slots.ts";
import { appartenenzaConfig } from "../src/lib/admin/sedeRegole.ts";

function fileSorgente(dir, fuori = []) {
  for (const v of readdirSync(dir)) {
    const p = join(dir, v);
    if (statSync(p).isDirectory()) fileSorgente(p, fuori);
    else if (/\.(ts|astro)$/.test(v)) fuori.push(p);
  }
  return fuori;
}
const SORGENTI = fileSorgente("src");

test("la variabile globale non esiste piu', e non puo' tornare", () => {
  // ⚠️ La rete piu' importante del file. `export let` di un valore di
  // configurazione e' il guasto: non il nome, non il file — la mutabilita'
  // condivisa fra richieste.
  // ⚠️ I commenti si tolgono PRIMA di cercare: il commento che racconta
  // com'era — «QUI C'ERA export let TIMEZONE» — vale quanto il codice, e una
  // rete che lo scambia per il guasto costringe a cancellare la memoria.
  const codice = (f) => readFileSync(f, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  const slots = codice("src/lib/slots.ts");
  assert.doesNotMatch(slots, /export let TIMEZONE/, "la variabile globale e' tornata");
  assert.doesNotMatch(slots, /export async function aggiornaTimezone/);
  const colpevoli = SORGENTI.filter((f) => /\bTIMEZONE\b/.test(codice(f)));
  assert.deepEqual(colpevoli, [], "qualcuno usa di nuovo TIMEZONE fuori dai commenti");
});

test("il fuso e' una chiave DI SEDE", () => {
  // Era "marchio", e non perche' fosse giusto: perche' il codice ne
  // supportava uno solo. Girata la variabile, la classifica dice la verita'.
  assert.equal(appartenenzaConfig("timezone"), "sede");
});

test("`fuso` e' OBBLIGATORIO in calcolaSlot: niente ripiego silenzioso", () => {
  // ⚠️ Un valore di default qui rimetterebbe lo stesso guasto in forma piu'
  // educata: chi dimentica di passarlo calcolerebbe gli orari di Bruxelles
  // per una sede che sta altrove, senza che niente lo dica.
  const slots = readFileSync("src/lib/slots.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(slots, /\n {2}fuso: string;/, "`fuso` e' tornato opzionale");
  assert.doesNotMatch(slots, /fuso = FUSO_DEFAULT,/, "e' tornato un default dentro calcolaSlot");
});

test("calcolaSlot usa il fuso che riceve, non uno suo", async () => {
  const comune = {
    oraCorrente: (await import("luxon")).DateTime.fromISO("2026-06-01T09:00", { zone: "UTC" }),
    orariApertura: { open_time: "11:30", close_time: "14:30", is_open: true },
    tempoPrep: 30,
    durataSlot: 30,
    giorniChiusura: [],
  };
  const aBruxelles = calcolaSlot({ ...comune, fuso: "Europe/Brussels" });
  const aTokyo = calcolaSlot({ ...comune, fuso: "Asia/Tokyo" });
  // Stesso istante, due fusi: le 09:00 UTC sono le 11:00 a Bruxelles e le
  // 18:00 a Tokyo — a Tokyo il pranzo e' gia' finito.
  assert.ok(aBruxelles.length > 0, "a Bruxelles il pranzo deve essere ancora aperto");
  assert.deepEqual(aTokyo, [], "a Tokyo le 18:00 sono oltre la chiusura del pranzo");
});

test("ogni chiamata agli slot passa il fuso", () => {
  // Se calcolaSlotGiorno torna a 2 argomenti da qualche parte, TypeScript se
  // ne accorge — ma solo se qualcuno lancia `astro check`. Questa lo dice in
  // `npm test`, che gira sempre.
  const senza = [];
  for (const f of SORGENTI) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/calcolaSlotGiorno\(([^;]*?)\);/gs)) {
      const virgole = m[1].split(",").length;
      if (virgole < 3) senza.push(`${f}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(senza, [], "chiamate a calcolaSlotGiorno senza fuso");
});

test("chi legge il fuso lo chiede con l'AMBITO", () => {
  // `fusoDi()` senza argomenti, o con una costante, vorrebbe dire che siamo
  // tornati a un fuso solo per tutta l'installazione — ma di nascosto.
  const sospetti = [];
  for (const f of SORGENTI) {
    for (const m of readFileSync(f, "utf8").matchAll(/fusoDi\(([^)]*)\)/g)) {
      const arg = m[1].trim();
      if (!arg) sospetti.push(`${f}: fusoDi() senza ambito`);
    }
  }
  assert.deepEqual(sospetti, []);
});

test("le tre scelte «fuso dell'installazione» restano dichiarate", () => {
  // ⚠️ Newsletter, quota e cron degli ordini usano SEDE_UNICA di proposito:
  // sono lavori del marchio, e l'ora e' una sola. Non e' gratis — con sedi in
  // fusi diversi qualcuno riceve l'email a un'ora diversa da quella scritta —
  // ma e' una scelta con un motivo accanto, non una variabile globale che
  // decide per conto suo. Se sparisce il motivo, sparisce la scelta.
  for (const [f, cosa] of [
    ["src/pages/api/cron/newsletter.ts", "newsletter"],
    ["src/pages/api/admin/newsletter-schedule.ts", "programmazione"],
    ["src/lib/admin/newsletterQuota.ts", "quota"],
    ["src/pages/api/cron/auto-complete-orders.ts", "cron ordini"],
  ]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /fusoDi\(SEDE_UNICA\)/, `${cosa}: non usa piu' il fuso dell'installazione`);
    assert.match(src, /⚠️|INSTALLAZIONE|installazione/, `${cosa}: manca il motivo scritto accanto`);
  }
});

test("fusoValido dice no ai nomi che non esistono", () => {
  assert.equal(fusoValido("Europe/Brussels"), "Europe/Brussels");
  assert.equal(fusoValido("Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(fusoValido("Europe/Bruxelles"), null); // il nome francese non esiste
  assert.equal(fusoValido(""), null);
  assert.equal(fusoValido(null), null);
  assert.equal(fusoValido("   "), null);
  assert.equal(FUSO_DEFAULT, "Europe/Brussels");
});
