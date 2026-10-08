/**
 * I CONTI DELLE COMMANDES — quanto e' ENTRATO, quanto resta da incassare.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE: «incassato» voleva dire `total_cents`
 * in quattro posti diversi, e in tutti e quattro era SBAGLIATO per gli stessi
 * due motivi.
 *
 *   - UN RIMBORSO NON TORNA INDIETRO. `refunded_cents` esiste dalla
 *     migrazione #41, la pagina Commandes lo mostra in fondo alla card («↩
 *     Remboursé — 24,00 €»), e l'API lo manda nella risposta. Nessuno dei
 *     numeri lo leggeva: un ordine da 60 € rimborsato per intero restava 60 €
 *     di incasso sulla Accueil, nella pastiglia della pagina, nelle
 *     statistiche e nella mail del mattino. Il dato c'era, arrivava, e non
 *     veniva letto — il guasto piu' silenzioso che ci sia.
 *   - UN SUPPLEMENTO DOVUTO NON E' ANCORA ENTRATO. Dalla #50 una modifica al
 *     rialzo alza `total_cents` e segna la differenza in
 *     `supplement_due_cents`: quei soldi sono nel totale ma non nel cassetto.
 *     Contati come incassati, la giornata diceva di aver preso denaro che
 *     qualcuno deve ancora pagare — e il promemoria per andarlo a chiedere
 *     non esisteva da nessuna parte (la pagina ha il bottone, la Accueil non
 *     ne sapeva niente).
 *
 * ⚠️ `refund_due_cents` NON si sottrae: e' un rimborso DECISO e non ancora
 * fatto. Quel denaro e' nel cassetto; usciro' quando esce, e allora lo dira'
 * `refunded_cents`. Sottrarlo adesso vorrebbe dire contarlo due volte.
 *
 * ⚠️ NESSUN IMPORT: `db.ts` lancia all'import senza le variabili di Supabase e
 * in vitest mancano — un file di prova che ci arrivi non parte, e vitest lo
 * conta come «0 test» (ENGINE.md).
 */

export interface RigaOrdine {
  status?: string | null;
  total_cents?: number | null;
  refunded_cents?: number | null;
  supplement_due_cents?: number | null;
  payment_method?: string | null;
}

const num = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** Gli stati in cui del denaro e' entrato: pagato, oppure pagato e ritirato. */
const INCASSATI = ["paid", "done"];

/** Un ordine SPENTO: ritirato o annullato, non c'e' piu' niente da fare. */
const spento = (o: RigaOrdine): boolean => {
  const s = String(o?.status ?? "");
  return s === "done" || s === "cancelled";
};

/** Lo stato di un ordine, o `null` se non lo conosciamo. ⚠️ Chi chiama scrive
 *  la parola grezza: la pastiglia della colonna ricadeva su «Payée» per OGNI
 *  stato ignoto, cioe' scriveva «pagata» su un ordine di cui non sapeva
 *  niente. */
export type StatoOrdine = "pending" | "paid" | "done" | "cancelled";
export function statoOrdine(status: unknown): StatoOrdine | null {
  const s = String(status ?? "");
  return s === "pending" || s === "paid" || s === "done" || s === "cancelled" ? s : null;
}

/**
 * I SOLDI ENTRATI per un ordine: il totale, meno quello che e' stato
 * rimborsato, meno il supplemento che il cliente deve ancora pagare.
 *
 * Mai sotto zero: un rimborso piu' grande del totale (puo' succedere su una
 * riga ritoccata a mano) darebbe un incasso negativo, e la giornata si
 * mangerebbe l'incasso di un altro ordine.
 */
export function entrato(o: RigaOrdine): number {
  return Math.max(0, num(o?.total_cents) - num(o?.refunded_cents) - num(o?.supplement_due_cents));
}

/**
 * I SOLDI TORNATI INDIETRO per un ordine.
 *
 * ⚠️ Esiste perche' `entrato()` li sottrae e poi li DIMENTICA: il totale
 * resta giusto, ma di quanto sia stato rimborsato non resta traccia da nessuna
 * parte: una serata con mille euro incassati e trecento resi si legge uguale a
 * una da settecento senza un rimborso, e sono due serate diverse.
 *
 * Mai sotto zero e mai piu' del totale: una riga ritoccata a mano puo' portare
 * un rimborso piu' grande di quel che e' stato pagato, e un rimborso che
 * supera l'incasso farebbe una percentuale sopra il cento.
 */
export function rimborsato(o: RigaOrdine): number {
  return Math.min(Math.max(0, num(o?.total_cents)), Math.max(0, num(o?.refunded_cents)));
}

/** Gli ordini che hanno reso dei soldi: quelli, e non quante volte. */
export function conRimborso<T extends RigaOrdine>(ordini: T[] | null | undefined): T[] {
  return righeIncassate(ordini).filter((o) => rimborsato(o) > 0);
}

/** I soldi resi nel periodo: la somma, sulle stesse righe dell'incasso. */
export function rimborsi(ordini: RigaOrdine[] | null | undefined): number {
  return righeIncassate(ordini).reduce((s, o) => s + rimborsato(o), 0);
}

/** Le righe che portano denaro: `paid` e `done`. */
export function righeIncassate<T extends RigaOrdine>(ordini: T[] | null | undefined): T[] {
  return (ordini ?? []).filter((o) => INCASSATI.includes(String(o?.status ?? "")));
}

/** L'INCASSO della giornata: i soldi davvero entrati. */
export function incassato(ordini: RigaOrdine[] | null | undefined): number {
  return righeIncassate(ordini).reduce((s, o) => s + entrato(o), 0);
}

/**
 * Il carrello medio, oppure `null` senza nemmeno un ordine incassato.
 *
 * ⚠️ `null` e non zero: «0,00 €» di carrello medio sembra un dato — vuol dire
 * che si e' venduto a prezzo zero — mentre la verita' e' che non si e' ancora
 * venduto niente. La colonna scrive un trattino.
 */
export function panierMedio(ordini: RigaOrdine[] | null | undefined): number | null {
  const righe = righeIncassate(ordini);
  if (!righe.length) return null;
  return Math.round(incassato(righe) / righe.length);
}

export interface RestaDaIncassare {
  /** Centesimi che devono ancora entrare. */
  importo: number;
  /** Quante cose ci sono da incassare (ordini + supplementi). */
  righe: number;
  /** Quelle che si incassano AL BANCO: ordini `onsite` e supplementi dovuti. */
  banco: number;
  /** Quelle che aspettano che il cliente paghi un link. */
  linkPagamento: number;
}

/**
 * QUANTO RESTA DA INCASSARE, e da chi.
 *
 * ⚠️ Due `pending` molto diversi, e la colonna li chiamava tutti «au
 * comptoir»: uno aspetta che il cliente paghi un link (nessuno verra' al
 * banco), l'altro e' un ordine in cucina che si incassa al ritiro. Il conto
 * e' lo stesso, la frase sotto no.
 *
 * ⚠️ I SUPPLEMENTI DOVUTI stanno qui, e prima da nessuna parte: un ordine
 * pagato e poi aumentato lascia una differenza da farsi dare al banco. La
 * pagina Commandes ha il bottone per incassarla; la Accueil non sapeva che
 * esistesse, e a fine serata quella differenza non la chiedeva piu' nessuno.
 */
export function restaDaIncassare(ordini: RigaOrdine[] | null | undefined): RestaDaIncassare {
  const r: RestaDaIncassare = { importo: 0, righe: 0, banco: 0, linkPagamento: 0 };
  for (const o of ordini ?? []) {
    const st = String(o?.status ?? "");
    if (st === "pending") {
      r.importo += num(o?.total_cents);
      r.righe += 1;
      // ⚠️ `onsite` e' «si paga al banco»; tutto il resto, link compreso,
      // aspetta il cliente. Un metodo mancante NON e' il banco: dire «vieni a
      // prendere i soldi» per un pagamento che non arrivera' mai e' peggio che
      // dire «in attesa».
      if (String(o?.payment_method ?? "") === "onsite") r.banco += 1;
      else r.linkPagamento += 1;
      continue;
    }
    if (INCASSATI.includes(st)) {
      const sup = num(o?.supplement_due_cents);
      if (sup > 0) {
        r.importo += sup;
        r.righe += 1;
        r.banco += 1;
      }
    }
  }
  return r;
}

/**
 * Gli ordini che restano DA FARE: tutto quello che non e' ritirato ne'
 * annullato. ⚠️ Uno stato che non conosciamo resta nell'elenco: scritto a mano
 * («!== done») un ordine annullato ci finiva dentro quando la colonna non lo
 * filtrava prima, e uno stato nuovo sarebbe spartito senza un errore.
 */
export function daServire<T extends RigaOrdine>(ordini: T[] | null | undefined): T[] {
  return (ordini ?? []).filter((o) => !spento(o));
}

/**
 * Gli ordini SPENTI: ritirati o annullati. E' il complemento esatto di
 * `daServire`, e per questo sta qui: la pagina Commandes aveva due filtri
 * gemelli scritti a mano («paid || pending» da una parte, «done || cancelled»
 * dall'altra) e una card con uno stato fuori da entrambi non si vedeva ne'
 * sopra ne' sotto — un ordine da preparare che non compariva da nessuna parte,
 * senza un errore.
 */
export function fatti<T extends RigaOrdine>(ordini: T[] | null | undefined): T[] {
  return (ordini ?? []).filter((o) => spento(o));
}

/* ============================================================
   LE RIGHE DI UN ORDINE
   ============================================================ */

export interface VoceOrdine {
  id?: unknown;
  name?: unknown;
  qty?: unknown;
  notes?: unknown;
}

/**
 * I PIATTI VERI di un ordine.
 *
 * ⚠️ IL GUASTO. Dentro `items` c'e' anche una riga finta — `id: "note"`,
 * `qty: 0`, `name: "NOTE CLIENT"` — in cui il checkout mette la nota del
 * cliente. Nove posti la saltavano con un filtro scritto a mano (la card della
 * pagina, le statistiche, le due code di stampa, l'API…); la riga dei piatti
 * della colonna sulla Accueil no, e scriveva «0× NOTE CLIENT» in testa
 * all'elenco dei piatti. Una decima copia non serviva: serviva una regola.
 *
 * ⚠️ `qty > 0` sta qui dentro: una riga a quantita' zero non e' un piatto, e
 * stampata diventa «0× Margherita» su un ticket che qualcuno deve preparare.
 */
export function piattiVeri<T extends VoceOrdine>(items: T[] | null | undefined): T[] {
  return (items ?? []).filter(
    (i) => i && String(i.id ?? "") !== "note" && (Number(i.qty) || 0) > 0,
  );
}

/** La nota del cliente, o `null`. E' la riga finta di cui sopra. */
export function notaCliente(items: VoceOrdine[] | null | undefined): string | null {
  const n = (items ?? []).find((i) => i && String(i.id ?? "") === "note");
  return String(n?.notes ?? "").trim() || null;
}
