/**
 * DIVIDERE IL CONTO PER PERSONA — la regola, una sola (26/10/2026).
 * La usano il palmare (per disegnare le quote) e il server (per incassarle):
 * due conti scritti in due posti darebbero due importi diversi.
 *
 * Le quote si calcolano SEMPRE su quello che resta (`libero`) e sulle persone
 * che non hanno ancora pagato: le prime arrotondano per difetto, l'ultima
 * prende tutto il resto. 71,50 € in 4 = 17,87 + 17,87 + 17,88 + 17,88.
 * ⚠️ Nessun import: si prova in vitest.
 */
export function quoteRestanti(libero: number, restanti: number): number[] {
  const out: number[] = [];
  let l = Math.max(0, Math.round(libero) || 0);
  const n = Math.max(0, Math.floor(restanti) || 0);
  for (let k = 0; k < n; k++) {
    const a = n - k === 1 ? l : Math.floor(l / (n - k));
    out.push(a);
    l -= a;
  }
  return out;
}
