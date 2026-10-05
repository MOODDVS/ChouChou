/**
 * IL TICKET DI CUCINA — le regole pure, nessun import.
 *
 * ⚠️ Perche' questo file non importa niente: `admin/sede.ts` arriva a `db.ts`,
 * che LANCIA all'import se mancano le variabili di Supabase — e in vitest
 * mancano. Un file di prova che ci arrivi, anche per tre livelli di import,
 * non parte affatto, e vitest lo conta come «0 test»: verde a colpo d'occhio,
 * nessuna prova eseguita. E' gia' successo due volte (ENGINE.md). Qui ci sono
 * solo regole; chi legge il database sta altrove.
 *
 * ⚠️ IL TICKET DI CUCINA NON E' UNO SCONTRINO. Non porta prezzi, non porta il
 * totale, non porta l'email del cliente. Chi lo legge ha trenta secondi, le
 * mani sporche e il forno acceso: deve vedere l'ORA DI RITIRO, cosa fare, e
 * un nome per chiamare se qualcosa non va. Ogni riga in piu' e' una riga che
 * copre quelle tre.
 */

/** Chiavi di STAMPA, per sede. Un gruppo puo' avere la stampante in un punto
 *  e non nell'altro, e il punto senza stampante non deve vedere errori. */
export const RIPIEGO_STAMPA: Record<string, string> = {
  /** La stampa automatica e' SPENTA di ripiego: un cliente che non ha
   *  comprato la stampante non deve trovarsi una coda che accumula errori. */
  print_auto: "0",
  /** Numero della stampante nel servizio di stampa. Vuoto = nessuna. */
  print_printer_id: "",
};

export const CHIAVI_STAMPA = Object.keys(RIPIEGO_STAMPA);

/** Un interruttore spento/acceso letto da una chiave di testo. */
export function accesoStampa(valore: unknown): boolean {
  return String(valore ?? "") === "1";
}

/**
 * Si puo' stampare in questa sede, ADESSO?
 *
 * ⚠️ Volere non e' potere, come per i pagamenti: l'interruttore dice che il
 * ristoratore la vuole, il numero della stampante dice che esiste davvero.
 * Senza il secondo, mettere in coda vuol dire accumulare righe che nessuno
 * stampera' mai.
 */
export function stampaAttiva(auto: unknown, printerId: unknown): boolean {
  return accesoStampa(auto) && String(printerId ?? "").trim() !== "";
}

/**
 * Questo ordine merita un ticket di cucina?
 *
 * ⚠️ `paid` e basta non va bene. Un ordine «da incassare» preso dal sito e'
 * `pending` ma la cucina lo deve preparare lo stesso — e' esattamente la
 * distinzione che la pagina Ordini fa gia' per decidere cosa mostrare. Qui si
 * ripete una volta sola, e le due parti del motore non possono litigare.
 */
export function daStampare(stato: unknown, metodo: unknown): boolean {
  const s = String(stato ?? "");
  if (s === "paid") return true;
  return s === "pending" && String(metodo ?? "") === "onsite";
}

/** Quanti tentativi prima di arrendersi. Oltre, la riga diventa `failed` e
 *  nel pannello compare l'avviso: meglio dirlo che riprovare per ore. */
export const MAX_TENTATIVI = 5;

/**
 * Quanti secondi aspettare prima del tentativo numero `n` (1 = il primo
 * rilancio dopo un errore).
 *
 * ⚠️ Non a intervallo fisso. La causa piu' comune e' la stampante spenta o la
 * carta finita: sono guasti che durano minuti, non secondi. Riprovare ogni
 * cinque secondi per mezz'ora vuol dire trecento chiamate inutili al servizio
 * di stampa, e l'ordine stampato comunque tardi. Si allarga: 10s, 30s, 2min,
 * 5min, 15min — l'ultimo tentativo cade mezz'ora dopo, che e' il tempo in cui
 * qualcuno si accorge e rimette la carta.
 */
const ATTESE = [10, 30, 120, 300, 900];

export function attesaTentativo(n: number): number {
  if (!Number.isFinite(n) || n < 1) return ATTESE[0];
  return ATTESE[Math.min(Math.floor(n), ATTESE.length) - 1];
}

/** Una riga del ticket. Il disegno del cliente restituisce queste, e il
 *  motore le trasforma nella pagina che il servizio di stampa legge. */
export interface RigaTicket {
  testo: string;
  /** ⚠️ `gigante` NON e' «grande di piu'»: e' doppia larghezza, cioe' **24
   *  colonne invece di 48**. Va bene per l'ora, che e' corta; su un nome di
   *  piatto manderebbe a capo mezzo menu. I piatti sono `grande` (doppia
   *  altezza sola), che resta a 48. Le colonne di ogni taglia sono dichiarate
   *  in `escpos.ts`, una volta. */
  taglia?: "gigante" | "grande" | "normale" | "piccolo";
  grassetto?: boolean;
  centrato?: boolean;
  /** Bianco su nero, a tutta larghezza. Per le DUE righe che, se non si
   *  vedono, fanno sbagliare l'ordine: il giorno quando non e' oggi, e i soldi
   *  da incassare. Alla terza non e' piu' un allarme, e' decorazione. */
  inverso?: boolean;
  /** Una linea di separazione sotto questa riga. */
  linea?: boolean;
}

export interface OrdineDaStampare {
  numero: string;
  ora: string;
  cliente: string;
  telefono?: string | null;
  note?: string | null;
  piatti: { qty: number; nome: string; variante?: string | null; nota?: string | null }[];
  daIncassare?: boolean;
}

/**
 * IL TICKET DI RIPIEGO del motore: quello che esce se il cliente non ha un
 * disegno suo. Ogni cliente puo' sostituirlo con il proprio file; questo deve
 * restare leggibile da solo, perche' e' quello che vedranno i primi giorni.
 */
export function ticketCucina(o: OrdineDaStampare): RigaTicket[] {
  const righe: RigaTicket[] = [
    { testo: o.ora, taglia: "gigante", grassetto: true, centrato: true },
    { testo: `#${o.numero}`, taglia: "piccolo", centrato: true, linea: true },
  ];
  // ⚠️ «DA INCASSARE» sta in ALTO, non in fondo. Chi prepara passa il
  // sacchetto a chi sta in cassa, e deve sapere prima di consegnarlo che quei
  // soldi non sono ancora entrati.
  if (o.daIncassare) {
    righe.push({ testo: "DA INCASSARE", taglia: "grande", grassetto: true, centrato: true, inverso: true });
  }
  for (const p of o.piatti) {
    righe.push({ testo: `${p.qty}x ${p.nome}`, taglia: "grande", grassetto: true });
    if (p.variante) righe.push({ testo: `   ${p.variante}`, taglia: "normale" });
    // La nota del piatto e' il punto in cui si sbaglia un ordine: mai piccola.
    if (p.nota) righe.push({ testo: `   ${p.nota}`, taglia: "normale", grassetto: true });
  }
  righe.push({ testo: "", linea: true });
  righe.push({ testo: o.cliente, taglia: "normale", grassetto: true });
  if (o.telefono) righe.push({ testo: o.telefono, taglia: "normale" });
  if (o.note) righe.push({ testo: o.note, taglia: "normale", grassetto: true });
  return righe;
}
