import type { DateTime } from "luxon";

/**
 * Le regole PURE della chiusura dei pagati (vedi `chiusuraPagati.ts`).
 * ⚠️ In un file a parte, senza import verso `db.ts`: le prove le leggono
 * senza le variabili di Supabase.
 */

/** La soglia: passate le 02:00, l'inizio di OGGI; prima delle 02:00 l'inizio
 *  di IERI (gli ordini di ieri sera hanno ancora la notte). */
export function sogliaChiusura(adesso: DateTime): DateTime {
  return (adesso.hour < 2 ? adesso.minus({ days: 1 }) : adesso).startOf("day");
}

/** ATTESA FRA DUE CHIUSURE per la stessa sede, da Commandes. La pagina chiede
 *  la lista ogni pochi secondi: una scrittura a ogni giro sarebbe uno spreco. */
export const OGNI_MS = 10 * 60_000;
