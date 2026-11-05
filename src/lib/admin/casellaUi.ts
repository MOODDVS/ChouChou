/**
 * LE CASELLE DI INTÉGRATIONS — i pezzi di interfaccia comuni (5/11/2026).
 *
 * Erano copiati in ogni script di casella (Supabase, Resend, Stripe, Google,
 * Search Console, Newsletter, Imprimantes): il segno in alto a destra e il
 * riquadro dell'esito. Una copia per casella e' una copia che diverge.
 */

/** Le icone del segno: spunta (ok), punto esclamativo (parz/no), punto (ignoto). */
export const SEGNO: Record<"ok" | "parz" | "no" | "ignoto", string> = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>',
  parz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01" /></svg>',
  no: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01" /></svg>',
  ignoto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17h.01" /></svg>',
};

/** Il riquadro dell'esito di un modale: vuoto = nascosto. */
export function esito(id: string, livello: "ok" | "parz" | "no" | "", testo = ""): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !livello;
  el.className = livello ? `sb-esito is-${livello}` : "sb-esito";
  el.textContent = testo;
}
