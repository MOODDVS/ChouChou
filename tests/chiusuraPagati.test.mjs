import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { sogliaChiusura, OGNI_MS } from "../src/lib/chiusuraPagatiRegole.ts";

const z = "Europe/Brussels";
const iso = (d) => d.toISO();

test("la soglia: passate le 02:00 l'inizio di oggi, prima l'inizio di ieri", () => {
  assert.equal(iso(sogliaChiusura(DateTime.fromISO("2026-11-14T09:15", { zone: z }))), "2026-11-14T00:00:00.000+01:00");
  assert.equal(iso(sogliaChiusura(DateTime.fromISO("2026-11-14T02:00", { zone: z }))), "2026-11-14T00:00:00.000+01:00");
  // 01:30: gli ordini di ieri sera hanno ancora la notte
  assert.equal(iso(sogliaChiusura(DateTime.fromISO("2026-11-14T01:30", { zone: z }))), "2026-11-13T00:00:00.000+01:00");
});

test("Commandes chiude i pagati passati, come il cron, ogni 10 minuti al massimo (14/11/2026)", () => {
  const lib = readFileSync("src/lib/chiusuraPagati.ts", "utf8");
  // solo i pagati: i `pending` sono soldi non entrati
  assert.match(lib, /\.eq\("status", "paid"\)\s*\.lt\("pickup_time", soglia\)/);
  assert.equal(OGNI_MS, 600000);
  const api = readFileSync("src/pages/api/admin/orders.ts", "utf8");
  assert.match(api, /const fuso = await fusoDi\(ambito\);[\s\S]{0,400}await chiudiPagatiPassatiOgniTanto\(ambito, fuso\);/);
  const cron = readFileSync("src/pages/api/cron/auto-complete-orders.ts", "utf8");
  assert.match(cron, /await chiudiPagatiPassati\(ambito, fuso\)/);
  assert.doesNotMatch(cron, /aggiorna\("orders"/, "il cron ha ripreso una copia sua della regola");
});
