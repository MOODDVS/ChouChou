/**
 * SORGENTE della prenotazione.
 *
 * Il guasto da evitare non e' una statistica sbagliata: e' una PRENOTAZIONE
 * PERSA. `reservations.source` ha un `check` in SQL, e un valore fuori elenco
 * fa fallire l'insert — il cliente vede un errore e il tavolo resta libero.
 * Per questo la prova piu' importante qui sotto non guarda il codice: legge
 * il .sql e confronta i due elenchi.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  SORGENTI,
  SORGENTI_DA_LINK,
  SORGENTE_DEFAULT,
  sorgenteDaRef,
  iconaDiSorgente,
} from "../src/lib/sorgenteRegole.ts";

test("l'elenco del codice combacia con il check del database", () => {
  // Il vincolo vero e' l'ULTIMO lanciato: la #74 rifa' quello della #21.
  const sql = readFileSync(new URL("../supabase/reservations_source_canali.sql", import.meta.url), "utf8");
  const m = sql.match(/check\s*\(\s*source\s+in\s*\(([^)]+)\)/i);
  assert.ok(m, "il check su `source` non e' piu' riconoscibile in reservations_source_canali.sql");
  const nelSql = m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort();
  assert.deepEqual([...SORGENTI].sort(), nelSql,
    "SORGENTI e il check SQL divergono: un valore in piu' qui fa fallire l'insert");
});

test("dal link si puo' dichiarare solo cio' che e' nell'elenco pubblico", () => {
  assert.equal(sorgenteDaRef("google"), "google");
  assert.equal(sorgenteDaRef("instagram"), "instagram");
  assert.equal(sorgenteDaRef("qr"), "qr");
  assert.equal(sorgenteDaRef("GOOGLE"), "google", "maiuscole ammesse");
  assert.equal(sorgenteDaRef("  google  "), "google", "spazi ammessi");
});

test("tutto il resto diventa web, mai un errore e mai il valore grezzo", () => {
  for (const cattivo of ["", "   ", "pippo", "<script>", "'; drop table reservations;--", "facebook", null, undefined, 42, {}]) {
    assert.equal(sorgenteDaRef(cattivo), "web", String(cattivo));
  }
});

test("un link non puo' dichiararsi walkin o phone", () => {
  // Quelle le scrive il ristoratore dall'admin: se un link potesse dirle,
  // si vedrebbero prenotazioni «al telefono» arrivate dal sito di notte.
  assert.equal(sorgenteDaRef("walkin"), "web");
  assert.equal(sorgenteDaRef("phone"), "web");
  for (const s of SORGENTI_DA_LINK) {
    assert.ok(SORGENTI.includes(s), `${s} non e' un valore ammesso dalla colonna`);
  }
  assert.ok(!SORGENTI_DA_LINK.includes("walkin"));
  assert.ok(!SORGENTI_DA_LINK.includes("phone"));
});

test("il default e' un valore ammesso", () => {
  assert.ok(SORGENTI.includes(SORGENTE_DEFAULT));
  assert.equal(SORGENTE_DEFAULT, "web");
});

test("le icone restano cinque: il QR porta quella del sito", () => {
  assert.equal(iconaDiSorgente("qr"), "web");
  for (const s of ["web", "walkin", "phone", "google", "instagram"]) {
    assert.equal(iconaDiSorgente(s), s, s);
  }
  // Nessuna sorgente deve chiedere un'icona che non esiste.
  const ICONE = new Set(["web", "walkin", "phone", "google", "instagram"]);
  for (const s of SORGENTI) assert.ok(ICONE.has(iconaDiSorgente(s)), `${s} chiede un'icona che non c'e'`);
});
