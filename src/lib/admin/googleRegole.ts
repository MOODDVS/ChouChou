/**
 * LA SCHEDA GOOGLE — le poche regole che due schermi devono leggere uguale.
 *
 * Le stelle del voto e i tre numeri della scheda si disegnano in due posti: la
 * colonna «Aujourd'hui» della Accueil e la pagina Google. Erano scritti due
 * volte, e NON davano lo stesso risultato: la Accueil arrotondava (4,7 → cinque
 * stelle piene) e la pagina Google troncava (4,7 → quattro). Lo stesso locale,
 * due giudizi diversi a due clic di distanza.
 *
 * ⚠️ NESSUN IMPORT: `db.ts` lancia all'import senza le variabili di Supabase e
 * in vitest mancano — un file di prova che ci arrivi non parte, e vitest lo
 * conta come «0 test».
 */

/** Quante stelle piene per un voto. Arrotonda: 4,4 → 4, 4,5 → 5. */
export function stellePiene(nota: unknown): number {
  const n = Number(nota);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

/** Le cinque stelle come testo: «★★★★☆». */
export function stelle(nota: unknown): string {
  const p = stellePiene(nota);
  return "★".repeat(p) + "☆".repeat(5 - p);
}

/**
 * DOVE PORTA «Tutte le recensioni».
 *
 * ⚠️ `null` quando non si sa, e chi chiama NASCONDE il link invece di
 * scrivere `href="#"`. Un link che non porta da nessuna parte si clicca una
 * volta, non succede niente, e da li' in poi non si clicca piu' nemmeno
 * quando funziona.
 */
export function linkRecensioni(g: { reviews_url?: string | null; maps_url?: string | null } | null | undefined): string | null {
  const u = String(g?.reviews_url ?? "").trim() || String(g?.maps_url ?? "").trim();
  return u || null;
}

export interface Punto { date: string; value: number }

export interface Variazione {
  /** La somma degli ultimi `giorni` giorni. */
  ultimi: number;
  /** La variazione in percentuale sul periodo precedente, o `null` quando non
   *  si puo' dire. */
  diff: number | null;
}

/**
 * I numeri della scheda: quanto negli ultimi 30 giorni, e come va rispetto ai
 * 30 di prima.
 *
 * ⚠️ IL CONFRONTO VUOLE DUE PERIODI INTERI. Qui si sommavano «gli ultimi 30
 * punti» e «i 30 prima», qualunque cosa fosse arrivata: con 40 giorni di
 * storia, il secondo periodo erano 10 giorni — e il pannello scriveva «+180 %»
 * perche' confrontava un mese con una settimana e mezza. Un numero inventato
 * con l'aria di un numero vero. Senza due periodi pieni, `diff` resta `null` e
 * la riga sotto il numero resta vuota.
 *
 * ⚠️ I punti si ordinano per data qui dentro: l'ordine con cui arrivano non e'
 * garantito, e sommare «gli ultimi trenta» di una lista disordinata vuol dire
 * sommare trenta giorni a caso.
 */
export function variazione(punti: Punto[] | null | undefined, giorni = 30): Variazione | null {
  const p = (punti ?? [])
    .filter((x) => x && typeof x.date === "string")
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!p.length) return null;
  const somma = (da: number, a: number) =>
    p.slice(Math.max(0, da), Math.max(0, a)).reduce((acc, x) => acc + (Number(x.value) || 0), 0);
  const ultimi = somma(p.length - giorni, p.length);
  if (p.length < giorni * 2) return { ultimi, diff: null };
  const prima = somma(p.length - giorni * 2, p.length - giorni);
  if (prima <= 0) return { ultimi, diff: null };
  return { ultimi, diff: Math.round(((ultimi - prima) / prima) * 100) };
}
