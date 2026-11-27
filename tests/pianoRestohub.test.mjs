/**
 * Il piano di allineamento per admin.restohub.cloud (27/11/2026): l'admin
 * applica migrazioni, estensioni e job sul Supabase del cliente col SUO
 * token; il cliente gli da' solo le cose sue.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const leggi = (f) => readFileSync(f, "utf8");

test("piano e bucket vogliono la chiave dell'admin, come la scheda", () => {
  for (const f of ["src/pages/api/restohub/piano.ts", "src/pages/api/restohub/bucket.ts", "src/pages/api/restohub/stato.ts"]) {
    const s = leggi(f);
    assert.match(s, /const no = rifiutaSenzaChiave\(request\);\s*if \(no\) return no;/, f);
  }
  const k = leggi("src/lib/chiaveRestohub.ts");
  assert.match(k, /segretoUguale\(request\.headers\.get\(HEADER_CHIAVE\)/, "confronto a tempo costante, solo nell'header");
});

test("il token di Supabase non passa dal cliente", () => {
  const p = leggi("src/lib/pianoRestohub.ts");
  assert.doesNotMatch(p.replace(/\/\*[\s\S]*?\*\//g, ""), /SUPABASE_ACCESS_TOKEN/);
  assert.match(p, /migrazioni: MIGRAZIONI\.map/, "le migrazioni del codice di QUESTO cliente");
  assert.match(p, /job: motivo \? null : JOB_ATTESI\.map/, "niente job verso localhost o senza CRON_SECRET");
});

test("gli spazi d'archivio li fa il cliente, con la sua service key", () => {
  assert.match(leggi("src/pages/api/restohub/bucket.ts"), /applicaPasso\("bucket"\)/);
  assert.match(leggi("src/lib/admin/supabaseStato.ts"), /if \(passo === "bucket"\) \{[\s\S]*?\}\s*\n\s*if \(!env\("SUPABASE_ACCESS_TOKEN"\)\)/, "il passo bucket viene prima del controllo del token");
});
