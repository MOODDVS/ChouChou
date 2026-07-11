// Calcolo del prezzo effettivo con sconto.
// USATO SIA dal sito pubblico (db.ts) SIA dal checkout (checkout.ts):
// un solo punto di verità per non incassare mai una cifra diversa
// da quella mostrata.

export type DiscountType = "fixed" | "percent" | null;

/**
 * Prezzo effettivo in centesimi.
 * - fixed   : PREZZO PROMO finale (discount_value in centesimi,
 *             es. piatto a 14€ in promo a 12€ -> value 1200)
 * - percent : riduzione percentuale (discount_value 1-99)
 * Un prezzo promo >= prezzo pieno non ha effetto.
 */
export function prezzoEffettivo(
  priceCents: number,
  type: DiscountType | string | null | undefined,
  value: number | null | undefined
): number {
  const v = Math.round(Number(value ?? 0));
  if (!type || v <= 0) return priceCents;
  if (type === "fixed") return Math.min(priceCents, v);
  if (type === "percent") return Math.max(0, Math.round(priceCents * (1 - Math.min(v, 100) / 100)));
  return priceCents;
}
