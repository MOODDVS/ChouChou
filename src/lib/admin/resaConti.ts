/**
 * I CONTI DELLE PRENOTAZIONI — una definizione, tutti gli schermi.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE: «coperti» voleva dire tre cose diverse
 * in tre posti.
 *   - La colonna della Accueil e la pastiglia della pagina Réservations
 *     contavano `confirmed + seated`. Ma una prenotazione si chiude DA SOLA
 *     venti minuti dopo la fine del tavolo (l'auto-Fini di
 *     `caricaResaGiorno`), quindi quel numero CALA durante la serata: a
 *     mezzanotte diceva «0 coperti» per un servizio pieno, e per un giorno
 *     passato diceva sempre zero.
 *   - L'email del mattino contava `done`, cioe' i coperti SERVITI: per la
 *     stessa sera scriveva «40 coperti serviti» mentre la Accueil, un'ora
 *     prima, ne mostrava zero.
 * Nessuno dei due si accorge dell'altro: sono due schermi che non si guardano
 * mai insieme, ed e' per questo che e' durato.
 *
 * ⚠️ NESSUN IMPORT: `db.ts` lancia all'import senza le variabili di Supabase e
 * in vitest mancano — un file di prova che ci arrivi non parte, e vitest lo
 * conta come «0 test» (ENGINE.md).
 */

export interface RigaConto {
  status?: string | null;
  people?: number | null;
}

const sommaPersone = (rese: RigaConto[]): number =>
  rese.reduce((s, r) => s + (Number(r?.people) || 0), 0);

/** GLI STATI CHE CONTANO per la giornata. ⚠️ `done` compreso: e' lo stato in
 *  cui finisce ogni tavolo della sera, da solo (l'auto-Fini). */
const STATI_GIORNO = ["confirmed", "seated", "done"];

/** Una riga CHIUSA: finita, annullata, non presentatasi. */
const chiusa = (r: RigaConto): boolean => {
  const s = String(r?.status ?? "");
  return s === "done" || s === "noshow" || s === "cancelled";
};

/**
 * LE RIGHE della giornata: quelle che contano nei suoi numeri.
 *
 * ⚠️ Esiste perche' il numero e il suo conteggio devono venire dalla STESSA
 * selezione: la pastiglia «40 coperti · 12 prenotazioni» li prendeva da due
 * filtri scritti a mano uno accanto all'altro, e bastava cambiarne uno.
 */
export function righeDelGiorno<T extends RigaConto>(rese: T[] | null | undefined): T[] {
  return (rese ?? []).filter((r) => STATI_GIORNO.includes(String(r?.status ?? "")));
}

/**
 * I COPERTI DELLA GIORNATA: quelli che sono venuti e quelli che verranno.
 *
 * `confirmed` + `seated` + `done`. Fuori restano le annullate, i no-show (non
 * sono venuti) e le richieste ancora da confermare (non sono un impegno: hanno
 * il loro numero).
 *
 * ⚠️ `done` DENTRO, ed e' tutto il punto: e' lo stato in cui finisce ogni
 * tavolo della sera, da solo. Senza, il numero della giornata si svuota mentre
 * la giornata va avanti.
 */
export function copertiDelGiorno(rese: RigaConto[] | null | undefined): number {
  return sommaPersone(righeDelGiorno(rese));
}

/** I coperti ANCORA DA SERVIRE: quelli che devono arrivare o sono a tavola.
 *  E' un'altra domanda — «quanta gente ho ancora stasera» — e ha un nome suo
 *  perche' non e' la giornata. */
export function copertiAttesi(rese: RigaConto[] | null | undefined): number {
  return sommaPersone(
    (rese ?? []).filter((r) => {
      const s = String(r?.status ?? "");
      return s === "confirmed" || s === "seated";
    }),
  );
}

/** Le richieste ancora da confermare. */
export function daConfermare(rese: RigaConto[] | null | undefined): number {
  return (rese ?? []).filter((r) => String(r?.status ?? "") === "pending").length;
}

/**
 * Le righe che restano da fare: tutto cio' che non e' finito, annullato o
 * mancato. ⚠️ Un tavolo finito non e' piu' lavoro: esce dall'elenco e resta
 * nei numeri.
 */
export function daFare<T extends RigaConto>(rese: T[] | null | undefined): T[] {
  return (rese ?? []).filter((r) => !chiusa(r));
}

/**
 * Le righe CHIUSE: finite, annullate, non presentatesi. E' il complemento
 * esatto di `daFare`, e per questo sta qui: i due elenchi stavano scritti a
 * mano in due filtri gemelli («!== confirmed && !== seated && !== pending»),
 * e uno stato nuovo — o solo scritto male — non entrava ne' nell'uno ne'
 * nell'altro: la riga spariva da entrambe le liste senza un errore.
 */
export function fatte<T extends RigaConto>(rese: T[] | null | undefined): T[] {
  return (rese ?? []).filter((r) => chiusa(r));
}


/**
 * Il riempimento in percentuale, oppure `null` quando non si puo' dire.
 *
 * ⚠️ `null` senza capienza, e non «0 %»: una percentuale calcolata su zero
 * posti e' un numero inventato che ha l'aria di un numero vero. Chi non ha
 * disegnato la sala non ha una capienza, e la riga resta un trattino.
 *
 * ⚠️ Puo' superare il 100: con due servizi la stessa sala si riempie due
 * volte, e «140 %» vuol dire che ha girato. Tagliarlo a 100 nasconderebbe
 * proprio le giornate buone.
 */
export function riempimento(coperti: number, capienza: number): number | null {
  if (!Number.isFinite(capienza) || capienza <= 0) return null;
  return Math.round((Math.max(0, coperti) / capienza) * 100);
}
