/**
 * LA CONSEGNA — regole pure (nessun import, si prova in vitest).
 *
 * Réglages → Cuisine → Commandes en ligne → «Livraison»
 * (`orders_delivery`, chiave di sede, SPENTA di ripiego). Accesa, il cliente
 * sceglie al checkout fra ritiro e consegna; il ritiro resta SEMPRE possibile.
 *
 * ⚠️ Qui ci sono solo la forma dell'indirizzo e come si scrive. Spesa minima,
 * zone (codici postali), costo e mance sono passi successivi: quando
 * arriveranno leggeranno `cap` da solo, ed e' per questo che l'indirizzo e'
 * un oggetto e non una riga di testo (migrazione #84).
 */

export interface IndirizzoConsegna {
  via: string;
  numero: string;
  /** La «boîte» (bte / bus), facoltativa. */
  box: string;
  cap: string;
  comune: string;
  /** Per il fattorino: piano, campanello, codice del portone. Facoltativa. */
  note: string;
}

/** Le misure massime. ⚠️ Non sono estetica: tutto questo finisce su un
 *  ticket da 24 colonne e in un'email — un «numero» da 400 caratteri e' un
 *  modo di riempire la comanda di qualcun altro. */
const MAX = { via: 120, numero: 12, box: 12, cap: 10, comune: 80, note: 300 } as const;

/** Un codice postale plausibile: cifre e lettere, 3–10 caratteri. ⚠️ Non solo
 *  i quattro numeri belgi: il motore serve anche Zurigo, Londra e Dubai. */
const CAP_VALIDO = /^[0-9A-Za-z][0-9A-Za-z -]{2,9}$/;

const pulisci = (v: unknown, max: number): string =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * L'indirizzo arrivato dal browser, ripulito — oppure `null` se manca
 * qualcosa di obbligatorio (via, numero, codice postale, comune).
 * ⚠️ `null` e non un indirizzo a meta': il fattorino con «Rue de la Loi, 1040»
 * e senza numero suona a tutto il palazzo, o torna indietro.
 */
export function indirizzoDaRichiesta(raw: unknown): IndirizzoConsegna | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ind: IndirizzoConsegna = {
    via: pulisci(r.via, MAX.via),
    numero: pulisci(r.numero, MAX.numero),
    box: pulisci(r.box, MAX.box),
    cap: pulisci(r.cap, MAX.cap).toUpperCase(),
    comune: pulisci(r.comune, MAX.comune),
    note: pulisci(r.note, MAX.note),
  };
  if (!ind.via || !ind.numero || !ind.comune || !CAP_VALIDO.test(ind.cap)) return null;
  return ind;
}

/** L'indirizzo salvato sull'ordine (jsonb), riletto. Riga vecchia, colonna
 *  assente o JSON storto → `null`, cioe' «non e' una consegna». */
export function indirizzoDaRiga(raw: unknown): IndirizzoConsegna | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return indirizzoDaRichiesta(v);
}

/**
 * L'indirizzo in UNA riga: «Rue de la Loi 16/3, 1000 Bruxelles».
 * ⚠️ La boîte con la barra e non con «bte»: la comanda la legge chi parla
 * francese, olandese o italiano, e «12/3» si capisce in tutte le lingue.
 */
export function rigaIndirizzo(ind: IndirizzoConsegna): string {
  const civico = ind.box ? `${ind.numero}/${ind.box}` : ind.numero;
  return `${ind.via} ${civico}, ${ind.cap} ${ind.comune}`;
}

/** Il link che apre l'indirizzo su una mappa (Google Maps lo apre anche
 *  l'app sul telefono). Nessuna chiave, nessun servizio da pagare. */
export function linkMappa(ind: IndirizzoConsegna): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rigaIndirizzo(ind))}`;
}
