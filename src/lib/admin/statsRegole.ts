/**
 * STATISTICHE — le regole di ripartizione, pure, senza database.
 *
 * Stesso patto degli altri `*Regole.ts`: qui non si legge niente.
 *
 * ⚠️ PERCHE' QUESTE FUNZIONI MERITANO DEI TEST. Un errore nelle statistiche
 * non si vede MAI: nessuno ricontrolla a mano se l'incasso di martedi' e'
 * giusto. Si guarda il numero, si prende una decisione, e il numero puo'
 * essere sbagliato da mesi. E' l'unico posto del progetto dove il guasto non
 * ha nessun sintomo — non un'email che non parte, non un ordine in attesa,
 * non un cliente alla porta: solo una cifra credibile.
 *
 * ⚠️ L'INVARIANTE CHE CONTA: le parti sommano il tutto. La somma della
 * ripartizione per sede deve dare esattamente il totale grande scritto
 * sopra. E' l'unica cosa che un umano puo' verificare a colpo d'occhio, e se
 * non torna se ne accorge — quindi deve tornare sempre, anche quando i dati
 * sono sporchi.
 *
 * Da qui la regola sulle righe SENZA sede: non si nascondono. Dopo il travaso
 * dello storico non dovrebbero essercene; se ricompaiono vuol dire che una
 * scrittura ha smesso di mettere `location_id` — ed e' molto meglio vederlo
 * come una riga «senza sede» che scoprirlo fra sei mesi da un totale che non
 * torna. Nascondere per far tornare i conti e' il modo in cui i conti
 * smettono di voler dire qualcosa.
 */

/** Gli stati che CONTANO come prenotazione. Un annullamento non e' una
 *  prenotazione: sommarlo darebbe una ripartizione che non torna con il
 *  numero grande. Stesso elenco che usa il totale, apposta. */
export const STATI_ATTIVI = ["confirmed", "seated", "done", "noshow"];

export interface QuotaOrdini {
  id: string | null;
  orders: number;
  revenue_cents: number;
  avg_cents: number;
}

/**
 * Incasso e ordini per punto.
 *
 * ⚠️ `avg_cents` di OGNI punto e' il suo incasso diviso i SUOI ordini. Quello
 * del gruppo non si ricava da questi: si calcola sul totale (incasso totale
 * diviso ordini totali). Fare la media delle medie darebbe lo stesso numero
 * solo se i tre punti avessero lo stesso numero di ordini — cioe' mai — e
 * sarebbe sbagliato in modo del tutto credibile.
 */
export function ripartisciOrdini(
  ordini: { total_cents: number; location_id?: string | null }[],
): QuotaOrdini[] {
  const per = new Map<string | null, { orders: number; revenue_cents: number }>();
  for (const o of ordini) {
    const id = o.location_id ?? null;
    const cur = per.get(id) ?? { orders: 0, revenue_cents: 0 };
    cur.orders++;
    cur.revenue_cents += Number(o.total_cents) || 0;
    per.set(id, cur);
  }
  return [...per.entries()]
    .map(([id, v]) => ({
      id,
      orders: v.orders,
      revenue_cents: v.revenue_cents,
      avg_cents: v.orders ? Math.round(v.revenue_cents / v.orders) : 0,
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

export interface QuotaResa {
  id: string | null;
  pren: number;
  coperti: number;
}

/** Prenotazioni e coperti per punto. Solo le righe ATTIVE, come il totale. */
export function ripartisciPrenotazioni(
  righe: { status?: string | null; people?: number | null; location_id?: string | null }[],
): QuotaResa[] {
  const attivi = new Set(STATI_ATTIVI);
  const per = new Map<string | null, { pren: number; coperti: number }>();
  for (const r of righe) {
    if (!attivi.has(String(r.status ?? ""))) continue;
    const id = r.location_id ?? null;
    const cur = per.get(id) ?? { pren: 0, coperti: 0 };
    cur.pren++;
    cur.coperti += Number(r.people ?? 0) || 0;
    per.set(id, cur);
  }
  return [...per.entries()]
    .map(([id, v]) => ({ id, pren: v.pren, coperti: v.coperti }))
    .sort((a, b) => b.pren - a.pren);
}

/** Attacca il nome del punto a una ripartizione. Nome vuoto = «senza sede»:
 *  l'etichetta la mette l'interfaccia, che sa in che lingua sta parlando. */
export function conNomi<T extends { id: string | null }>(
  quote: T[],
  nomi: Map<string, string>,
): (T & { nome: string })[] {
  return quote.map((q) => ({ ...q, nome: q.id ? (nomi.get(q.id) ?? "") : "" }));
}
