/**
 * L'ARITMETICA DELLE CHIAVI-GIORNO («YYYY-MM-DD»).
 *
 * ⚠️ SEMPRE A MEZZOGIORNO UTC. Due mezzanotti a cavallo del cambio dell'ora
 * legale distano 23 o 25 ore: dividendo per 86.400.000 si perde o si guadagna
 * un giorno, una volta ogni sei mesi, e in quei due giorni ogni conto fatto
 * con le date e' sbagliato di uno senza che niente lo dica.
 *
 * ⚠️ DUE DOMANDE CHE SI SOMIGLIANO, e non sono la stessa:
 *   - «quanti giorni sono PASSATI dal 3 al 5?» → due (`giorniPassati`);
 *   - «quanti giorni DURA una chiusura dal 3 al 5?» → tre, perche' il 3 e il 5
 *     sono chiusi (`giorniTra`, in `admin/giorniSpecialiRegole.ts`).
 * Erano due funzioni con lo stesso corpo e un `+ 1` di differenza, in due
 * moduli diversi: la seconda adesso e' scritta sulla prima, e il `+ 1` si vede.
 *
 * ⚠️ NESSUN IMPORT: la usano gli script del browser e il server.
 */

/** I giorni passati da `da` ad `a`. Negativo se `a` viene prima. Zero se una
 *  delle due chiavi non si legge: un conto inventato su una data rotta
 *  diventa una frase che sembra vera. */
export function giorniPassati(da: string, a: string): number {
  const x = Date.parse(`${String(da)}T12:00:00Z`);
  const y = Date.parse(`${String(a)}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.round((y - x) / 86400000);
}

/** La chiave-giorno `iso` piu' `n` giorni. */
export function piuGiorni(iso: string, n: number): string {
  const t = Date.parse(`${String(iso)}T12:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
