/**
 * IL MENU, QUELLO CHE SERVE SAPERE OGGI.
 *
 * Due domande, e nessuna delle due e' «com'e' fatto il menu» (quella ha la sua
 * pagina, con novanta righe che in una colonna non si leggono):
 *   - che cosa NON posso vendere adesso — gli esauriti e i nascosti;
 *   - quanto e' grande il menu, e quanti piatti sono senza foto.
 *
 * ⚠️ ESAURITO E NASCOSTO NON SONO LA STESSA COSA, e la colonna non puo'
 * confonderli: un piatto ESAURITO e' ancora sul sito — il cliente lo vede,
 * barrato, e stasera torna in vendita — mentre un piatto NASCOSTO dal sito non
 * c'e' proprio, e ci resta finche' qualcuno non lo rimette. Il primo e' il
 * lavoro di oggi, il secondo una decisione.
 *
 * ⚠️ NESSUN IMPORT: `db.ts` lancia all'import senza le variabili di Supabase e
 * in vitest mancano — un file di prova che ci arrivi non parte, e vitest lo
 * conta come «0 test» (ENGINE.md).
 */

export interface VarianteMenu {
  key?: string | null;
  label_i18n?: Record<string, string> | null;
  sold_out?: boolean | null;
}

export interface RigaMenu {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  price_cents?: number | null;
  image_url?: string | null;
  /** `false` = fuori dal sito. */
  available?: boolean | null;
  /** `true` = finito per oggi, ma ancora a menu. */
  sold_out?: boolean | null;
  variants?: VarianteMenu[] | null;
}

/** Lo stato di una riga nella colonna. `null` = e' in vendita, non si mostra. */
export type StatoPiatto = "sold" | "hidden";

/**
 * Lo stato da mostrare.
 *
 * ⚠️ «NASCOSTO» VINCE: un piatto fuori dal sito e segnato esaurito e' prima di
 * tutto fuori dal sito — dire «esaurito» di una cosa che nessuno puo' vedere
 * manda a cercare in cucina un problema che sta nel pannello.
 */
export function statoPiatto(r: RigaMenu | null | undefined): StatoPiatto | null {
  if (!r) return null;
  if (r.available === false) return "hidden";
  if (r.sold_out === true) return "sold";
  return null;
}

/**
 * CHE COSA E' FUORI, in ordine: prima gli esauriti, poi i nascosti.
 *
 * ⚠️ Gli esauriti in cima perche' sono il lavoro di stasera: il sito li mostra
 * ancora, e un interruttore li rimette in vendita. I nascosti possono restare
 * tali per mesi (il menu di Natale a luglio) e in cima sarebbero rumore fisso.
 * A parita' di stato, l'ordine e' quello del menu — categoria e posizione —
 * cosi' la colonna si legge come la carta.
 */
export function fuori<T extends RigaMenu>(items: T[] | null | undefined): T[] {
  const righe = (items ?? []).filter((r) => statoPiatto(r) !== null);
  return righe.sort((a, b) => {
    const sa = statoPiatto(a) === "sold" ? 0 : 1;
    const sb = statoPiatto(b) === "sold" ? 0 : 1;
    return sa - sb;
  });
}

/** Le righe di un solo stato: e' il filtro della colonna. */
export function conStato<T extends RigaMenu>(
  items: T[] | null | undefined,
  filtro: StatoPiatto | "",
): T[] {
  const righe = fuori(items);
  return filtro ? righe.filter((r) => statoPiatto(r) === filtro) : righe;
}

/**
 * I FORMATI FINITI di un piatto: «40 cm», oppure «40 cm +2».
 *
 * ⚠️ IL GUASTO CHE QUESTA REGOLA CHIUDE (gia' chiuso nella pagina Menu, e qui
 * non si riscrive). Con «40 cm» finita e «30 cm» disponibile il piatto sembra
 * a posto: l'interruttore «Esaurito» e' quello del piatto INTERO ed e' spento,
 * e l'unico modo di accorgersene era aprire il modale. Il nome del formato si
 * dice: «un formato su due» non basta a sapere quale non si puo' vendere.
 *
 * `lingua` e' la lingua pubblica del sito; se quell'etichetta manca si prende
 * la prima che c'e', e in ultimo la chiave — mai una stringa vuota, che in una
 * pastiglia diventa un rettangolo senza spiegazione.
 */
export function formatiFiniti(r: RigaMenu | null | undefined, lingua: string): string[] {
  return (r?.variants ?? [])
    .filter((v) => v && v.sold_out === true)
    .map((v) => {
      const et = v.label_i18n ?? {};
      return String(et[lingua] || Object.values(et)[0] || v.key || "").trim();
    })
    .filter(Boolean);
}

/** L'etichetta corta dei formati finiti, o `null` se non ce ne sono. */
export function etichettaFormati(r: RigaMenu | null | undefined, lingua: string): string | null {
  const n = formatiFiniti(r, lingua);
  if (!n.length) return null;
  return n.length === 1 ? n[0] : `${n[0]} +${n.length - 1}`;
}

export interface ContiMenu {
  piatti: number;
  bevande: number;
  catPiatti: number;
  catBevande: number;
  /** Quanti piatti non hanno una foto, e su quanti in tutto. */
  senzaFoto: number;
  totale: number;
}

/**
 * I NUMERI DEL PIEDE.
 *
 * ⚠️ Una categoria che non esiste nell'elenco delle categorie conta come
 * CIBO, non si butta via: una riga senza categoria e' un piatto che qualcuno
 * ha scritto, e sparire dal conto vorrebbe dire un menu piu' piccolo di
 * quello che e' — senza che niente lo dica.
 *
 * ⚠️ «Senza foto» guarda `image_url` e basta: una stringa vuota o fatta di
 * spazi e' una foto che non c'e'. Il sito, al suo posto, mostra un rettangolo
 * grigio.
 */
export function conti(
  items: RigaMenu[] | null | undefined,
  kindDi: (categoria: string) => string | undefined,
): ContiMenu {
  const righe = items ?? [];
  const catP = new Set<string>();
  const catB = new Set<string>();
  let piatti = 0, bevande = 0, senzaFoto = 0;
  for (const r of righe) {
    const cat = String(r?.category ?? "");
    if (kindDi(cat) === "drink") { bevande++; if (cat) catB.add(cat); }
    else { piatti++; if (cat) catP.add(cat); }
    if (!String(r?.image_url ?? "").trim()) senzaFoto++;
  }
  return {
    piatti, bevande,
    catPiatti: catP.size, catBevande: catB.size,
    senzaFoto, totale: righe.length,
  };
}
