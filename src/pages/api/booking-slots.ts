import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";
import { calcolaSlotGiorno, TIMEZONE, type ConfigGiorno } from "../../lib/slots";

export const prerender = false;

// Preavviso minimo per una prenotazione tavolo (minuti).
const PREAVVISO_PRENOTAZIONE = 30;

export const GET: APIRoute = async ({ url }) => {
  const dateParam = url.searchParams.get("date"); // "YYYY-MM-DD"
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return new Response(JSON.stringify({ error: "Date invalide" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const giorno = DateTime.fromISO(dateParam, { zone: TIMEZONE }).startOf("day");
  if (!giorno.isValid) {
    return new Response(JSON.stringify({ error: "Date invalide" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Non si prenota nel passato.
  const ora = DateTime.now().setZone(TIMEZONE);
  if (giorno.endOf("day") < ora) {
    return new Response(JSON.stringify({ lunch: [], dinner: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Riferimento: se è oggi uso l'ora attuale (il preavviso 30' taglia gli slot
  // già passati); se è un giorno futuro uso l'inizio giornata (tutti gli slot
  // del giorno restano validi).
  const stessoGiorno = giorno.hasSame(ora, "day");
  const riferimento = stessoGiorno ? ora : giorno;

  const dayOfWeek = giorno.weekday === 7 ? 0 : giorno.weekday;

  const { data: settings, error } = await supabaseAdmin
    .from("settings")
    .select(
      "lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures"
    )
    .eq("day_of_week", dayOfWeek)
    .single();

  if (error || !settings) {
    return new Response(
      JSON.stringify({ error: "Configuration horaires indisponible" }),
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

  const { lunch, dinner } = calcolaSlotGiorno(riferimento, config, PREAVVISO_PRENOTAZIONE, false);

  return new Response(JSON.stringify({ lunch, dinner }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};