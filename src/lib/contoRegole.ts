/**
 * IL CONTO APERTO AL TAVOLO — regole pure (disegno: progetto, conto-aperto.md).
 *
 * Si ordina dal tavolo senza pagare subito. Chi apre il conto riceve un
 * CODICE a 2 cifre (e un QR «Inviter»); gli altri si uniscono con quello. Il
 * primo invio lo valida il personale, gli altri partono da soli dopo una
 * breve finestra di raggruppamento. Si paga alla fine.
 *
 * Qui solo le regole, senza database: il codice, il blocco dei tentativi, le
 * persone, la finestra, il resto da pagare e la parte uguale.
 */

/** Gli stati del conto, come in `reservations.tab_status` (#87). */
export const STATI_CONTO = ["pending", "open", "closed"] as const;
export type StatoConto = (typeof STATI_CONTO)[number];

/** Un conto che occupa il tavolo: da validare o validato. */
export function contoAperto(stato: unknown): boolean {
  return stato === "pending" || stato === "open";
}

/* ───────── Il codice ───────── */

/** Un codice nuovo, «00»–«99». `caso` si passa nei test. */
export function nuovoCodice(caso: () => number = Math.random): string {
  const n = Math.min(99, Math.max(0, Math.floor(caso() * 100)));
  return String(n).padStart(2, "0");
}

/** Il codice come lo scrive il cliente: «7», « 07 », «0 7» → «07».
 *  Qualunque altra cosa → `null` (e NON conta come tentativo sbagliato:
 *  un dito scivolato non deve avvicinare il blocco). */
export function codiceLetto(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!/^[0-9]{1,2}$/.test(s)) return null;
  return s.padStart(2, "0");
}

/** Tentativi sbagliati di fila prima del blocco. */
export const MAX_TENTATIVI_CODICE = 5;
/** Quanto dura il blocco. ⚠️ Con 5 tentativi ogni 10 minuti, provare tutti i
 *  100 codici vuol dire piu' di tre ore davanti a un tavolo: il conto e' gia'
 *  chiuso prima. */
export const BLOCCO_CODICE_MINUTI = 10;

/** Il conto rifiuta i codici adesso? Il blocco finisce da solo. */
export function codiceBloccato(sbagliati: number, ultimoSbaglio: Date | string | null, adesso: Date): boolean {
  if (!ultimoSbaglio || !(sbagliati >= MAX_TENTATIVI_CODICE)) return false;
  const t = new Date(ultimoSbaglio).getTime();
  if (Number.isNaN(t)) return false;
  return adesso.getTime() - t < BLOCCO_CODICE_MINUTI * 60_000;
}

/**
 * Il conteggio dopo un tentativo. Giusto → si riparte da zero. Sbagliato →
 * +1, ma se l'ultimo sbaglio e' piu' vecchio del blocco si riparte da 1:
 * cinque errori in una serata intera non sono un attacco.
 */
export function dopoTentativo(
  giusto: boolean,
  sbagliati: number,
  ultimoSbaglio: Date | string | null,
  adesso: Date,
): { sbagliati: number; ultimoSbaglio: Date | null } {
  if (giusto) return { sbagliati: 0, ultimoSbaglio: null };
  const t = ultimoSbaglio ? new Date(ultimoSbaglio).getTime() : NaN;
  const vecchio = Number.isNaN(t) || adesso.getTime() - t >= BLOCCO_CODICE_MINUTI * 60_000;
  return { sbagliati: vecchio ? 1 : (Math.max(0, sbagliati) || 0) + 1, ultimoSbaglio: adesso };
}

/* ───────── Le persone ───────── */

/**
 * Quanti sono al tavolo: il piu' alto fra quelli DICHIARATI all'apertura e
 * le persone che hanno ordinato. ⚠️ Non un conteggio automatico: chi non
 * ordina (un bambino, chi ordina per un altro) non inquadra, e non deve
 * abbassare il numero.
 */
export function personeConto(dichiarate: unknown, nomiCheHannoOrdinato: number): number {
  const d = Math.floor(Number(dichiarate));
  const base = Number.isFinite(d) && d >= 1 ? Math.min(d, 100) : 1;
  return Math.max(base, Math.max(0, Math.floor(nomiCheHannoOrdinato) || 0));
}

/** «3/4 ont commandé»: chi ha ordinato (nomi diversi, senza maiuscole ne'
 *  spazi ai bordi) e su quanti. */
export function hannoOrdinato(nomi: string[], dichiarate: unknown): { ordinato: number; su: number } {
  const visti = new Set(nomi.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return { ordinato: visti.size, su: personeConto(dichiarate, visti.size) };
}

/* ───────── La finestra di raggruppamento ───────── */

/** «Regrouper les envois»: Non / 1 min / 2 min (`orders_table_batch`). */
export const FINESTRE_INVIO = [0, 1, 2] as const;

/** Fuori elenco → 1 minuto: abbastanza per tenere insieme due vini ordinati
 *  a trenta secondi, troppo poco perche' un dolce sembri dimenticato. */
export function finestraInvio(v: unknown): number {
  const s = String(v ?? "").trim();
  if (s === "") return 1;
  const n = Number(s);
  return (FINESTRE_INVIO as readonly number[]).includes(n) ? n : 1;
}

/** Quando parte un invio: alla fine della finestra aperta dal suo PRIMO
 *  ordine. Gli ordini che arrivano dopo, dentro la finestra, lo raggiungono
 *  senza spostarla — se no un tavolo che continua ad aggiungere non
 *  partirebbe mai. */
export function partenzaInvio(primoOrdine: Date, minuti: number): Date {
  return new Date(primoOrdine.getTime() + Math.max(0, minuti) * 60_000);
}

/* ───────── Il resto da pagare ───────── */

/** Totale degli ordini meno i pagamenti riusciti. Mai sotto zero. */
export function restoDaPagare(totaliOrdini: number[], pagati: number[]): number {
  const somma = (xs: number[]) => xs.reduce((s, x) => s + (Number.isFinite(x) ? Math.round(x) : 0), 0);
  return Math.max(0, somma(totaliOrdini) - somma(pagati));
}

/**
 * Una parte uguale del resto, in centesimi, quando restano `parti` persone
 * da pagare. Arrotondata al centesimo; l'ultima parte e' sempre tutto il
 * resto, cosi' i centesimi di arrotondamento non restano mai scoperti.
 */
export function parteUguale(resto: number, parti: number): number {
  const r = Math.max(0, Math.round(resto));
  const p = Math.floor(parti);
  if (!(p > 1)) return r;
  return Math.min(r, Math.round(r / p));
}
