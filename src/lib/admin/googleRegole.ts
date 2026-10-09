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
  return { ultimi, diff: scarto(ultimi, prima) };
}

/**
 * LA VARIAZIONE PERCENTUALE fra due periodi, o `null` quando non si puo' dire.
 *
 * ⚠️ `null` SE PRIMA ERA ZERO, e non «+100 %»: da zero non esiste un aumento
 * percentuale — da una visita a due si sale del cento per cento come da mille
 * a duemila, e la prima non vuol dire niente. La colonna scrive un trattino.
 *
 * ⚠️ Sta qui, e la colonna «Visibilité» la importa da questo file: era la
 * stessa riga di aritmetica, con la stessa trappola dello zero, e due copie si
 * dividono alla prima volta che qualcuno «sistema» una delle due.
 */
export function scarto(ora: unknown, prima: unknown): number | null {
  const a = Number(ora), b = Number(prima);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return Math.round(((a - b) / b) * 100);
}

/**
 * UN PLACE ID E' SCRITTO BENE?
 *
 * ⚠️ La stessa regola per i DUE posti che lo scrivono: la scheda di una sede
 * (`locations.ts`) e l'installazione a sede unica (`integrations.ts`). Erano
 * due regex uguali in due file, e due regex uguali sono due regex finche'
 * qualcuno non tocca la prima.
 *
 * Tre risposte e non un sì/no, perche' i due rifiuti si riparano in modi
 * diversi:
 *   "chiave"  — e' una chiave API Google (AIza…), incollata al posto del
 *               Place ID. E' L'ERRORE TIPICO, e vale la pena dirlo con
 *               precisione: la chiave va nel `.env`, non qui.
 *   "formato" — non e' fatto come un Place ID (`ChIJ…`: lettere, cifre,
 *               trattino e underscore).
 *   "ok"      — va bene. Il vuoto e' «ok»: vuol dire «togli», ed e' una cosa
 *               che si deve poter fare.
 */
export type EsitoPlaceId = "ok" | "chiave" | "formato";
export function controllaPlaceId(v: unknown): EsitoPlaceId {
  const s = String(v ?? "").trim();
  if (!s) return "ok";
  if (/^AIza/.test(s)) return "chiave";
  return /^[A-Za-z0-9_-]+$/.test(s) ? "ok" : "formato";
}
