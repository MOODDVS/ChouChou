import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";
import { calcolaSlotGiorno, TIMEZONE, type ConfigGiorno } from "../../lib/slots";

export const prerender = false;

export const GET: APIRoute = async () => {
  const ora = DateTime.now().setZone(TIMEZONE);

  // day_of_week: 0=domenica. luxon: weekday 1=lun..7=dom -> domenica 7 diventa 0.
  const dayOfWeek = ora.weekday === 7 ? 0 : ora.weekday;

  const { data: settings, error } = await supabaseAdmin
    .from("settings")
    .select(
      "lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures"
    )
    .eq("day_of_week", dayOfWeek)
    .single();

  // Niente fallback: se il DB non risponde o la riga manca, errore esplicito.
  if (error || !settings) {
    return new Response(
      JSON.stringify({ error: "Configurazione orari non disponibile" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const config: ConfigGiorno = {
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

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);

  return new Response(JSON.stringify({ lunch, dinner }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};