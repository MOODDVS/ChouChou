/**
 * LA LAVAGNETTA — le regole della colonna «Notes», in un posto solo.
 *
 * Qui dentro c'e' tutto quello che la colonna CHIEDE alle note: quali sono in
 * ritardo, quali mostra il filtro, quali etichette esistono, il conto del
 * mese, chi ne chiude di piu', e quali sei finiscono nella mail del mattino.
 *
 * ⚠️ PERCHE' FUORI DALLA PAGINA. Erano ottocento righe dentro un `<script>` di
 * `admin/index.astro`: nessuna si poteva provare senza un browser, e sono
 * conti che sbagliano in silenzio — un mese che comincia due ore prima, una
 * nota che aspetta da un giorno e dice zero, una classifica che conta chi non
 * ha chiuso niente. Nessuno di questi fa comparire un errore: fanno comparire
 * un numero, e un numero sbagliato si crede.
 *
 * ⚠️ NESSUN IMPORT: `db.ts` lancia all'import senza le variabili di Supabase e
 * in vitest mancano — un file di prova che ci arrivi non parte, e vitest lo
 * conta come «0 test» (ENGINE.md).
 */

/* ⚠️ L'unico import, e di proposito: l'aritmetica delle chiavi-giorno sta in
   `lib/giorni.ts`, che e' puro quanto questo file. ⚠️ `giorniPassati` e NON
   `giorniTra` di `giorniSpecialiRegole`: quella conta la DURATA di una
   chiusura (dal 3 al 5 = tre giorni), qui serve la distanza (due). */
import { giorniPassati } from "../giorni";

export interface RigaNota {
  content?: string | null;
  tags?: unknown;
  done?: boolean | null;
  done_by?: string | null;
  created_at?: string | null;
  due_at?: string | null;
}

/**
 * Le etichette di una nota, pulite.
 *
 * ⚠️ `tags` arriva dal database e puo' essere `null`, o non un elenco: una
 * nota con le etichette rotte deve comparire SENZA etichette, non far cadere
 * il disegno di tutta la colonna.
 *
 * ⚠️ I buchi si tolgono PRIMA di scriverli: `String(null)` fa «null», che e'
 * una parola come un'altra — un elenco `["x", null]` disegnava una pastiglia
 * con scritto «null», e `.filter(Boolean)` dopo non la vedeva piu'.
 */
export function tagDi(n: RigaNota | null | undefined): string[] {
  if (!Array.isArray(n?.tags)) return [];
  return n!.tags
    .filter((x) => x !== null && x !== undefined && x !== false)
    .map((x) => String(x).trim())
    .filter(Boolean);
}

/**
 * IN RITARDO.
 *
 * ⚠️ Solo per le note DA FARE: «en retard» su una nota gia' spuntata e' un
 * rimprovero per un lavoro finito.
 *
 * ⚠️ `adesso` si passa da fuori — e' un istante, non «l'ora del browser letta
 * qui dentro»: cosi' la regola si puo' provare, e la mail del mattino (che
 * gira sul server) e la colonna usano la stessa.
 */
export function inRitardo(n: RigaNota | null | undefined, adesso: number): boolean {
  if (!n?.due_at || n.done) return false;
  const t = new Date(String(n.due_at)).getTime();
  // Una data illeggibile non e' un ritardo: scriverlo in rosso vorrebbe dire
  // mandare qualcuno a cercare una scadenza che non esiste.
  return Number.isFinite(t) && t < adesso;
}

/** Le note DA FARE. */
export function daFare<T extends RigaNota>(note: T[] | null | undefined): T[] {
  return (note ?? []).filter((n) => !n?.done);
}

/** Le etichette presenti nelle note, nell'ordine in cui compaiono e senza
 *  doppioni (confronto senza maiuscole: «Fornitore» e «fornitore» sono la
 *  stessa pastiglia, e due pastiglie uguali sono due filtri che fanno la
 *  stessa cosa). */
export function etichette(note: RigaNota[] | null | undefined): string[] {
  const visti = new Map<string, string>();
  for (const n of note ?? []) {
    for (const x of tagDi(n)) {
      if (!visti.has(x.toLowerCase())) visti.set(x.toLowerCase(), x);
    }
  }
  return [...visti.values()];
}

/** Le note con un'etichetta. Filtro vuoto = tutte. */
export function conEtichetta<T extends RigaNota>(note: T[] | null | undefined, filtro: string): T[] {
  const f = String(filtro ?? "").trim().toLowerCase();
  if (!f) return (note ?? []).slice();
  return (note ?? []).filter((n) => tagDi(n).some((t) => t.toLowerCase() === f));
}

/** Il filtro resta valido? ⚠️ Se l'ultima nota con quell'etichetta se ne va —
 *  spuntata, cancellata — il filtro resterebbe accesso su una parola che non
 *  esiste piu', e la colonna direbbe «niente da mostrare» senza che si capisca
 *  perche'. */
export function filtroValido(note: RigaNota[] | null | undefined, filtro: string): string {
  const f = String(filtro ?? "").trim();
  if (!f) return "";
  return etichette(note).some((x) => x.toLowerCase() === f.toLowerCase()) ? f : "";
}

/**
 * IL CONTO DEL MESE: quante fatte su quante.
 *
 * ⚠️ IL GUASTO. Il primo del mese si calcolava nel fuso del LOCALE («il mese
 * comincia a Bruxelles, non nel fuso di chi guarda») e poi si confrontava col
 * `created_at` GREZZO, che e' un istante UTC: una nota scritta il primo
 * ottobre all'una di notte a Bruxelles e' `2026-09-30T23:00:00Z`, sta prima
 * di «2026-10-01» per lettere, e cadeva nel mese sbagliato. La correzione era
 * a meta': si passa la CHIAVE-GIORNO della nota, calcolata nello stesso fuso
 * del confine.
 */
export function contoDelMese(
  note: RigaNota[] | null | undefined,
  inizioMese: string,
  chiaveDi: (iso: string) => string,
): { fatte: number; totali: number } {
  const delMese = (note ?? []).filter(
    (n) => n?.created_at && chiaveDi(String(n.created_at)) >= inizioMese,
  );
  return { fatte: delMese.filter((n) => !!n.done).length, totali: delMese.length };
}

/**
 * CHI NE CHIUDE DI PIU', nel mese: le prime tre.
 *
 * ⚠️ Si conta `done_by` — chi ha SPUNTATO — e non `author`, che e' chi ha
 * scritto la nota e quasi sempre e' un'altra persona.
 * ⚠️ Una nota spuntata senza nome non entra: una riga «senza nome · 7» in una
 * classifica di squadra si legge come una persona.
 */
export function chiLeFa(
  note: RigaNota[] | null | undefined,
  inizioMese: string,
  chiaveDi: (iso: string) => string,
): { chi: string; quante: number }[] {
  const conta = new Map<string, number>();
  for (const n of note ?? []) {
    if (!n?.done || !n.created_at || chiaveDi(String(n.created_at)) < inizioMese) continue;
    const chi = String(n.done_by ?? "").trim();
    if (chi) conta.set(chi, (conta.get(chi) ?? 0) + 1);
  }
  return [...conta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([chi, quante]) => ({ chi, quante }));
}

/**
 * DA QUANTI GIORNI ASPETTA LA PIU' VECCHIA, o `null`.
 *
 * ⚠️ GIORNI DI CALENDARIO, nel fuso del locale, e non fette di ventiquattro
 * ore: con la sottrazione dei millisecondi una nota scritta ieri alle 23
 * diceva «0 giorni» fino alle 23 di oggi — cioe' per tutta la giornata in cui
 * qualcuno doveva accorgersene.
 *
 * ⚠️ `null` sotto un giorno: «la piu' vecchia da 0 giorni» non e'
 * un'informazione, e' una riga che occupa posto per dire che va tutto bene.
 */
export function attesaPiuVecchia(
  note: RigaNota[] | null | undefined,
  oggi: string,
  chiaveDi: (iso: string) => string,
): number | null {
  const chiavi = daFare(note)
    .map((n) => (n?.created_at ? chiaveDi(String(n.created_at)) : ""))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
  if (!chiavi.length) return null;
  const g = giorniPassati(chiavi[0], oggi);
  return g >= 1 ? g : null;
}

/**
 * LE NOTE DELLA MAIL DEL MATTINO: quali, e in che ordine.
 *
 * ⚠️ IL GUASTO. La mail prendeva «le ultime sei note aperte», ordinate dalla
 * piu' NUOVA: le note in ritardo sono per definizione le piu' vecchie, quindi
 * erano esattamente quelle che non comparivano mai. Il ristoratore legge
 * quella mail a colazione, ed e' l'unico momento della giornata in cui
 * guarderebbe la lavagnetta prima di aprire il pannello.
 *
 * L'ordine: prima le scadute (dalla piu' vecchia), poi quelle con una scadenza
 * davanti (dalla piu' vicina), poi le altre dalla piu' recente.
 *
 * ⚠️ La COLONNA non si riordina: li' l'ordine e' quello del database — le
 * aperte dalla piu' nuova, le fatte in fondo — ed e' giusto che resti uno
 * solo, altrimenti una nota appena scritta compare in un punto che non e'
 * quello dove la si aspetta. Questa funzione non cambia un ordine: SCEGLIE
 * sei note fra tante, e scegliere le piu' nuove voleva dire scegliere quelle
 * di cui non c'era niente da dire.
 */
export function perLaMail<T extends RigaNota>(
  note: T[] | null | undefined,
  adesso: number,
  quante = 6,
): T[] {
  const aperte = daFare(note);
  const ms = (n: RigaNota): number => {
    const t = n?.due_at ? new Date(String(n.due_at)).getTime() : NaN;
    return Number.isFinite(t) ? t : NaN;
  };
  const rango = (n: T): number => (inRitardo(n, adesso) ? 0 : Number.isFinite(ms(n)) ? 1 : 2);
  return aperte
    .slice()
    .sort((a, b) => {
      const ra = rango(a), rb = rango(b);
      if (ra !== rb) return ra - rb;
      if (ra === 2) return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
      return ms(a) - ms(b);
    })
    .slice(0, Math.max(0, quante));
}
