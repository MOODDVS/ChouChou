/**
 * I SOLDI, SCRITTI — una riga, un posto solo.
 *
 * ⚠️ Era la stessa funzione copiata in cinque `<script>` di pannello
 * (Accueil, Commandes, Clients, Menu, Statistiques): identica cinque volte,
 * cioe' cinque posti in cui cambiare valuta o arrotondamento e quattro in cui
 * dimenticarselo. Il motore gira a Bruxelles e in euro; il giorno che non sara'
 * piu' vero, si cambia qui.
 *
 * ⚠️ NESSUN IMPORT: la usano gli script del browser, e una dipendenza di
 * server qui dentro finirebbe nel bundle della pagina.
 */

/** Centesimi → «12,50 €» nella lingua del pannello. Un valore illeggibile
 *  diventa zero: `NaN €` su una card e' peggio di «0,00 €», perche' chi legge
 *  non sa se e' un prezzo o un guasto. */
export function euroDa(cents: unknown, loc: string): string {
  const n = Number(cents);
  return ((Number.isFinite(n) ? n : 0) / 100).toLocaleString(loc, {
    style: "currency",
    currency: "EUR",
  });
}
