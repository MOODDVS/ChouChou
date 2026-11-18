/**
 * LINK IN PIU' DEL SITO PUBBLICO per la scelta dei link nel pannello
 * (Assets → «Pages du site», 18/11/2026).
 *
 * Le pagine del menu arrivano gia' da `sitePages.ts`. Qui un cliente aggiunge
 * le pagine che NON stanno nel menu e nascono dai dati: la pagina di ogni
 * evento (Mare e Monti, `/groupes-evenements/<titolo>`), un prodotto, un
 * articolo. Ogni voce: il gruppo in cui compare, il nome, il PERCORSO nella
 * lingua di base (la lingua la mette il sito, vedi `linkDelSito`), e una
 * nota facoltativa (la data dell'evento).
 *
 * ⚠️ NEL MOTORE E' VUOTO: il motore non ha un sito, e non sa che pagine
 * figlie abbia un cliente. Il file e' `merge=ours` (.gitattributes): un
 * cliente lo riscrive e il sync del motore non glielo tocca.
 * ⚠️ NON LANCIA: se una lettura non riesce, meglio la lista delle pagine
 * senza gli eventi che un errore nella libreria.
 */
import type { Ambito } from "../lib/admin/sedeRegole";

export type LinkSito = { gruppo: string; label: string; url: string; nota?: string };

export async function linkExtraSito(_ambito: Ambito): Promise<LinkSito[]> {
  return [];
}
