/**
 * Genera `supabase/TUTTO.sql`: tutte le migrazioni in un file solo, nell'ordine
 * dichiarato in `supabase/MIGRATIONS.md`.
 *
 *     node scripts/genera-tutto.mjs
 *
 * A COSA SERVE. Un Supabase nuovo vuole 74 file incollati a mano nell'editor
 * SQL, in ordine. Saltarne uno non da' nessun errore quel giorno: da' una
 * funzione rotta settimane dopo, la prima volta che qualcuno la apre. Con
 * questo file un cliente nuovo e' un copia-incolla solo, e un cliente vecchio
 * si "ripassa" per sicurezza — le migrazioni sono idempotenti, rilanciarle
 * non fa danni.
 *
 * ⚠️ L'ORDINE VIENE DA MIGRATIONS.md, NON DALLA CARTELLA.
 * Alfabetico sarebbe sbagliato: `031_clients_photo.sql` verrebbe prima di
 * `012_clients.sql` e fallirebbe. La tabella del .md e' gia' l'ordine giusto, ed
 * e' l'unico posto dove sta scritto.
 *
 * ⚠️ QUESTO FILE NON SI MODIFICA A MANO: si rigenera. C'e' una prova
 * (tests/migrazioni.test.mjs) che lo ricalcola e lo confronta, quindi se
 * qualcuno tocca una migrazione e dimentica di rigenerare, il test diventa
 * rosso prima che un cliente si prenda una migrazione a meta'.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const QUI = dirname(fileURLToPath(import.meta.url));
export const CARTELLA = join(QUI, "..", "supabase");
export const USCITA = "TUTTO.sql";

/** I file elencati in MIGRATIONS.md, nell'ordine della tabella. */
export function elencoMigrazioni() {
  const md = readFileSync(join(CARTELLA, "MIGRATIONS.md"), "utf8");
  const out = [];
  for (const riga of md.split("\n")) {
    const m = riga.match(/^\|\s*(\d+)\s*\|\s*`([^`]+\.sql)`\s*\|/);
    if (m) out.push({ n: Number(m[1]), file: m[2] });
  }
  return out;
}

/** I .sql presenti nella cartella, escluso quello generato. */
export function sqlNellaCartella() {
  return readdirSync(CARTELLA).filter((f) => f.endsWith(".sql") && f !== USCITA).sort();
}

/** Il contenuto atteso di TUTTO.sql. Funzione pura: la prova la richiama. */
export function componi() {
  const lista = elencoMigrazioni();
  const pezzi = [
    "-- ============================================================",
    "-- RestoHub — TUTTE LE MIGRAZIONI, in ordine.",
    "--",
    "-- GENERATO DA `scripts/genera-tutto.mjs`. Non modificare a mano:",
    "-- la prossima rigenerazione cancella tutto quello che scrivi qui.",
    "-- Per aggiungere una migrazione: crea il .sql, aggiungi la riga in",
    "-- MIGRATIONS.md, poi `node scripts/genera-tutto.mjs`.",
    "--",
    "-- USO: incollare tutto nell'SQL Editor di Supabase ed eseguire.",
    "-- Le migrazioni sono idempotenti: si puo' rilanciare su un cliente che",
    "-- ne ha gia' una parte, ed e' proprio il modo di recuperare quella che",
    "-- ci si e' dimenticati.",
    "--",
    "-- NB: i bucket Storage possono non nascere da qui se l'SQL Editor",
    "-- blocca l'insert su storage.buckets. In quel caso si creano dalla",
    "-- dashboard (Storage → New bucket, Public ON): popups, menu, documents,",
    "-- brand.",
    "-- ============================================================",
    "",
  ];
  for (const { n, file } of lista) {
    const sql = readFileSync(join(CARTELLA, file), "utf8").replace(/\s+$/, "");
    pezzi.push(
      "",
      "-- ------------------------------------------------------------",
      `-- #${n} — ${file}`,
      "-- ------------------------------------------------------------",
      sql,
      "",
    );
  }
  return pezzi.join("\n") + "\n";
}

// Lanciato a mano → scrive il file.
if (process.argv[1] && process.argv[1].endsWith("genera-tutto.mjs")) {
  const testo = componi();
  writeFileSync(join(CARTELLA, USCITA), testo);
  const n = elencoMigrazioni().length;
  console.log(`supabase/${USCITA}: ${n} migrazioni, ${testo.length} caratteri.`);
}
