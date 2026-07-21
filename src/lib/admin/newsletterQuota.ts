import { supabaseAdmin } from "../db";
import { DateTime } from "luxon";
import { TIMEZONE } from "../slots";

/**
 * Quota newsletter condivisa tra le API (invio e crediti).
 * Modello:
 * - 1000 email/mese INCLUSE, si azzerano ogni mese solare
 * - i crediti acquistati NON scadono e si consumano solo quando
 *   la quota mensile inclusa è esaurita
 * Il consumo dei crediti è derivato dallo storico: per ogni mese,
 * l'eccedenza oltre le 1000 incluse è stata pagata coi crediti.
 */

export const QUOTA_MESE = 1000;

export interface StatoQuota {
  sent_this_month: number;
  free_remaining: number; // incluse del mese ancora disponibili
  purchased_total: number; // crediti acquistati (pagati) da sempre
  purchased_balance: number; // crediti acquistati ancora disponibili
  total_remaining: number; // invii possibili adesso
}

export async function statoQuota(): Promise<StatoQuota> {
  const [{ data: log }, { data: acquisti }] = await Promise.all([
    supabaseAdmin.from("newsletter_log").select("count, created_at"),
    supabaseAdmin.from("newsletter_credits").select("credits").eq("status", "paid"),
  ]);

  // Invii raggruppati per mese (Europe/Brussels)
  const perMese = new Map<string, number>();
  for (const r of log ?? []) {
    const chiave = DateTime.fromISO(r.created_at, { zone: "utc" })
      .setZone(TIMEZONE)
      .toFormat("yyyy-MM");
    perMese.set(chiave, (perMese.get(chiave) ?? 0) + (r.count ?? 0));
  }

  const meseCorrente = DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM");
  const sentThisMonth = perMese.get(meseCorrente) ?? 0;

  // Crediti consumati = somma delle eccedenze mensili oltre le incluse
  let purchasedUsed = 0;
  for (const totale of perMese.values()) {
    purchasedUsed += Math.max(0, totale - QUOTA_MESE);
  }

  const purchasedTotal = (acquisti ?? []).reduce((s, r) => s + (r.credits ?? 0), 0);
  const purchasedBalance = Math.max(0, purchasedTotal - purchasedUsed);
  const freeRemaining = Math.max(0, QUOTA_MESE - sentThisMonth);

  return {
    sent_this_month: sentThisMonth,
    free_remaining: freeRemaining,
    purchased_total: purchasedTotal,
    purchased_balance: purchasedBalance,
    total_remaining: freeRemaining + purchasedBalance,
  };
}
