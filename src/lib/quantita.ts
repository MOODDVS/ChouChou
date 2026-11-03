/**
 * QUANTO SE NE PUO' ORDINARE (audit 3/11/2026).
 *
 * La quantita' arrivava dal carrello cosi' com'era: `1e9` passava e il
 * totale andava a Stripe; `"abc"` diventava `NaN` e il totale con lui.
 * Un intero da 1 a `QTY_MAX`, e un carrello di al massimo `RIGHE_MAX` righe.
 */
export const QTY_MAX = 99;
export const RIGHE_MAX = 60;

/** La quantita' se e' un intero da 1 a QTY_MAX, altrimenti null. */
export function quantita(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > QTY_MAX) return null;
  return n;
}
