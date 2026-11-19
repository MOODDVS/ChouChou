/**
 * IL REGISTRO DEI JOB (#99, 19/11/2026) — la scrittura.
 *
 * Sta da sola, leggera, perche' la importa il middleware: niente Stripe e
 * niente SQL delle migrazioni nel percorso di ogni richiesta.
 */
import { supabaseAdmin } from "./db";
import { jobDaPercorso, rigaDelGiro } from "./statoRestohubRegole";

/** Dopo ogni `/api/cron/*` con la chiave giusta. Non blocca e non fallisce mai. */
export async function segnaGiro(percorso: string, esito: number, ms: number): Promise<void> {
  const job = jobDaPercorso(percorso);
  if (!job) return;
  try {
    await supabaseAdmin.from("restohub_giri").upsert(rigaDelGiro(job, esito, ms, new Date()), { onConflict: "job" });
  } catch {
    /* senza la #99 non c'e' dove scrivere: la scheda dice «registro assente» */
  }
}
