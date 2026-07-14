import type { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";
import { TIMEZONE, type ConfigGiorno } from "./slots";

/**
 * Config oraria EFFETTIVA del giorno di `ora`:
 * 1. parte dagli orari settimanali (tabella settings);
 * 2. se la data cade in un giorno speciale (tabella special_days),
 *    l'eccezione vince: 'closed' chiude tutto, 'open' apre con i
 *    suoi orari anche un giorno normalmente chiuso.
 * A parità di data, 'closed' ha priorità su 'open'.
 * Usata sia da /api/slots sia dal checkout: DEVONO essere d'accordo.
 *
 * PERFORMANCE: le due tabelle vengono lette UNA volta e tenute in una
 * cache da 60s. Chiamare questa funzione più volte nella stessa pagina
 * (es. il calcolo della prossima riapertura) non costa query extra.
 */

interface RigaSettings {
  day_of_week: number;
  lunch_active: boolean;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_active: boolean;
  dinner_open: string | null;
  dinner_close: string | null;
  prep_time_minutes: number;
  slot_duration_minutes: number;
  exceptional_closures: unknown;
}

interface RigaSpeciale {
  date_from: string;
  date_to: string;
  type: string;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_open: string | null;
  dinner_close: string | null;
}

/** Tutti i 7 giorni della tabella settings (cache 60s). */
async function tutteLeSettings(): Promise<RigaSettings[]> {
  return cacheOr("sched:settings", async () => {
    const { data, error } = await supabaseAdmin
      .from("settings")
      .select(
        "day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures"
      );
    if (error || !data) throw new Error("settings illeggibili");
    return data as RigaSettings[];
  });
}

/** Giorni speciali attuali e futuri prossimi (cache 60s). */
async function giorniSpeciali(): Promise<RigaSpeciale[]> {
  return cacheOr("sched:special", async () => {
    const { data, error } = await supabaseAdmin
      .from("special_days")
      .select("date_from, date_to, type, lunch_open, lunch_close, dinner_open, dinner_close")
      .order("type", { ascending: true }); // 'closed' prima di 'open'
    if (error || !data) throw new Error("special_days illeggibili");
    return data as RigaSpeciale[];
  });
}

export async function configGiornoEffettiva(ora: DateTime): Promise<ConfigGiorno | null> {
  const oggi = ora.setZone(TIMEZONE);
  const dayOfWeek = oggi.weekday === 7 ? 0 : oggi.weekday;
  const iso = oggi.toFormat("yyyy-MM-dd");

  let settings: RigaSettings | undefined;
  let sp: RigaSpeciale | undefined;
  try {
    const [tutte, speciali] = await Promise.all([tutteLeSettings(), giorniSpeciali()]);
    settings = tutte.find((r) => r.day_of_week === dayOfWeek);
    sp = speciali.find((s) => s.date_from <= iso && s.date_to >= iso);
  } catch {
    return null;
  }
  if (!settings) return null;

  const base: ConfigGiorno = {
    lunch_active: settings.lunch_active,
    lunch_open: settings.lunch_open,
    lunch_close: settings.lunch_close,
    dinner_active: settings.dinner_active,
    dinner_open: settings.dinner_open,
    dinner_close: settings.dinner_close,
    prep_time_minutes: settings.prep_time_minutes,
    slot_duration_minutes: settings.slot_duration_minutes,
    exceptional_closures: Array.isArray(settings.exceptional_closures)
      ? settings.exceptional_closures
      : [],
  };

  if (!sp) return base;

  if (sp.type === "closed") {
    return { ...base, lunch_active: false, dinner_active: false };
  }

  // Apertura eccezionale: usa gli orari dell'eccezione e ignora
  // le chiusure legacy (l'apertura è esplicita).
  return {
    ...base,
    lunch_active: !!(sp.lunch_open && sp.lunch_close),
    lunch_open: sp.lunch_open,
    lunch_close: sp.lunch_close,
    dinner_active: !!(sp.dinner_open && sp.dinner_close),
    dinner_open: sp.dinner_open,
    dinner_close: sp.dinner_close,
    exceptional_closures: [],
  };
}
