/**
 * I QR DELLA SALA — che link ci va dentro, e quali si stampano.
 *
 * Tre generi di QR, che funzionano TUTTI, sempre e insieme:
 *   · unico    — uguale su tutti i tavoli: si sceglie il tavolo in pagina.
 *   · sezione  — uno per sezione (sala, terrazza, 1° piano): la griglia
 *                mostra solo i tavoli di quella sezione.
 *   · tavolo   — uno per tavolo: il tavolo parte gia' scelto (e si puo'
 *                cambiare, se ci si e' seduti altrove).
 *
 * ⚠️ LA SCELTA (`orders_table_qr_sel`) DICE SOLO QUALI CARTONCINI SI
 * VEDONO E SI STAMPANO in Assets › QR codes. Non spegne niente: un QR gia'
 * stampato e tolto dalla scelta continua ad aprire la sua pagina.
 *
 * ⚠️ IL LINK LO SCRIVE IL SERVER, sempre a partire dal link della sede
 * (`link_tavolo`, con `?sede=` gia' dentro). Qui si aggiunge solo il pezzo
 * di sezione o di tavolo, con l'URL vero e non incollando stringhe: un nome
 * di sezione con uno spazio o una «é» deve arrivare intero alla pagina.
 */

export type GenereQr = "unico" | "sezione" | "tavolo";

/** Le sezioni (per NOME) e i tavoli (per ID) scelti nei Réglages. */
export type SceltaQr = { sezioni: string[]; tavoli: string[] };

/** Oltre, la scelta e' un errore o un attacco: nessuna sala ha 500 tavoli. */
export const MAX_SCELTA_QR = 500;

function elenco(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const visti: string[] = [];
  for (const x of v) {
    const k = typeof x === "string" ? x.trim().slice(0, 120) : "";
    if (k && !visti.includes(k)) visti.push(k);
    if (visti.length >= MAX_SCELTA_QR) break;
  }
  return visti;
}

/** La scelta, da quello che arriva (JSON salvato o corpo della richiesta).
 *  Illeggibile → vuota: si vede solo il QR unico, che c'e' sempre. */
export function sceltaQr(valore: unknown): SceltaQr {
  let v: unknown = valore;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { sezioni: elenco(o.sezioni), tavoli: elenco(o.tavoli) };
}

/** La scelta come si salva in `app_config`. */
export function sceltaQrDaSalvare(valore: unknown): string {
  return JSON.stringify(sceltaQr(valore));
}

/**
 * I cartoncini di Assets: il QR unico SEMPRE, poi le sezioni scelte, poi i
 * tavoli scelti, nell'ordine della sala.
 *
 * ⚠️ Si filtra sui tavoli VERI del piano: una sezione rinominata o un tavolo
 * cancellato dopo la scelta non producono un cartoncino verso il niente.
 * ⚠️ Senza scelta del tavolo (`conTavoli` falso: sala senza piano, o scelta
 * spenta) c'e' solo l'unico: un cartoncino «Table 7» porterebbe a una pagina
 * che il tavolo non lo chiede.
 */
export function cartonciniScelti(
  base: string,
  tavoli: { id: string; name: string; zone: string }[],
  scelta: SceltaQr,
  conTavoli: boolean,
): { genere: GenereQr; titolo: string; sotto: string; link: string }[] {
  const unico = { genere: "unico" as const, titolo: "", sotto: "", link: base };
  if (!conTavoli) return [unico];
  const sez = new Set(scelta.sezioni);
  const tav = new Set(scelta.tavoli);
  return [
    unico,
    ...sezioniConTavoli(tavoli)
      .filter((z) => sez.has(z))
      .map((z) => ({ genere: "sezione" as const, titolo: z, sotto: "", link: linkSezione(base, z) })),
    ...tavoli
      .filter((t) => tav.has(t.id))
      .map((t) => ({ genere: "tavolo" as const, titolo: t.name, sotto: t.zone, link: linkTavolo(base, t.id) })),
  ];
}

/** Il parametro della sezione nella pagina `/table`. */
export const PARAM_ZONA = "zone";
/** Il parametro del tavolo (gia' letto dalla pagina: `?table=`). */
export const PARAM_TAVOLO = "table";

function conParametro(base: string, chiave: string, valore: string): string {
  try {
    const u = new URL(base);
    u.searchParams.set(chiave, valore);
    return u.toString();
  } catch {
    // Base non assoluta (non dovrebbe succedere: la scrive il server).
    return `${base}${base.includes("?") ? "&" : "?"}${chiave}=${encodeURIComponent(valore)}`;
  }
}

/** Il link del QR di una sezione. */
export function linkSezione(base: string, zona: string): string {
  return conParametro(base, PARAM_ZONA, zona);
}

/** Il link del QR di un tavolo.
 *  ⚠️ L'ID, non il nome: due sezioni possono avere tutte e due un «3», e un
 *  tavolo rinominato domani lascerebbe il cartoncino stampato senza tavolo.
 *  Il QR non lo legge una persona, lo legge il telefono. */
export function linkTavolo(base: string, idTavolo: string): string {
  return conParametro(base, PARAM_TAVOLO, idTavolo);
}

/**
 * I tavoli che la pagina mostra, dato il `?zone=` del QR.
 *
 * ⚠️ Una sezione che non esiste piu' (rinominata, cancellata) NON svuota la
 * griglia: il cartoncino e' ancora sul tavolo, e un cliente davanti a una
 * griglia vuota non puo' ordinare. Si mostrano tutti i tavoli, come col QR
 * unico — meglio scegliere fra troppi che fra nessuno.
 */
export function tavoliDellaZona<T extends { zone: string }>(tavoli: T[], zona: string): T[] {
  const z = zona.trim();
  if (!z) return tavoli;
  const della = tavoli.filter((t) => t.zone === z);
  return della.length > 0 ? della : tavoli;
}

/** Le sezioni che hanno almeno un tavolo, nell'ordine della sala. */
export function sezioniConTavoli(tavoli: { zone: string }[]): string[] {
  const viste: string[] = [];
  for (const t of tavoli) if (t.zone && !viste.includes(t.zone)) viste.push(t.zone);
  return viste;
}
