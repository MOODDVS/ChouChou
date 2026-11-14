/**
 * Intégrations → la casella Supabase (5/11/2026). Le regole pure e le
 * protezioni: niente segreti in risposta, solo super admin, migrazioni
 * dentro il server, registro uguale al file #94.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  refDaUrl, refMascherato, migrazioneDaFile, ordinaMigrazioni, migrazioniMancanti,
  bucketDaSistemare, BUCKET_ATTESI, sitoRaggiungibile, sqlJob, sqlLetterale, jobGiusti, JOB_ATTESI,
  livelloCasella, SQL_REGISTRO,
} from "../src/lib/admin/supabaseRegole.ts";

test("il riferimento del progetto dall'URL, e mascherato", () => {
  assert.equal(refDaUrl("https://eqmvwqseajwkaxkijulz.supabase.co"), "eqmvwqseajwkaxkijulz");
  assert.equal(refDaUrl("https://eqmvwqseajwkaxkijulz.supabase.co/"), "eqmvwqseajwkaxkijulz");
  assert.equal(refDaUrl("http://localhost:54321"), "");
  assert.equal(refMascherato("eqmvwqseajwkaxkijulz"), "eqmv••••julz");
});

test("le migrazioni dai file, in ordine, e quelle che mancano", () => {
  assert.deepEqual(migrazioneDaFile("/x/supabase/092_tavoli_pentagono_rotazione.sql"), { numero: 92, file: "092_tavoli_pentagono_rotazione.sql", nome: "tavoli pentagono rotazione" });
  assert.equal(migrazioneDaFile("supabase/TUTTO.sql"), null);
  const tutte = ordinaMigrazioni(["b/003_c.sql", "a/001_a.sql", "a/002_b.sql"]);
  assert.deepEqual(tutte.map((m) => m.numero), [1, 2, 3]);
  assert.deepEqual(migrazioniMancanti(tutte, [1, 3]).map((m) => m.numero), [2]);
  // tutte quelle del repo sono leggibili, numerate di seguito, e c'e' la #94
  const file = readdirSync("supabase").filter((f) => /^\d{3}_/.test(f));
  const m = ordinaMigrazioni(file);
  assert.equal(m.length, file.length, "due file con lo stesso numero");
  assert.equal(m.at(-1).numero, m.length);
  assert.ok(m.some((x) => x.numero === 94));
});

test("il registro: il codice e il file #94 dicono la stessa cosa", () => {
  const f = readFileSync("supabase/094_registro_migrazioni.sql", "utf8");
  assert.ok(f.includes(SQL_REGISTRO), "094_registro_migrazioni.sql e SQL_REGISTRO si sono separati");
  assert.match(SQL_REGISTRO, /create table if not exists public\.restohub_migrazioni/);
  assert.match(SQL_REGISTRO, /to service_role/);
});

test("gli spazi: mancanti e visibilita' sbagliata", () => {
  assert.equal(bucketDaSistemare([]).mancanti.length, BUCKET_ATTESI.length);
  const r = bucketDaSistemare([{ id: "popups", public: true }, { id: "admin_docs", public: true }]);
  assert.deepEqual(r.mancanti.map((b) => b.id), ["menu", "documents", "brand"]);
  assert.deepEqual(r.daCorreggere.map((b) => b.id), ["admin_docs"], "admin_docs deve essere privato");
});

test("i job: mai su localhost, chiave nell'header, apici protetti", () => {
  assert.equal(sitoRaggiungibile("https://villa77.be"), true);
  for (const x of ["http://localhost:4321", "https://localhost", "http://villa77.be", "https://127.0.0.1", "", "https://x.test"]) assert.equal(sitoRaggiungibile(x), false, x);
  // 14/11/2026, Educazione Napoletana: un errore di battitura nel `.env` locale passava.
  for (const x of ["https://localhosst:4321", "https://localhosst", "https://villa77.be:4321", "https://192.168.1.10", "https://pc-enzo.local", "https://[::1]"]) assert.equal(sitoRaggiungibile(x), false, x);
  for (const x of ["https://www.educazionenapoletana.be", "https://app.restohub.cloud", "https://villa77.be/"]) assert.equal(sitoRaggiungibile(x), true, x);
  const q = sqlJob(JOB_ATTESI[0], "https://villa77.be/", "ab'c");
  assert.match(q, /cron\.schedule\('auto-complete-orders', '0 \* \* \* \*'/);
  assert.match(q, /'https:\/\/villa77\.be\/api\/cron\/auto-complete-orders'/);
  assert.match(q, /'x-cron-key', 'ab''c'/);
  assert.doesNotMatch(q, /\?key=/);
  assert.equal(sqlLetterale("a'b"), "'a''b'");
  const giusti = JOB_ATTESI.map((j) => ({ jobname: j.nome, command: sqlJob(j, "https://villa77.be", "s"), active: true }));
  assert.equal(jobGiusti(giusti, "https://villa77.be").giusti.length, 5);
  // stesso job ma col dominio vecchio: da rifare
  assert.equal(jobGiusti(giusti, "https://nuovo.be").daRifare.length, 5);
  // in LOCALE il dominio non si confronta (5/11/2026, 450 Gradi): si dice quale e'
  const locale = jobGiusti(giusti, "http://localhost:4321");
  assert.equal(locale.giusti.length, 5);
  assert.deepEqual(locale.domini, ["villa77.be"]);
  // job vecchio con la chiave nell'indirizzo: da rifare
  const vecchio = [{ jobname: "daily-brief", command: "select net.http_get(url := 'https://villa77.be/api/cron/daily-brief?key=x')", active: true }];
  assert.ok(jobGiusti(vecchio, "https://villa77.be").daRifare.includes("daily-brief"));
  // Job verso un indirizzo che non esiste: da rifare, anche guardando in locale (14/11/2026).
  const sbagliati = giusti.map((g) => ({ ...g, command: g.command.replace("villa77.be", "localhosst:4321") }));
  assert.equal(jobGiusti(sbagliati, "http://localhost:4321").daRifare.length, 5);
  assert.equal(jobGiusti(sbagliati, "https://localhosst:4321").daRifare.length, 5);
  assert.equal(jobGiusti(sbagliati, "https://www.educazionenapoletana.be").daRifare.length, 5);
});

test("il segno della casella", () => {
  assert.deepEqual(livelloCasella(["ok", "ok"]), { livello: "ok", daFare: 0 });
  assert.deepEqual(livelloCasella(["ok", "parz", "parz"]), { livello: "parz", daFare: 2 });
  assert.deepEqual(livelloCasella(["no", "parz"]), { livello: "no", daFare: 2 });
  assert.deepEqual(livelloCasella(["ok", "ignoto"]), { livello: "ignoto", daFare: 0 });
});

test("l'API: solo super admin, e niente segreti in risposta o nei log", () => {
  const api = readFileSync("src/pages/api/admin/supabase-stato.ts", "utf8");
  assert.equal((api.match(/!isSuperUser\(staff\)\) return nonAutorizzato\(\)/g) ?? []).length, 2);
  const io = readFileSync("src/lib/admin/supabaseStato.ts", "utf8");
  // le chiavi si confrontano, mai si restituiscono
  assert.doesNotMatch(io, /env\("SUPABASE_SERVICE_KEY"\)/, "la service key non si legge qui: c'e' supabaseAdmin");
  assert.equal((io.match(/env\("SUPABASE_ANON_KEY"\)/g) ?? []).length, 1, "la anon key solo dentro il confronto");
  assert.match(io, /coppia\(env\("SUPABASE_ANON_KEY"\), env\("PUBLIC_SUPABASE_ANON_KEY"\)\)/);
  // nei log solo lo stato, mai il testo dell'SQL (i job contengono CRON_SECRET)
  for (const m of io.matchAll(/console\.error\(([^;]+)\);/g)) assert.doesNotMatch(m[1], /query|sql\b|segreto/i, m[0]);
  // l'errore di un job non rimanda il messaggio di Supabase (puo' ripetere l'SQL)
  assert.match(io, /if \(!r\.ok\) return \{ ok: false, errore: "sql", messaggio: nome \};/);
  // le migrazioni viaggiano dentro il server, TUTTO.sql escluso
  assert.match(io, /import\.meta\.glob\("\.\.\/\.\.\/\.\.\/supabase\/\[0-9\]\[0-9\]\[0-9\]_\*\.sql"/);
});
