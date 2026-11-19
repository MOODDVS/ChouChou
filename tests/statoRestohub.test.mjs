/**
 * La scheda del cliente in admin.restohub.cloud (19/11/2026): l'endpoint di
 * stato, il registro dei job (#99) e le protezioni.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { jobDaPercorso, giriAttesi, rigaDelGiro, HEADER_CHIAVE } from "../src/lib/statoRestohubRegole.ts";
import { JOB_ATTESI } from "../src/lib/admin/supabaseRegole.ts";

test("ogni job atteso si riconosce dal suo indirizzo, gli altri no", () => {
  for (const j of JOB_ATTESI) assert.equal(jobDaPercorso(j.percorso), j.nome);
  assert.equal(jobDaPercorso("/api/cron/google-reviews"), "google-reviews-hourly");
  assert.equal(jobDaPercorso("/api/cron/newsletter/"), "newsletter");
  assert.equal(jobDaPercorso("/api/cron/inventato"), null);
  assert.equal(jobDaPercorso("/api/admin/stats"), null);
});

test("la scheda vede tutti i job, anche quelli mai passati", () => {
  const g = giriAttesi([
    { job: "newsletter", ultimo: "2026-11-19T10:10:00Z", esito: 200, ms: 120, ultimo_ok: "2026-11-19T10:10:00Z" },
    { job: "sconosciuto", ultimo: "2026-11-19T10:00:00Z", esito: 200, ms: 1, ultimo_ok: null },
  ]);
  assert.deepEqual(g.map((x) => x.job), JOB_ATTESI.map((j) => j.nome));
  const n = g.find((x) => x.job === "newsletter");
  assert.equal(n.esito, 200);
  assert.equal(n.ultimoOk, "2026-11-19T10:10:00Z");
  const mai = g.find((x) => x.job === "daily-brief");
  assert.equal(mai.ultimo, null);
  assert.equal(mai.esito, null);
});

test("un giro andato male non tocca l'ultimo andato bene", () => {
  const adesso = new Date("2026-11-19T10:00:00Z");
  assert.deepEqual(rigaDelGiro("newsletter", 200, 12.6, adesso), {
    job: "newsletter", ultimo: "2026-11-19T10:00:00.000Z", esito: 200, ms: 13, ultimo_ok: "2026-11-19T10:00:00.000Z",
  });
  const male = rigaDelGiro("newsletter", 500, 40, adesso);
  assert.equal(male.esito, 500);
  assert.equal("ultimo_ok" in male, false);
});

test("l'endpoint: chiave solo nell'header, confronto a tempo costante, 503 senza variabile", () => {
  const s = readFileSync("src/pages/api/restohub/stato.ts", "utf8");
  assert.equal(HEADER_CHIAVE, "x-restohub-key");
  assert.match(s, /segretoUguale\(request\.headers\.get\(HEADER_CHIAVE\)/);
  assert.doesNotMatch(s, /searchParams/);
  assert.match(s, /RESTOHUB_STATO_KEY/);
  assert.match(s, /503/);
});

test("in uscita niente chiavi: di Stripe solo live/test", () => {
  const s = readFileSync("src/lib/statoRestohub.ts", "utf8");
  assert.match(s, /modoChiave\(c\.chiave\)/);
  // la chiave decifrata non finisce in nessun campo della risposta
  assert.doesNotMatch(s, /chiave:\s*c\.chiave|firma:\s*c\.firma/);
  assert.doesNotMatch(s, /customer_|email|phone|first_name|last_name/);
});

test("il registro dei job: nel middleware, solo con la chiave giusta, file leggero", () => {
  const m = readFileSync("src/middleware.ts", "utf8");
  assert.match(m, /registroCron/);
  assert.match(m, /segretoUguale\(context\.request\.headers\.get\("x-cron-key"\)/);
  assert.match(m, /from "\.\/lib\/giriCron"/);
  const g = readFileSync("src/lib/giriCron.ts", "utf8");
  assert.deepEqual([...g.matchAll(/^import .* from "(.+)";$/gm)].map((x) => x[1]).sort(), ["./db", "./statoRestohubRegole"]);
  const sql = readFileSync("supabase/099_registro_giri.sql", "utf8");
  assert.match(sql, /create table if not exists public\.restohub_giri/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /to service_role;/);
  assert.doesNotMatch(sql, /\banon\b|authenticated/);
});
