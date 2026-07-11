import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { calcolaSlotGiorno, TIMEZONE } from "../../lib/slots";
import { configGiornoEffettiva } from "../../lib/schedule";

export const prerender = false;

export const GET: APIRoute = async () => {
  const ora = DateTime.now().setZone(TIMEZONE);

  // Config effettiva: orari settimanali + giorni speciali (special_days).
  const config = await configGiornoEffettiva(ora);

  // Niente fallback: se il DB non risponde o la riga manca, errore esplicito.
  if (!config) {
    return new Response(
      JSON.stringify({ error: "Configurazione orari non disponibile" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);

  return new Response(JSON.stringify({ lunch, dinner }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
