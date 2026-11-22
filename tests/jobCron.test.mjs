/**
 * scripts/job-cron.sh scrive a mano gli stessi 5 job della casella Supabase:
 * se uno cambia in JOB_ATTESI e non nello script, i job incollati non sono
 * piu' quelli che la casella si aspetta.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { JOB_ATTESI } from "../src/lib/admin/supabaseRegole.ts";

test("job-cron.sh ha gli stessi job di JOB_ATTESI", () => {
  const s = readFileSync("scripts/job-cron.sh", "utf8");
  const righe = [...s.matchAll(/^\s+"([a-z-]+)\|([^|]+)\|([^"]+)"$/gm)].map((m) => ({ nome: m[1], orario: m[2], percorso: m[3] }));
  assert.deepEqual(righe, JOB_ATTESI);
  // la chiave nell'header, mai nell'indirizzo; niente su disco
  assert.match(s, /jsonb_build_object\('x-cron-key'/);
  assert.match(s, /\| pbcopy/);
  assert.doesNotMatch(s, /> *"?\$?[A-Za-z_]*\.sql/);
});
