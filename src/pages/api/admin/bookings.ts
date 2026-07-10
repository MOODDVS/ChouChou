import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// GET /api/admin/bookings
// Restituisce le prenotazioni da 7 giorni fa in poi (passate max 1 settimana
// + tutte le future). Protetto: serve un token staff valido.
export const GET: APIRoute = async ({ request }) => {
  // 1. Sicurezza: verifica che chi chiede sia uno staff autenticato.
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // 2. Calcola la data minima: 7 giorni fa, fuso Europe/Brussels.
  const setteGiorniFa = DateTime.now()
    .setZone("Europe/Brussels")
    .minus({ days: 30 })
    .toISODate(); // "YYYY-MM-DD"

  // 3. Leggi i dati con la service key (lato server), filtrando per data.
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, status, customer_name, customer_email, customer_phone, booking_date, booking_time, people, company, notes, lang, source, created_at"
    )
    .gte("booking_date", setteGiorniFa)
    .order("booking_date", { ascending: false })
    .order("booking_time", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: "Lecture impossible" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ bookings: data ?? [] }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
