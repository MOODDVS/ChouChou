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
 *
 * DUE ORE, NON UNA (28/11/2026, #103): `desk_at` e' QUANDO il conto e' stato
 * chiesto (la pillola dice «da 5 min»), `desk_until` QUANDO il tavolo si
 * libera («tra 15 min»). Servono separate perche' il cameriere puo' dare
 * dieci minuti in piu' (`PROROGA_CASSA_MIN`): spostare `desk_at` avrebbe
 * fatto dire alla pillola che il conto e' stato chiesto dopo. Senza la #103
 * la fine e' `desk_at` + 20 minuti, come prima.
 */

/** Dopo quanto il tavolo si libera da solo. */
export const LIBERA_DOPO_CASSA_MIN = 20;

/** I minuti che il cameriere aggiunge toccando la pillola. */
export const PROROGA_CASSA_MIN = 10;

/** Quando il tavolo si libera (ms): `desk_until` se c'e', altrimenti
 *  `desk_at` + 20 minuti. `null` = conto non chiesto, o date illeggibili. */
export function fineCassa(deskAt: unknown, deskUntil?: unknown): number | null {
  const u = deskUntil ? new Date(String(deskUntil)).getTime() : NaN;
  if (Number.isFinite(u)) return u;
  const a = deskAt ? new Date(String(deskAt)).getTime() : NaN;
  return Number.isFinite(a) ? a + LIBERA_DOPO_CASSA_MIN * 60_000 : null;
}

/** La nuova fine dopo «+10 min»: dieci minuti dopo la fine, o da adesso se
 *  la fine e' gia' passata (il job non l'ha ancora preso). */
export function fineProrogata(fine: number | null, adessoMs: number = Date.now()): number {
  return Math.max(fine ?? adessoMs, adessoMs) + PROROGA_CASSA_MIN * 60_000;
}

/** Il momento prima del quale un «Pagamento in cassa» e' scaduto (ISO). */
export function sogliaCassa(adessoMs: number = Date.now()): string {
  return new Date(adessoMs - LIBERA_DOPO_CASSA_MIN * 60_000).toISOString();
}

/** Questo «Pagamento in cassa» ha fatto il suo tempo? Data illeggibile → no:
 *  meglio un tavolo blu da liberare a mano che dei soldi chiusi per errore. */
export function cassaScaduta(deskAt: unknown, adessoMs: number = Date.now(), deskUntil?: unknown): boolean {
  if (deskAt === null || deskAt === undefined || deskAt === "") return false;
  const fine = fineCassa(deskAt, deskUntil);
  return fine !== null && adessoMs >= fine;
}
