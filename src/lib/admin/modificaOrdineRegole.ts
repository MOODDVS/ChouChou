/**
 * TOGLIERE QUALCOSA DA UN ORDINE GIA' FATTO, dal palmare — le regole, pure.
 * (23/10/2026, Enzo: «sugli ordini fatti ci deve essere un edit».)
 *
 * Cosa si puo' fare, e perche' cosi':
 *  - TOGLIERE (− su una riga, fino a zero): si cambia l'ordine stesso;
 *  - AGGIUNGERE (+ oltre la quantita' di partenza, o un piatto nuovo da
 *    «Commander») diventa un ordine NUOVO: cosi' il ticket della cucina porta
 *    SOLO i piatti in piu'. Aumentare la quantita' di un ordine gia'
 *    stampato non farebbe uscire nessun ticket, e la cucina non lo saprebbe
 *    mai. `dividiModifica` separa le due cose (Enzo, 23/10/2026: «perche'
 *    non si puo' aggiungere?»).
 *  - ⚠️ Un piatto tolto NON si stampa: la cucina va avvisata a voce (la
 *    scheda lo dice).
 *  - Solo un ordine DA INCASSARE (`pending` + `onsite`): uno pagato ha dei
 *    soldi dietro, e quello lo fa Commandes (rimborsi, differenze).
 *  - Tutto a zero = l'ordine si annulla.
 *
 * ⚠️ Nessun import: si prova in vitest e la usa anche il server.
 */

export interface VoceItems {
  id?: unknown;
  variant?: unknown;
  notes?: unknown;
  name?: unknown;
  base_name?: unknown;
  variant_label?: unknown;
  qty?: unknown;
  price_cents?: unknown;
}

export interface RigaModificabile {
  /** La posizione nella lista `items` dell'ordine: e' cosi' che si indica. */
  i: number;
  qty: number;
  nome: string;
  variante: string | null;
  prezzo: number;
}

const qtyDi = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** Le righe vere dell'ordine (non la nota, non le righe a zero), con il loro indice. */
export function righeModificabili(items: VoceItems[] | null | undefined): RigaModificabile[] {
  return (items ?? []).flatMap((it, i) => {
    if (!it || String(it.id ?? "") === "note" || qtyDi(it.qty) <= 0) return [];
    return [{
      i,
      qty: qtyDi(it.qty),
      nome: String(it.base_name ?? it.name ?? "").trim(),
      variante: String(it.variant_label ?? "").trim() || null,
      prezzo: Math.max(0, Math.round(Number(it.price_cents) || 0)),
    }];
  });
}

/** Si puo' toccare dal palmare? Solo da incassare. */
export function ordineModificabile(o: { status?: unknown; payment_method?: unknown }): boolean {
  return o.status === "pending" && o.payment_method === "onsite";
}

/**
 * Applica le quantita' nuove (`{ indice: qty }`). `null` = richiesta non
 * valida (indice che non e' una riga vera, quantita' piu' alta di quella di
 * partenza o non intera). Le righe a zero spariscono; nota e righe speciali
 * restano. `vuoto` = non resta nessun piatto: l'ordine va annullato.
 */
export function applicaTogli(
  items: VoceItems[] | null | undefined,
  nuove: unknown,
): { items: VoceItems[]; totale: number; vuoto: boolean; cambiato: boolean } | null {
  if (!nuove || typeof nuove !== "object" || Array.isArray(nuove)) return null;
  const lista = items ?? [];
  const vere = new Map(righeModificabili(lista).map((r) => [r.i, r]));
  const chieste = new Map<number, number>();
  for (const [k, v] of Object.entries(nuove as Record<string, unknown>)) {
    const i = Number(k);
    const q = Number(v);
    const r = vere.get(i);
    if (!r || !Number.isInteger(q) || q < 0 || q > r.qty) return null;
    chieste.set(i, q);
  }
  let cambiato = false;
  const fuori: VoceItems[] = [];
  lista.forEach((it, i) => {
    if (!vere.has(i)) { fuori.push(it); return; }
    const q = chieste.has(i) ? (chieste.get(i) as number) : (vere.get(i) as RigaModificabile).qty;
    if (q !== (vere.get(i) as RigaModificabile).qty) cambiato = true;
    if (q > 0) fuori.push({ ...it, qty: q });
  });
  const rimaste = righeModificabili(fuori);
  return {
    items: fuori,
    totale: rimaste.reduce((t, r) => t + r.prezzo * r.qty, 0),
    vuoto: rimaste.length === 0,
    cambiato,
  };
}

/** Il massimo di una riga dal palmare: un errore di dito non ordina 500 pizze. */
export const MAX_QTY_RIGA = 50;

/**
 * Le quantita' nuove (`{ indice: qty }`) divise in due:
 *  - `togli`: cio' che scende, da applicare all'ordine (`applicaTogli`);
 *  - `aggiungi`: cio' che sale oltre la partenza, come righe per un ordine
 *    NUOVO (stesso piatto, stesso formato, stessa nota per la cucina).
 * `null` = richiesta non valida.
 */
export function dividiModifica(
  items: VoceItems[] | null | undefined,
  nuove: unknown,
): { togli: Record<number, number>; aggiungi: { id: string; qty: number; variant?: string; note?: string }[] } | null {
  if (!nuove || typeof nuove !== "object" || Array.isArray(nuove)) return null;
  const lista = items ?? [];
  const vere = new Map(righeModificabili(lista).map((r) => [r.i, r]));
  const togli: Record<number, number> = {};
  const aggiungi: { id: string; qty: number; variant?: string; note?: string }[] = [];
  for (const [k, v] of Object.entries(nuove as Record<string, unknown>)) {
    const i = Number(k);
    const q = Number(v);
    const r = vere.get(i);
    if (!r || !Number.isInteger(q) || q < 0 || q > MAX_QTY_RIGA) return null;
    togli[i] = Math.min(q, r.qty);
    if (q > r.qty) {
      const it = lista[i];
      const variant = String(it.variant ?? "").trim();
      const note = String(it.notes ?? "").trim();
      aggiungi.push({ id: String(it.id ?? ""), qty: q - r.qty, ...(variant ? { variant } : {}), ...(note ? { note } : {}) });
    }
  }
  return { togli, aggiungi };
}
