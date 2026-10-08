/**
 * LA COLONNA «RECETTES» — i soldi entrati, quelli tornati indietro, e cosa li
 * ha portati.
 *
 * ⚠️ QUI NON SI CONTANO I SOLDI. Il conto e' uno solo e sta sul server
 * (`calcolaStats`, che a sua volta usa `ordiniConti`): questo file prende i
 * numeri gia' fatti e decide come si DISEGNANO — quante barre, quanto e' alto
 * il soffitto, quali intervalli portano l'etichetta. Un secondo conto qui
 * dentro vorrebbe dire due totali per lo stesso periodo, e un giorno
 * divergono: e' successo quattro volte con la parola «incassato».
 *
 * ⚠️ Nessun import che porti il database: solo regole gia' pure. L'asse e il
 * confronto col periodo di prima sono quelli della colonna Visibilité — due
 * colonne che mostrano una serie nel tempo devono leggersi allo stesso modo,
 * e un secondo `etichetteAsse` scritto qui sarebbe la stessa regola con
 * un'altra faccia.
 */
import { etichetteAsse, andamento, type Andamento } from "./visibilitaRegole";

export { etichetteAsse, andamento };
export type { Andamento };

/** I periodi che l'API conosce gia' (`/api/admin/stats?period=`).
 *  ⚠️ Non una lista di giorni (7 · 28 · 90) come in Visibilité: quelli
 *  andrebbero tradotti in una finestra, e la finestra — con il fuso del
 *  locale, i mesi di lunghezza diversa e l'anno in corso — la sa gia' fare il
 *  server. Qui si chiede quello che lui sa dare: niente da tenere allineato. */
export const PERIODI_R = ["day", "week", "month", "ytd"] as const;
export type PeriodoR = (typeof PERIODI_R)[number];

/** Il periodo di partenza: il mese. Un giorno solo dice troppo poco per
 *  leggere un andamento, l'anno troppo per vedere la settimana scorsa. */
export const PERIODO_R_DEFAULT: PeriodoR = "month";

export function periodoValidoR(v: unknown): PeriodoR {
  return (PERIODI_R as readonly string[]).includes(String(v)) ? (v as PeriodoR) : PERIODO_R_DEFAULT;
}

/** Un intervallo come lo manda il server: etichetta, ordini, soldi, resi. */
export interface PuntoSoldi {
  label?: string | null;
  count?: number | null;
  cents?: number | null;
  refund_cents?: number | null;
}

export interface BarraSoldi {
  label: string;
  /** Incassato nell'intervallo, in centesimi. */
  inc: number;
  /** Reso nell'intervallo, in centesimi. */
  rb: number;
  ordini: number;
}

export interface IstogrammaSoldi {
  barre: BarraSoldi[];
  /** Il soffitto del grafico, in centesimi. Mai zero. */
  cima: number;
  /** C'e' almeno un reso: chi disegna decide se nominare il secondo colore. */
  conResi: boolean;
}

/**
 * LE BARRE DEL GRAFICO DEI SOLDI.
 *
 * ⚠️ IL SOFFITTO GUARDA ANCHE I RESI. Le due barre stanno fianco a fianco e
 * condividono il righello: calcolato sui soli incassi, un rimborso piu' grande
 * dell'incasso di quel giorno — succede, si rimborsa un ordine pagato la
 * settimana prima — disegnerebbe una barra fuori dal riquadro.
 *
 * ⚠️ Il soffitto e' almeno 1: con tutto a zero `altezza()` dividerebbe per
 * zero e il grafico sarebbe una fila di stanghette alte quanto il riquadro.
 *
 * ⚠️ Troppi intervalli: si tengono gli ULTIMI. Un grafico che si stringe per
 * far stare la storia intera non si legge piu', e la parte che si guarda e'
 * quella recente. Oggi non capita (il periodo piu' lungo della colonna e'
 * l'anno, dodici mesi): vale per il giorno in cui qualcuno aggiungera' «da
 * sempre», che sono trimestri senza fine.
 */
export function istogrammaSoldi(
  serie: PuntoSoldi[] | null | undefined,
  maxBarre = 32,
): IstogrammaSoldi | null {
  const n = (v: unknown): number => {
    const x = Math.round(Number(v ?? 0));
    return Number.isFinite(x) ? Math.max(0, x) : 0;
  };
  const tutte = (serie ?? [])
    .filter((p): p is PuntoSoldi => !!p && typeof p === "object")
    .map((p) => ({
      label: String(p.label ?? ""),
      inc: n(p.cents),
      rb: n(p.refund_cents),
      ordini: n(p.count),
    }));
  if (!tutte.length) return null;
  const max = Math.max(1, Math.floor(maxBarre));
  const barre = tutte.length > max ? tutte.slice(tutte.length - max) : tutte;
  return {
    barre,
    cima: Math.max(1, ...barre.map((b) => Math.max(b.inc, b.rb))),
    conResi: barre.some((b) => b.rb > 0),
  };
}

/**
 * QUANTO PESANO I RESI, in percentuale intera.
 *
 * ⚠️ Il denominatore e' il LORDO (incassato + reso), non l'incassato netto: su
 * 100 € incassati e 100 € resi il netto e' zero, e «resi diviso netto» sarebbe
 * una divisione per zero. Col lordo fa il 50 %, che e' quello che e' successo.
 *
 * `null` quando non e' entrato ne' uscito niente: zero per cento di niente non
 * e' un dato, e' un periodo vuoto — e si scrive un trattino.
 */
export function quotaResi(incassato: unknown, resi: unknown): number | null {
  const inc = Math.max(0, Math.round(Number(incassato) || 0));
  const rb = Math.max(0, Math.round(Number(resi) || 0));
  const lordo = inc + rb;
  if (lordo <= 0) return null;
  return Math.round((rb / lordo) * 100);
}

/** Un articolo venduto, come lo manda il server (`top`). */
export interface Articolo {
  name: string;
  qty: number;
  cents: number;
}

/**
 * GLI ARTICOLI PIU' ORDINATI, in ordine di quantita'.
 *
 * ⚠️ Per QUANTITA' e non per incasso: la domanda e' «cosa esce dalla cucina»,
 * e ordinando per soldi la classifica si riempie dei piatti cari ordinati due
 * volte. L'incasso resta scritto accanto, che e' l'altra meta' della risposta.
 *
 * ⚠️ Le righe senza nome o senza quantita' si buttano: una riga vuota in cima
 * alla classifica e' un piatto fantasma che qualcuno andra' a cercare in menu.
 */
export function articoli(
  top: Array<{ name?: string | null; qty?: unknown; cents?: unknown }> | null | undefined,
  quanti = 6,
): Articolo[] {
  return (top ?? [])
    .filter((a) => !!a && String(a.name ?? "").trim() !== "" && Math.round(Number(a.qty) || 0) > 0)
    .map((a) => ({
      name: String(a.name).trim(),
      qty: Math.round(Number(a.qty) || 0),
      cents: Math.max(0, Math.round(Number(a.cents) || 0)),
    }))
    .sort((x, y) => y.qty - x.qty)
    .slice(0, Math.max(1, Math.floor(quanti)));
}
