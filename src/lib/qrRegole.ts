/**
 * I QR DELLA SALA — che link ci va dentro, senza database.
 *
 * Tre modi, scelti dal ristoratore nei Réglages (`orders_table_qr_mode`):
 *   · `unico`    — un QR uguale su tutti i tavoli: si sceglie il tavolo in
 *                  pagina. Il piu' semplice da stampare.
 *   · `sezione`  — un QR per sezione (sala, terrazza, 1° piano): la griglia
 *                  mostra solo i tavoli di quella sezione.
 *   · `tavolo`   — un QR per tavolo: il tavolo parte gia' scelto (e si puo'
 *                  cambiare, se ci si e' seduti altrove).
 *
 * ⚠️ IL LINK LO SCRIVE IL SERVER, sempre a partire dal link della sede
 * (`link_tavolo`, con `?sede=` gia' dentro). Qui si aggiunge solo il pezzo
 * di sezione o di tavolo, con l'URL vero e non incollando stringhe: un nome
 * di sezione con uno spazio o una «é» deve arrivare intero alla pagina.
 */

export const MODI_QR = ["unico", "sezione", "tavolo"] as const;
export type ModoQr = (typeof MODI_QR)[number];

/** Il valore salvato, letto come modo. Qualunque altra cosa → `unico`:
 *  e' quello che c'era prima, e i QR gia' stampati restano giusti. */
export function modoQr(valore: unknown): ModoQr {
  const v = String(valore ?? "").trim();
  return (MODI_QR as readonly string[]).includes(v) ? (v as ModoQr) : "unico";
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
