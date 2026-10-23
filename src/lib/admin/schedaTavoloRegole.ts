/**
 * LA SCHEDA DEL TAVOLO — le regole, senza database (22/10/2026).
 *
 * ⚠️ Nessun import, come `pianoSalaRegole.ts`: si provano in vitest senza
 * arrivare a `db.ts`.
 */

/**
 * Questa riga di `reservations` sta su questo tavolo?
 *
 * ⚠️ DUE COLONNE. `tables` (jsonb, la #37) e' dove la prenotazione e' seduta;
 * `tab_table_id` (la #87) e' il tavolo da cui e' partito il conto. Di solito
 * il secondo e' anche nel primo, ma un conto aperto dal QR e poi unito a un
 * altro tavolo li ha diversi: si guardano tutti e due.
 * `tables` arriva come array o come testo JSON, a seconda di chi l'ha letto.
 */
export function tavoloDellaRiga(r: { tables?: unknown; tab_table_id?: unknown }, tavoloId: string): boolean {
  if (String(r.tab_table_id ?? "") === tavoloId) return true;
  return tavoliDelleRiga(r.tables).includes(tavoloId);
}

/** Gli id di `tables`, che arrivi come array o come testo JSON. */
export function tavoliDelleRiga(tables: unknown): string[] {
  let t: unknown = tables;
  if (typeof t === "string") {
    try { t = JSON.parse(t); } catch { t = []; }
  }
  return Array.isArray(t) ? t.map(String).filter(Boolean) : [];
}

export interface PrenotazioneDelGiorno {
  heure: string;
  persone: number;
  nome: string;
}

/**
 * LA PROSSIMA PRENOTAZIONE di oggi su questo tavolo.
 *
 * Solo chi deve ancora arrivare (`pending` / `confirmed`, non `seated`), e
 * non piu' vecchia di 30 minuti: un ritardatario di un quarto d'ora e' ancora
 * «in arrivo», una prenotazione delle 12:00 alle 15:00 e' un no-show che
 * nessuno ha segnato, e mostrarla come «prossima» manderebbe il cameriere a
 * tenere un tavolo per nessuno.
 */
export function prossimaPrenotazione(
  righe: { heure?: unknown; people?: unknown; first_name?: unknown; last_name?: unknown; status?: unknown }[],
  adessoHHmm: string,
  tolleranzaMinuti = 30,
): PrenotazioneDelGiorno | null {
  const min = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const adesso = min(adessoHHmm);
  if (adesso === null) return null;
  const candidate = righe
    .filter((r) => r.status === "pending" || r.status === "confirmed")
    .map((r) => ({ r, m: min(String(r.heure ?? "")) }))
    .filter((x): x is { r: (typeof righe)[number]; m: number } => x.m !== null && x.m >= adesso - tolleranzaMinuti)
    .sort((a, b) => a.m - b.m);
  const p = candidate[0];
  if (!p) return null;
  return {
    heure: String(p.r.heure ?? "").slice(0, 5),
    persone: Number(p.r.people) || 0,
    nome: [p.r.first_name, p.r.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
  };
}

/**
 * DA QUANTO SONO SEDUTI: «8 min», «42 min», «1 h 05».
 *
 * Il timer dell'isola della scheda del tavolo (23/10/2026). Gira nel browser
 * ogni trenta secondi: per questo sta qui, senza import. Un orario
 * illeggibile o nel futuro (orologio del telefono avanti) da' «0 min», mai
 * un numero negativo.
 */
export function tempoSeduti(dalIso: string | null | undefined, adessoMs: number): string {
  const dal = Date.parse(String(dalIso ?? ""));
  const minuti = Number.isFinite(dal) ? Math.max(0, Math.floor((adessoMs - dal) / 60000)) : 0;
  if (minuti < 60) return `${minuti} min`;
  return `${Math.floor(minuti / 60)} h ${String(minuti % 60).padStart(2, "0")}`;
}
