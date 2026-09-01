import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Confronto a TEMPO COSTANTE di due segreti (es. la chiave dei cron).
 * Si passa da un hash SHA-256 così il confronto è sempre su buffer di
 * lunghezza fissa: niente early-return sulla lunghezza, niente timing leak.
 */
export function segretoUguale(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
