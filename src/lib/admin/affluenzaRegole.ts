import { DateTime } from "luxon";

/**
 * LE REGOLE DELL'ABITUDINE — pure, senza database.
 *
 * Stanno a parte come `permessiRegole` sta a `permessi`: qui c'e' il come si
 * conta, nel file accanto il come si legge. Cosi' il conto si puo' provare
 * davvero, con righe scritte a mano, invece di doverlo guardare girare.
 */

/** Quante settimane indietro si guarda per sapere com'e' di solito. */
export const SETTIMANE = 8;

/**
 * Le N date dello STESSO GIORNO DELLA SETTIMANA prima di oggi.
 *
 * ⚠️ Non «gli ultimi N giorni». In un ristorante il martedi' e il sabato non
 * si assomigliano: una media su tutti i giorni darebbe una curva che non e'
 * quella di nessuna sera — e sarebbe la piu' credibile delle due, perche'
 * liscia e con la forma giusta.
 */
export function giorniPrecedenti(oggiISO: string, n = SETTIMANE): string[] {
  const d0 = DateTime.fromISO(String(oggiISO || ""));
  if (!d0.isValid || n <= 0) return [];
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(d0.minus({ weeks: i }).toISODate() as string);
  return out;
}

/** L'ora di una prenotazione: "20:00:00" → 20. `-1` se non si legge. */
export function oraDi(heure: unknown): number {
  const m = String(heure ?? "").match(/^(\d{1,2})(?::|$)/);
  if (!m) return -1;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : -1;
}

/**
 * Da «quanto, in che giorno, a che ora» alle medie per ora, serie per serie.
 *
 * ⚠️ Coperti e ordini restano DUE conti: sommarli dava un indice che non e'
 * ne' persone ne' ordini, e che nessuno poteva verificare contando qualcosa.
 *
 * ⚠️ Il divisore pero' e' UNO SOLO: i giorni in cui il locale ha avuto
 * qualcosa, non i giorni in cui ha avuto quella cosa li'. Un martedi' con
 * ordini e zero prenotazioni e' un martedi' aperto con zero coperti, e deve
 * abbassare la media dei coperti. Due divisori diversi darebbero due medie
 * che non si possono mettere una accanto all'altra — ed e' esattamente quello
 * che il grafico fa.
 */
export function mediePerOra(
  righe: { giorno: string; ora: number; quanti: number; serie: "covers" | "orders" }[],
): { covers: Record<string, number>; orders: Record<string, number>; settimane: number } {
  const somme: Record<string, Record<string, number>> = { covers: {}, orders: {} };
  const giorni = new Set<string>();
  for (const r of righe ?? []) {
    if (!Number.isFinite(r.ora) || r.ora < 0 || r.ora > 23 || !r.quanti) continue;
    if (r.serie !== "covers" && r.serie !== "orders") continue;
    somme[r.serie][String(r.ora)] = (somme[r.serie][String(r.ora)] ?? 0) + r.quanti;
    giorni.add(r.giorno);
  }
  const settimane = giorni.size;
  if (!settimane) return { covers: {}, orders: {}, settimane: 0 };
  const media = (m: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [h, tot] of Object.entries(m)) out[h] = Math.round((tot / settimane) * 10) / 10;
    return out;
  };
  return { covers: media(somme.covers), orders: media(somme.orders), settimane };
}
