import type { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { TIMEZONE, type ConfigGiorno } from "./slots";

/**
 * Config oraria EFFETTIVA del giorno di `ora`:
 * 1. parte dagli orari settimanali (tabella settings);
 * 2. se la data cade in un giorno speciale (tabella special_days),
 *    l'eccezione vince: 'closed' chiude tutto, 'open' apre con i
 *    suoi orari anche un giorno normalmente chiuso.
 * A parità di data, 'closed' ha priorità su 'open'.
 * Usata sia da /api/slots sia dal checkout: DEVONO essere d'accordo.
 */
export async function configGiornoEffettiva(ora: DateTime): Promise<ConfigGiorno | null> {
  const oggi = ora.setZone(TIMEZONE);
  const dayOfWeek = oggi.weekday === 7 ? 0 : oggi.weekday;
  const iso = oggi.toFormat("yyyy-MM-dd");

  const { data: settings, error } = await supabaseAdmin
    .from("settings")
    .select(
      "lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures"
    )
    .eq("day_of_week", dayOfWeek)
    .single();

  if (error || !settings) return null;

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

  // Giorno speciale per la data di oggi? ('closed' vince su 'open')
  const { data: sp } = await supabaseAdmin
    .from("special_days")
    .select("type, lunch_open, lunch_close, dinner_open, dinner_close")
    .lte("date_from", iso)
    .gte("date_to", iso)
    .order("type", { ascending: true })
    .limit(1)
    .maybeSingle();

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
