/**
 * «PAGAMENTO IN CASSA» CHE LIBERA IL TAVOLO DA SOLO — le regole pure
 * (Enzo, 27/11/2026).
 *
 * Il cameriere tocca «Pagamento in cassa» sul palmare: esce l'addizione e il
 * tavolo diventa blu. I clienti vanno a pagare alla cassa, che sta FUORI da
 * RestoHub: nessuno torna sul palmare a dire «hanno pagato». Quindi:
 *
 *   - VENTI MINUTI dopo, il tavolo si libera da solo e i suoi ordini ancora
 *     da incassare si chiudono come pagati in cassa (`done`, metodo `onsite`:
 *     lo si puo' ancora cambiare in contanti / carta da Commandes);
 *   - se nei venti minuti arriva un altro ordine (il caffe'), esce di nuovo
 *     l'addizione COMPLETA aggiornata e i venti minuti ripartono.
 *
 * L'ora sta in `reservations.desk_at` (#102). Senza la migrazione, tutto come
 * prima: il tavolo resta blu finche' qualcuno non incassa.
 */

/** Dopo quanto il tavolo si libera da solo. */
export const LIBERA_DOPO_CASSA_MIN = 20;

/** Il momento prima del quale un «Pagamento in cassa» e' scaduto (ISO). */
export function sogliaCassa(adessoMs: number = Date.now()): string {
  return new Date(adessoMs - LIBERA_DOPO_CASSA_MIN * 60_000).toISOString();
}

/** Questo «Pagamento in cassa» ha fatto il suo tempo? Data illeggibile → no:
 *  meglio un tavolo blu da liberare a mano che dei soldi chiusi per errore. */
export function cassaScaduta(deskAt: unknown, adessoMs: number = Date.now()): boolean {
  if (deskAt === null || deskAt === undefined || deskAt === "") return false;
  const t = new Date(String(deskAt)).getTime();
  if (!Number.isFinite(t)) return false;
  return adessoMs - t >= LIBERA_DOPO_CASSA_MIN * 60_000;
}
