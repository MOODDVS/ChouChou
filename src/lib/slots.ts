import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";

/**
 * Fuso orario del RISTORANTE. Default Bruxelles; il valore vero arriva da
 * app_config.timezone (Réglages → Général). Live binding ESM: chi importa
 * TIMEZONE vede sempre il valore aggiornato. Il refresh (cache 60s) viene
 * innescato dai punti d'ingresso async: configGiornoEffettiva, caricaToday,
 * dailyBrief — quindi ogni calcolo di slot/orari usa il fuso configurato.
 */
export let TIMEZONE = "Europe/Brussels";
let tzUltimaLettura = 0;
export async function aggiornaTimezone(): Promise<string> {
  const adesso = Date.now();
  if (adesso - tzUltimaLettura < 60_000) return TIMEZONE;
  tzUltimaLettura = adesso;
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "timezone")
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    if (v) {
      new Intl.DateTimeFormat("en", { timeZone: v }); // valida (throw se invalido)
      TIMEZONE = v;
    }
  } catch {
    /* config assente o fuso invalido: si tiene il valore attuale */
  }
  return TIMEZONE;
}

/** Configurazione oraria di una singola fascia. */
export interface OrariApertura {
  open_time: string; // "HH:mm" o "HH:mm:ss"
  close_time: string; // "HH:mm" o "HH:mm:ss"
  is_open: boolean;
}

export interface CalcolaSlotInput {
  /** Ora corrente, DateTime luxon. DEVE essere in zona Europe/Brussels. */
  oraCorrente: DateTime;
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
  } = input;

  const ora = oraCorrente.setZone(TIMEZONE);

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