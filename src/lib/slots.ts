import { DateTime } from "luxon";
// ⚠️ `./db` NON si importa qui in cima. Creare il client Supabase pretende
// SUPABASE_URL e SUPABASE_SERVICE_KEY e, se mancano, quel modulo LANCIA
// all'import. Questo file e' quasi tutto calcolo puro (slot, orari), e con
// l'import in cima moriva chiunque lo usasse senza variabili d'ambiente:
// `slots.test.ts` non riusciva nemmeno a partire. Il client serve in un punto
// solo, dentro una funzione gia' async, quindi si carica li'.

/**
 * IL FUSO — le due parti pure. La lettura sta in `fuso.ts`, che ha bisogno
 * del database; qui restano il valore di ripiego e la validazione, che non
 * hanno bisogno di niente e si possono provare senza variabili d'ambiente.
 *
 * ⚠️ QUI C'ERA `export let TIMEZONE`, una variabile di modulo MUTABILE letta
 * da diciannove file e condivisa da tutte le richieste del processo. Era
 * comoda — si importava e basta, senza passare niente — ed e' esattamente
 * per questo che era pericolosa: con due sedi in fusi diversi, la richiesta
 * di Stockel cambiava il valore sotto i piedi a quella di Schaerbeek gia'
 * partita. Non un errore: un orario sbagliato, plausibile, che nessuno
 * avrebbe collegato alla richiesta di un'altra persona.
 *
 * Adesso il fuso viaggia di mano in mano: `fusoDi(ambito)` lo legge, e chi
 * calcola lo riceve come argomento. Vedi ENGINE.md, «Il fuso orario».
 */
export const FUSO_DEFAULT = "Europe/Brussels";

/** Il fuso se e' un nome IANA valido, altrimenti `null`. Pura: `Intl` lancia
 *  sui nomi che non conosce, ed e' l'unico modo di saperlo senza un elenco
 *  da tenere aggiornato a mano. */
export function fusoValido(grezzo: unknown): string | null {
  const v = String(grezzo ?? "").trim();
  if (!v) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** Configurazione oraria di una singola fascia. */
export interface OrariApertura {
  open_time: string; // "HH:mm" o "HH:mm:ss"
  close_time: string; // "HH:mm" o "HH:mm:ss"
  is_open: boolean;
}

export interface CalcolaSlotInput {
  /** Ora corrente, DateTime luxon. Viene riportata in `fuso` qui dentro. */
  oraCorrente: DateTime;
  /** Fuso del locale (IANA). ⚠️ OBBLIGATORIO, di proposito. Prima veniva
   *  letto da una variabile globale: la funzione si dichiarava pura e non lo
   *  era. Un valore di default qui rimetterebbe lo stesso guasto in forma
   *  piu' educata — chi dimentica di passarlo calcolerebbe gli orari di
   *  Bruxelles per una sede che sta altrove, senza nessun errore. Cosi'
   *  invece non compila. */
  fuso: string;
  orariApertura: OrariApertura;
  /** Minuti minimi di preparazione (es. 30). */
  tempoPrep: number;
  /** Intervallo in minuti tra slot (es. 15 o 30). */
  durataSlot: number;
  /** Date chiuse eccezionalmente, formato "YYYY-MM-DD". */
  giorniChiusura: string[];
  /**
   * Se true (default), il tempoPrep si applica anche all'apertura (take-away:
   * la pizza va preparata). Se false, si applica solo all'ora corrente
   * (prenotazione tavolo: si prenota dall'apertura con un preavviso minimo).
   */
  preavvisoDaApertura?: boolean;
}

/** Minuti di margine: la pizza dev'essere pronta prima della chiusura. */
const MARGINE_CHIUSURA_MIN = 15;

/**
 * Calcola gli slot di ritiro disponibili per UNA fascia nel giorno di `oraCorrente`.
 * Funzione PURA: nessun I/O. Ritorna array di "HH:mm" oppure [].
 */
export function calcolaSlot(input: CalcolaSlotInput): string[] {
  const {
    oraCorrente,
    orariApertura,
    tempoPrep,
    durataSlot,
    giorniChiusura,
    preavvisoDaApertura = true,
    fuso,
  } = input;

  const ora = oraCorrente.setZone(fuso);

  // --- Caso limite 1: giorno in chiusura eccezionale ---
  const oggiISO = ora.toFormat("yyyy-MM-dd");
  if (giorniChiusura.includes(oggiISO)) return [];

  // --- Caso limite 2: giorno chiuso (is_open = false) ---
  if (!orariApertura.is_open) return [];

  const apertura = applicaOrario(ora, orariApertura.open_time);
  let chiusura = applicaOrario(ora, orariApertura.close_time);
  if (!apertura.isValid || !chiusura.isValid) return [];
  // Fascia che scavalca la mezzanotte (chiusura ≤ apertura): la chiusura è il
  // giorno dopo. Es. 18:00 → 00:00 (mezzanotte) oppure 18:00 → 01:00.
  if (chiusura <= apertura) chiusura = chiusura.plus({ days: 1 });

  // Due modalità:
  // - TAKE-AWAY (preavvisoDaApertura = true, default): la pizza richiede
  //   tempoPrep sia rispetto all'apertura sia rispetto ad ora. Primo slot =
  //   max(apertura + prep, ora + prep). È il comportamento storico.
  // - PRENOTAZIONE TAVOLO (preavvisoDaApertura = false): nessuna preparazione;
  //   si può prenotare dall'apertura, purché manchino almeno `tempoPrep` minuti
  //   da adesso. Primo slot = max(apertura, ora + tempoPrep).
  const prontoDaOra = ora.plus({ minutes: tempoPrep });
  let baseInizio: DateTime;
  if (preavvisoDaApertura) {
    const prontoDaApertura = apertura.plus({ minutes: tempoPrep });
    baseInizio = prontoDaOra > prontoDaApertura ? prontoDaOra : prontoDaApertura;
  } else {
    baseInizio = prontoDaOra > apertura ? prontoDaOra : apertura;
  }
  const primoSlot = arrotondaSuperiore(baseInizio, durataSlot);

  const ultimoSlot = chiusura.minus({ minutes: MARGINE_CHIUSURA_MIN });

  // --- Caso limite 3: troppo tardi ---
  if (primoSlot > ultimoSlot) return [];

  const out: string[] = [];
  let cursore = primoSlot;
  while (cursore <= ultimoSlot) {
    out.push(cursore.toFormat("HH:mm"));
    cursore = cursore.plus({ minutes: durataSlot });
  }
  return out;
}

/** Applica un orario "HH:mm[:ss]" alla data di `riferimento`, in Europe/Brussels. */
function applicaOrario(riferimento: DateTime, orario: string): DateTime {
  const [h, m] = orario.split(":").map((n) => parseInt(n, 10));
  return riferimento.set({
    hour: h,
    minute: m ?? 0,
    second: 0,
    millisecond: 0,
  });
}

/** Arrotonda un DateTime al multiplo SUPERIORE di `passoMin` minuti. */
function arrotondaSuperiore(dt: DateTime, passoMin: number): DateTime {
  const pulito = dt.set({ second: 0, millisecond: 0 });
  const resto = pulito.minute % passoMin;
  if (resto === 0) return pulito;
  return pulito.plus({ minutes: passoMin - resto });
}

// ============================================================
// Logica a due fasce (pranzo / cena)
// Riusa calcolaSlot() come mattone per ciascuna fascia.
// ============================================================

/** Config completa del giorno, letta da Supabase (tabella settings). */
export interface ConfigGiorno {
  lunch_active: boolean;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_active: boolean;
  dinner_open: string | null;
  dinner_close: string | null;
  prep_time_minutes: number;
  slot_duration_minutes: number;
  exceptional_closures: string[];
}

export interface SlotGiorno {
  lunch: string[];
  dinner: string[];
}

/**
 * Calcola gli slot di pranzo e cena per il giorno di `oraCorrente`.
 * Ogni fascia attiva è calcolata con calcolaSlot(); le fasce non attive
 * (o con orari mancanti) restituiscono [].
 *
 * `preavvisoMin` (opzionale): se passato, sovrascrive prep_time_minutes.
 * Usato dalle PRENOTAZIONI (90 min). Se omesso, il take-away usa il
 * prep_time_minutes del DB come sempre (nessuna regressione).
 */
export function calcolaSlotGiorno(
  oraCorrente: DateTime,
  config: ConfigGiorno,
  fuso: string,
  preavvisoMin?: number,
  preavvisoDaApertura: boolean = true
): SlotGiorno {
  const tempoPrep = preavvisoMin ?? config.prep_time_minutes;

  const comune = {
    oraCorrente,
    tempoPrep,
    durataSlot: config.slot_duration_minutes,
    giorniChiusura: config.exceptional_closures,
    preavvisoDaApertura,
    fuso,
  };

  const lunch =
    config.lunch_active && config.lunch_open && config.lunch_close
      ? calcolaSlot({
          ...comune,
          orariApertura: {
            open_time: config.lunch_open,
            close_time: config.lunch_close,
            is_open: true,
          },
        })
      : [];

  const dinner =
    config.dinner_active && config.dinner_open && config.dinner_close
      ? calcolaSlot({
          ...comune,
          orariApertura: {
            open_time: config.dinner_open,
            close_time: config.dinner_close,
            is_open: true,
          },
        })
      : [];

  return { lunch, dinner };
}