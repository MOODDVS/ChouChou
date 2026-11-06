/**
 * Il ritorno unico da Google (6/11/2026): Google torna sempre su
 * app.restohub.cloud, che rimanda al sito scritto nello `state` — ma solo se
 * lo `state` e' firmato dall'app MOODD.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  RITORNO_UNICO, PERCORSO_CALLBACK, origineValida, componiState, destinazione, sitoDiRitorno, firmaGiusta,
} from "../src/lib/googleRitorno.ts";

const APP = "segreto-app-moodd";
const SITO = "service-key-del-sito";
const dati = (r, exp = Date.now() + 60_000) => ({ n: "abc", exp, r });

test("solo siti https, o localhost in http; mai utente:password", () => {
  assert.equal(origineValida("https://villa77.be/admin/super"), "https://villa77.be");
  assert.equal(origineValida("http://localhost:4321"), "http://localhost:4321");
  assert.equal(origineValida("http://127.0.0.1:4321"), "http://127.0.0.1:4321");
  assert.equal(origineValida("http://villa77.be"), "");
  assert.equal(origineValida("javascript:alert(1)"), "");
  assert.equal(origineValida("https://a:b@villa77.be"), "");
  assert.equal(origineValida(""), "");
});

test("il passaggio rimanda al callback del sito scritto nello state", () => {
  const s = componiState(dati("https://villa77.be"), SITO, APP);
  assert.equal(destinazione(s, APP), "https://villa77.be" + PERCORSO_CALLBACK);
  assert.equal(RITORNO_UNICO, "https://app.restohub.cloud/api/google/ritorno");
});

test("senza la firma dell'app, scaduto o con un sito strano: non rimanda", () => {
  const s = componiState(dati("https://villa77.be"), SITO, APP);
  assert.equal(destinazione(s, "altro-segreto"), null);
  assert.equal(destinazione(s, ""), null);
  // Un payload cambiato (altro sito) con le firme vecchie non passa.
  const [, a, b] = s.split(".");
  const finto = Buffer.from(JSON.stringify(dati("https://ladro.example"))).toString("base64url");
  assert.equal(destinazione(`${finto}.${a}.${b}`, APP), null);
  assert.equal(destinazione(componiState(dati("https://villa77.be", Date.now() - 1), SITO, APP), APP), null);
  assert.equal(destinazione(componiState(dati("http://villa77.be"), SITO, APP), APP), null);
  assert.equal(destinazione("", APP), null);
  assert.equal(destinazione("solo.due", APP), null);
});

test("la firma del sito resta del sito: il passaggio non la puo' sostituire", () => {
  const s = componiState(dati("https://villa77.be"), SITO, APP);
  const [p, mSito, mApp] = s.split(".");
  assert.ok(firmaGiusta(SITO, p, mSito));
  assert.ok(!firmaGiusta(SITO, p, mApp));
});

test("da localhost si torna su localhost, altrimenti al sito pubblico", () => {
  assert.equal(sitoDiRitorno("http://localhost:4321", "https://450gradi.be"), "http://localhost:4321");
  assert.equal(sitoDiRitorno("https://450gradi.be", "https://450gradi.be"), "https://450gradi.be");
  // Un Origin qualunque non decide dove si torna: conta il sito pubblico.
  assert.equal(sitoDiRitorno("https://ladro.example", "https://450gradi.be"), "https://450gradi.be");
  assert.equal(sitoDiRitorno(null, "https://450gradi.be/"), "https://450gradi.be");
});

test("consenso e scambio del codice usano lo STESSO indirizzo unico", () => {
  const lib = readFileSync("src/lib/googleBusiness.ts", "utf8");
  assert.match(lib, /export const REDIRECT_URI = RITORNO_UNICO;/);
  assert.equal((lib.match(/redirect_uri: REDIRECT_URI/g) ?? []).length, 2);
  // Al ritorno sul sito conta la firma DEL SITO (anti-CSRF), come prima.
  assert.match(lib, /if \(!firmaGiusta\(FIRMA, payload, mac\)\) return false;/);
  const connect = readFileSync("src/pages/api/google/connect.ts", "utf8");
  assert.match(connect, /creaState\(request\.headers\.get\("origin"\)\)/);
});

test("il passaggio non scambia il codice e non salva niente", () => {
  const r = readFileSync("src/pages/api/google/ritorno.ts", "utf8");
  assert.match(r, /destinazioneRitorno\(/);
  assert.doesNotMatch(r, /salvaTokenDaCode|supabase|oauth2\.googleapis/);
  assert.match(r, /for \(const k of \["code", "state", "error"\]\)/);
});
