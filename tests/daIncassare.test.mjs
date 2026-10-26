/**
 * IL PROMEMORIA «NON ANCORA INCASSATI»: un avviso per tavolo (26/10/2026).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { raggruppaDaIncassare } from "../src/lib/daIncassareRegole.ts";

const LIMITE = "2026-10-26T20:00:00.000Z";
const riga = (id, creato, cents, extra = {}) => ({
  id, nome: "Walk-in", totale_cents: cents, tavolo: "T5 + T6 + T7", creato, reservation_id: "s1", service: "table", ...extra,
});

test("i giri della stessa seduta sono UNA riga, col totale di tutti", () => {
  const out = raggruppaDaIncassare([
    riga("a", "2026-10-26T19:00:00+00:00", 13900),
    riga("b", "2026-10-26T19:40:00+00:00", 3500),
    riga("c", "2026-10-26T19:10:00+00:00", 4000, { reservation_id: "s2", tavolo: "T1 + T2" }),
  ], new Map(), LIMITE);
  assert.equal(out.length, 2, "due tavoli, non tre ordini");
  const s1 = out.find((o) => o.tavolo === "T5 + T6 + T7");
  assert.equal(s1.totale_cents, 17400);
  assert.equal(s1.n, 2);
  assert.equal(s1.id, "a");
});

test("il pagato in parte al palmare si toglie, e a zero non si avvisa", () => {
  const righe = [riga("a", "2026-10-26T19:00:00+00:00", 5000)];
  assert.equal(raggruppaDaIncassare(righe, new Map([["s1", 1787]]), LIMITE)[0].totale_cents, 3213);
  assert.equal(raggruppaDaIncassare(righe, new Map([["s1", 5000]]), LIMITE).length, 0);
});

test("dimenticato si misura sul giro piu' vecchio; il giro nuovo entra nel totale", () => {
  const out = raggruppaDaIncassare([
    riga("a", "2026-10-26T19:00:00+00:00", 3000),
    riga("b", "2026-10-26T20:25:00+00:00", 800), // dopo il limite
  ], new Map(), LIMITE);
  assert.equal(out.length, 1);
  assert.equal(out[0].totale_cents, 3800);
  // Una seduta tutta fresca non si dice ancora.
  assert.equal(raggruppaDaIncassare([riga("x", "2026-10-26T20:10:00+00:00", 900)], new Map(), LIMITE).length, 0);
});

test("asporto e ordini senza seduta restano uno per uno", () => {
  const out = raggruppaDaIncassare([
    riga("a", "2026-10-26T19:00:00+00:00", 1000, { service: "pickup" }),
    riga("b", "2026-10-26T19:01:00+00:00", 1000, { service: "pickup" }),
    riga("c", "2026-10-26T19:02:00+00:00", 1000, { reservation_id: null }),
  ], new Map([["s1", 1000]]), LIMITE);
  assert.equal(out.length, 3);
  assert.ok(out.every((o) => o.totale_cents === 1000), "il pagato di una seduta non tocca l'asporto");
});

test("il tavolo e' quello dell'ultimo giro (la seduta spostata)", () => {
  const out = raggruppaDaIncassare([
    riga("a", "2026-10-26T19:00:00+00:00", 1000, { tavolo: "T5" }),
    riga("b", "2026-10-26T19:30:00+00:00", 1000, { tavolo: "T5 + T6 + T7" }),
  ], new Map(), LIMITE);
  assert.equal(out[0].tavolo, "T5 + T6 + T7");
});

import { sedutaFinita } from "../src/lib/daIncassareRegole.ts";
const DURATE = { perServizio: { diner: 120 }, ripiego: 90 };

test("un tavolo ancora a cena non si ricorda, finito si'", () => {
  const out = (finita) => raggruppaDaIncassare([riga("a", "2026-10-26T19:00:00+00:00", 3000)], new Map(), LIMITE, finita);
  assert.equal(out(() => false).length, 0, "a cena: niente avviso");
  assert.equal(out(() => true).length, 1);
  // L'asporto non aspetta nessun tavolo.
  assert.equal(raggruppaDaIncassare([riga("p", "2026-10-26T19:00:00+00:00", 900, { service: "pickup" })], new Map(), LIMITE, () => false).length, 1);
});

test("sedutaFinita: fine del servizio, tempo aggiunto, giorni passati, chiusa", () => {
  const r = { date: "2026-10-26", heure: "20:00", status: "seated", service_key: "diner", extra_minutes: 0 };
  assert.equal(sedutaFinita(r, DURATE, "2026-10-26", 20 * 60 + 30), false, "alle 20:30 sta mangiando");
  assert.equal(sedutaFinita(r, DURATE, "2026-10-26", 22 * 60), true, "20:00 + 120 = 22:00");
  assert.equal(sedutaFinita({ ...r, extra_minutes: 30 }, DURATE, "2026-10-26", 22 * 60), false, "+30 dal palmare");
  assert.equal(sedutaFinita({ ...r, service_key: "x" }, DURATE, "2026-10-26", 21 * 60 + 30), true, "ripiego 90");
  assert.equal(sedutaFinita(r, DURATE, "2026-10-27", 1), true, "il giorno dopo");
  assert.equal(sedutaFinita({ ...r, status: "done" }, DURATE, "2026-10-26", 20 * 60 + 5), true, "Fini");
  assert.equal(sedutaFinita(undefined, DURATE, "2026-10-26", 0), true, "sparita: meglio avvisare");
});
