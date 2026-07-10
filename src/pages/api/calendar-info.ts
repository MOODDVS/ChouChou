import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";

export const prerender = false;

export const GET: APIRoute = async () => {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select(
      "day_of_week, lunch_active, dinner_active, exceptional_closures"
    );

  if (error || !data) {
    return new Response(
      JSON.stringify({ error: "Configuration indisponible" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Un giorno della settimana è "chiuso" se né pranzo né cena sono attivi.
  const closedWeekdays: number[] = data
    .filter((r) => !r.lunch_active && !r.dinner_active)
    .map((r) => r.day_of_week);

  // Unione di tutte le chiusure eccezionali (date "YYYY-MM-DD").
  const closedDates = Array.from(
    new Set(
      data.flatMap((r) =>
        Array.isArray(r.exceptional_closures) ? r.exceptional_closures : []
      )
    )
  );

  return new Response(
    JSON.stringify({ closedWeekdays, closedDates }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }
  );
};