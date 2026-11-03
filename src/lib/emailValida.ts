/**
 * UN'EMAIL SCRITTA DA UN CLIENTE: si accetta solo se ha la forma di un'email.
 *
 * ⚠️ Audit 3/11/2026: il tavolo (table-session, table-tab) prendeva qualunque
 * stringa — e a quell'indirizzo partono ricevute, avvisi, recensioni. La
 * regola e' la stessa di sempre (reservation.ts, contact.ts), con un tetto di
 * lunghezza: 254 caratteri e' il massimo che un'email puo' avere.
 */
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailValida(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 254 && RE_EMAIL.test(s);
}
