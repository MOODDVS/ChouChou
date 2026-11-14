import { DateTime } from "luxon";
import { aggiorna, type Ambito } from "./admin/sede";
import { sogliaChiusura, OGNI_MS } from "./chiusuraPagatiRegole";

export { sogliaChiusura, OGNI_MS };

/**
 * GLI ORDINI PAGATI DEI GIORNI PASSATI SI CHIUDONO DA SOLI.
 *
 * Un ordine pagato che nessuno ha segnato «Prêt» resta `paid` per sempre: in
 * Commandes, nel giorno passato, rosso e con «Prêt» ancora da premere. La
 * regola: alle 02:00 del giorno dopo il ritiro diventa `done` (nessuna email).
 * Non tocca `pending` (soldi non entrati), `cancelled`, `done`.
 *
 * ⚠️ DUE STRADE, la stessa regola (14/11/2026, Educazione Napoletana):
 *   · il cron di ogni ora (`/api/cron/auto-complete-orders`, pg_cron in
 *     Supabase) — tutte le sedi insieme;
 *   · l'apertura di Commandes (`GET /api/admin/orders`) — la sede che si
 *     guarda, al massimo ogni 10 minuti per processo.
 * Prima c'era solo il cron: con i job pg_cron verso un indirizzo sbagliato
 * («localhosst») 53 ordini pagati sono rimasti aperti per giorni, e nessuno
 * se n'e' accorto fino a quelli rossi di ieri sera.
 */

/** Chiude i pagati con ritiro prima della soglia. Rende quanti. */
export async function chiudiPagatiPassati(ambito: Ambito, fuso: string, adesso = DateTime.now()): Promise<number> {
  const soglia = sogliaChiusura(adesso.setZone(fuso)).toISO();
  if (!soglia) return 0;
  const { data, error } = await aggiorna("orders", ambito, { status: "done" })
    .eq("status", "paid")
    .lt("pickup_time", soglia)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

const ultimaVolta = new Map<string, number>();

/** Da Commandes: al massimo ogni `OGNI_MS` per sede, e MAI bloccante — un
 *  errore qui non deve togliere la lista degli ordini a nessuno. */
export async function chiudiPagatiPassatiOgniTanto(ambito: Ambito, fuso: string, adesso = Date.now()): Promise<number> {
  const chiave = JSON.stringify(ambito);
  if (adesso - (ultimaVolta.get(chiave) ?? 0) < OGNI_MS) return 0;
  ultimaVolta.set(chiave, adesso);
  try {
    return await chiudiPagatiPassati(ambito, fuso);
  } catch (e) {
    console.error("[ordini] chiusura dei pagati passati:", e);
    return 0;
  }
}
