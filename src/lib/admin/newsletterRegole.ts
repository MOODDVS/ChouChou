/** La casella Newsletter di Intégrations — la regola pura del segno (5/11/2026). */

export type Livello = "ok" | "parz" | "no";

/**
 * Rosso: non puo' partire niente (niente Resend, o niente quota ne' crediti).
 * Arancio: oltre l'80% delle incluse del mese e nessun credito di scorta.
 */
export function livelloNewsletter(s: {
  resend: boolean;
  quota: { total_remaining: number; sent_this_month: number; monthly_quota: number; purchased_balance: number };
}): Livello {
  if (!s.resend || s.quota.total_remaining <= 0) return "no";
  const q = s.quota;
  if (q.monthly_quota > 0 && q.sent_this_month >= q.monthly_quota * 0.8 && q.purchased_balance <= 0) return "parz";
  return "ok";
}
