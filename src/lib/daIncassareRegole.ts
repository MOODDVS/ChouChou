import { alTavolo } from "./ordiniRegole";
import { fineSeduta } from "./salaInstallaRegole";
import type { DurateServizio } from "./pianoSalaRegole";

/**
 * COSA NON E' STATO INCASSATO — la regola pura del conteggio (26/10/2026).
 *
 * ⚠️ UN AVVISO PER TAVOLO, NON PER ORDINE. Dal palmare un tavolo ordina a
 * giri, e ogni giro e' un ordine suo: contati uno per uno, «T5 + T6 + T7»
 * compariva due volte nel promemoria («4 non ancora incassati» con due
 * tavoli). Gli ordini della stessa seduta (in sala, con la prenotazione) si
 * sommano in una riga, come la card raggruppata di Commandes.
 * ⚠️ IL PAGATO IN PARTE si toglie: un tavolo che ha gia' pagato 17,87 € al
 * palmare ne deve solo il resto, e se il resto e' zero non c'e' niente da
 * dire.
 * ⚠️ «Dimenticato» si misura sul giro PIU' VECCHIO: un tavolo con un dolce
 * ordinato 5 minuti fa e la cena di un'ora fa e' gia' da ricordare, e il
 * totale e' quello di tutta la seduta.
 * ⚠️ UN TAVOLO ANCORA A CENA NON E' UNA DIMENTICANZA (26/10/2026): il giro
 * delle 20:00 alle 20:30 ha 30 minuti, ma il tavolo sta ancora mangiando.
 * Per gli ordini di una seduta l'avviso aspetta anche la FINE DEL TAVOLO
 * (`sedutaFinita`: ora + durata del servizio + il tempo aggiunto), come i
 * conti aperti. L'asporto e il banco restano a 30 minuti.
 */

export interface RigaDaIncassare {
  id: string;
  nome: string;
  totale_cents: number;
  tavolo: string | null;
  creato: string;
  reservation_id?: string | null;
  service?: string | null;
}

export interface OrdineDaIncassare {
  id: string;
  nome: string;
  totale_cents: number;
  tavolo: string | null;
  creato: string;
  /** Quanti ordini (giri) ci sono dietro questa riga. */
  n: number;
}

/** La chiave della seduta: le stesse regole di `chiaveGruppo` in Commandes. */
export function chiaveSeduta(r: Pick<RigaDaIncassare, "id" | "reservation_id" | "service">): string {
  return alTavolo(r.service) && r.reservation_id ? `r:${r.reservation_id}` : `o:${r.id}`;
}

export interface SedutaInc {
  date?: unknown;
  heure?: unknown;
  status?: unknown;
  service_key?: unknown;
  extra_minutes?: unknown;
}

/**
 * Il tavolo ha finito? Chiuso (Fini, no-show, annullato) o di un giorno
 * passato: si'. Di oggi: quando l'ora supera la fine (`fineSeduta`, la stessa
 * del piano di sala, col tempo aggiunto dal palmare). Una seduta che non si
 * legge piu' (cancellata) conta come finita: meglio un avviso in piu' che
 * dei soldi persi.
 */
export function sedutaFinita(
  r: SedutaInc | undefined,
  durate: DurateServizio,
  oggi: string,
  oraMinuti: number,
): boolean {
  if (!r) return true;
  const stato = String(r.status ?? "");
  if (stato === "done" || stato === "noshow" || stato === "cancelled") return true;
  const data = String(r.date ?? "");
  if (data && data < oggi) return true;
  if (data > oggi) return false;
  const fine = fineSeduta(r, durate);
  return fine === null || oraMinuti >= fine;
}

export function raggruppaDaIncassare(
  righe: RigaDaIncassare[],
  pagatoPerSeduta: ReadonlyMap<string, number>,
  primaDiIso: string,
  finita?: (reservationId: string) => boolean,
): OrdineDaIncassare[] {
  const gruppi = new Map<string, RigaDaIncassare[]>();
  for (const r of righe) {
    const k = chiaveSeduta(r);
    gruppi.set(k, [...(gruppi.get(k) ?? []), r]);
  }
  // ⚠️ Le date si confrontano come istanti: Supabase scrive «+00:00», luxon «Z».
  const ms = (iso: string): number => Date.parse(iso) || 0;
  const limite = ms(primaDiIso);
  const fuori: OrdineDaIncassare[] = [];
  for (const [k, g] of gruppi) {
    g.sort((a, b) => ms(a.creato) - ms(b.creato));
    const primo = g[0];
    if (ms(primo.creato) > limite) continue; // ancora fresco
    if (finita && k.startsWith("r:") && !finita(k.slice(2))) continue; // ancora a cena
    const totale = g.reduce((t, r) => t + Math.max(0, Math.round(Number(r.totale_cents) || 0)), 0);
    const pagato = k.startsWith("r:") ? Math.max(0, Math.round(pagatoPerSeduta.get(k.slice(2)) ?? 0)) : 0;
    const resto = Math.max(0, totale - pagato);
    if (resto <= 0) continue;
    // Il tavolo dell'ultimo giro: se la seduta e' stata spostata, e' quello vero.
    const tavolo = [...g].reverse().find((r) => r.tavolo)?.tavolo ?? null;
    const nome = g.find((r) => r.nome)?.nome ?? "";
    fuori.push({ id: primo.id, nome, totale_cents: resto, tavolo, creato: primo.creato, n: g.length });
  }
  return fuori.sort((a, b) => ms(a.creato) - ms(b.creato));
}
