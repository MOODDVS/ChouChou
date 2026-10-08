/**
 * LA VISIBILITA' SU GOOGLE — chi ci cerca, e se stiamo salendo.
 *
 * I dati arrivano da Search Console (`/api/admin/search-console?detail=1`):
 * clic, impressioni, posizione media, il periodo precedente per il confronto,
 * la serie giorno per giorno e le parole cercate.
 *
 * ⚠️ DUE NUMERI CHE SI LEGGONO AL CONTRARIO, ed e' tutto il mestiere di questo
 * file:
 *   - LA POSIZIONE: in classifica SCENDERE di numero e' salire. Da 14,2 a 9,8
 *     e' una buona notizia, e scritta con la freccia in giu' si legge come un
 *     crollo.
 *   - LE IMPRESSIONI SENZA CLIC: comparire di piu' e farsi cliccare uguale non
 *     e' crescere — e' il contrario, ed e' il motivo per cui accanto a ogni
 *     parola cercata c'e' anche quante volte si e' comparsi.
 *
 * ⚠️ UN SOLO IMPORT, e puro: `scarto()` sta in `googleRegole.ts` con la sua
 * trappola dello zero (da zero non esiste un aumento percentuale).
 */
import { scarto } from "./googleRegole";

export { scarto };

/** I periodi che l'API accetta (`GIORNI` in `api/admin/search-console`). */
export const PERIODI = [7, 28, 90] as const;
export type Periodo = (typeof PERIODI)[number];

/** Il periodo chiesto, o il ripiego a 28 giorni. ⚠️ Un numero che l'API non
 *  conosce tornerebbe comunque 28 giorni di dati sotto un'etichetta «90 g»:
 *  si sceglie qui, una volta, e la pastiglia accesa dice la verita'. */
export function periodoValido(n: unknown): Periodo {
  const v = Number(n);
  return (PERIODI as readonly number[]).includes(v) ? (v as Periodo) : 28;
}

export interface PuntoVis {
  date?: string | null;
  clicks?: number | null;
  impressions?: number | null;
}

export interface Barra {
  /** La chiave-giorno della prima giornata del gruppo. */
  iso: string;
  valore: number;
  /** Quante giornate ci sono dentro: 1 per giorno, fino a 7 a settimane. */
  giorni: number;
}

export interface Istogramma {
  barre: Barra[];
  passo: "giorno" | "settimana";
  cima: number;
  /** Prima e ultima giornata vere, per scriverle sotto il grafico. */
  da: string;
  a: string;
}

/**
 * LE BARRE DEL GRAFICO.
 *
 * ⚠️ A NOVANTA GIORNI SI RAGGRUPPA PER SETTIMANE. Novanta barre dentro una
 * colonna larga trecento pixel sono novanta righe da tre pixel: non e' un
 * grafico, e' una texture. Sette giorni per volta restano tredici barre, che
 * si contano a occhio — e la gobba di una settimana di festa si vede meglio di
 * prima.
 *
 * ⚠️ SI RAGGRUPPA DALLA FINE: l'ultima barra deve finire sull'ultimo giorno
 * che Google ha mandato. Raggruppando dall'inizio, il resto della divisione
 * finiva in una barra monca in fondo — l'ultima, quella che si guarda — e
 * sembrava un crollo.
 */
export function istogramma(serie: PuntoVis[] | null | undefined, maxBarre = 30): Istogramma | null {
  const p = (serie ?? [])
    .filter((x) => x && typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date)))
    .map((x) => ({ iso: String(x.date), clicks: Math.max(0, Number(x.clicks) || 0) }))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!p.length) return null;

  const perGruppo = p.length > maxBarre ? 7 : 1;
  const barre: Barra[] = [];
  for (let fine = p.length; fine > 0; fine -= perGruppo) {
    const inizio = Math.max(0, fine - perGruppo);
    const fetta = p.slice(inizio, fine);
    barre.unshift({
      iso: fetta[0].iso,
      valore: fetta.reduce((s, x) => s + x.clicks, 0),
      giorni: fetta.length,
    });
  }
  return {
    barre,
    passo: perGruppo === 1 ? "giorno" : "settimana",
    // ⚠️ Il soffitto e' almeno 1: con tutte le barre a zero, `altezza()`
    // dividerebbe per zero e il grafico sarebbe una fila di stanghette alte
    // quanto il riquadro.
    cima: Math.max(1, ...barre.map((b) => b.valore)),
    da: p[0].iso,
    a: p[p.length - 1].iso,
  };
}

/**
 * QUALI BARRE PORTANO LA DATA SOTTO.
 *
 * ⚠️ Non tutte: ventotto date in fila sotto una striscia larga trecento pixel
 * si sovrappongono e diventano una riga grigia. E nemmeno due sole — la prima
 * e l'ultima, com'era fino all'08/10: fra i due estremi il grafico non dice
 * piu' DOVE si e' alzato, e una gobba a meta' periodo non si sa di quando sia.
 *
 * ⚠️ SI CONTA DALLA FINE, come il raggruppamento in settimane: l'ultima barra
 * e' quella che si guarda per prima e deve sempre avere la sua data. Contando
 * dall'inizio, l'ultima restava muta ogni volta che il numero di barre non era
 * un multiplo del passo.
 *
 * @param quante quante date al massimo (estremi compresi).
 * @returns gli indici delle barre che portano l'etichetta.
 */
export function etichetteAsse(barre: number, quante = 4): number[] {
  const n = Math.max(0, Math.floor(barre));
  if (n <= 0) return [];
  const max = Math.max(2, Math.floor(quante));
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const passo = Math.ceil((n - 1) / (max - 1));
  const fuori: number[] = [];
  for (let i = n - 1; i >= 0; i -= passo) fuori.unshift(i);
  // La prima barra porta la data anche quando il passo non ci arriva: e'
  // l'inizio del periodo, cioe' meta' della frase «dal ... al ...».
  if (fuori[0] !== 0) fuori.unshift(0);
  // ⚠️ Due date attaccate non si leggono: se il passo ha lasciato la seconda
  // etichetta addosso alla prima, la prima vince (e' l'estremo).
  if (fuori.length > 1 && fuori[1] - fuori[0] < passo / 2) fuori.splice(1, 1);
  return fuori;
}

export interface Andamento {
  /** La variazione in percentuale, o `null` se non si puo' dire. */
  diff: number | null;
  /** `true` quando la variazione e' una buona notizia. */
  meglio: boolean;
}

/** Clic e impressioni: di piu' e' meglio. */
export function andamento(ora: unknown, prima: unknown): Andamento {
  const diff = scarto(ora, prima);
  return { diff, meglio: (diff ?? 0) > 0 };
}

/**
 * LA POSIZIONE MEDIA: di MENO e' meglio.
 *
 * ⚠️ Non si scrive in percentuale ma in POSTI: «+18 %» su una posizione media
 * non vuol dire niente a nessuno, mentre «1,8 posti» e' quello che si e'
 * guadagnato. E il verso e' girato: da 14,2 a 12,4 si e' SALITI.
 */
export function andamentoPosizione(ora: unknown, prima: unknown): Andamento & { posti: number | null } {
  const a = Number(ora), b = Number(prima);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return { diff: null, meglio: false, posti: null };
  }
  const posti = Math.round((b - a) * 10) / 10;
  return { diff: posti, meglio: posti > 0, posti };
}
