/**
 * LA LINGUA DEL CAMERIERE — la regola, senza import (23/10/2026).
 *
 * L'admin ha UNA lingua per tutto il locale (Réglages). Il palmare no: il
 * proprietario lavora in italiano, il cameriere parla solo inglese. La scelta
 * sta in un cookie DEL TELEFONO, non nell'account: vale subito (un dato
 * dell'account arriverebbe nel token solo al rinnovo, cioe' fra un'ora) ed e'
 * giusto cosi' anche per il palmare condiviso — chi lo prende in mano lo
 * mette nella sua lingua.
 * Nessun cookie, o uno che non e' una lingua dell'admin → la lingua
 * dell'admin, come prima.
 */
export const COOKIE_LINGUA_PALMARE = "mdd_lingua_palmare";

const LINGUE = ["fr", "en", "it", "nl", "es"];

/** La lingua scelta, letta dall'header `Cookie`, o null. */
export function linguaDalCookie(header: string | null | undefined): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_LINGUA_PALMARE}=([^;]*)`).exec(String(header ?? ""));
  const v = m ? decodeURIComponent(m[1]).trim().toLowerCase() : "";
  return LINGUE.includes(v) ? v : null;
}
