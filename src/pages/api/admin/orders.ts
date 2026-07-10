import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// GET /api/admin/orders
// Restituisce gli ordini PAGATI con ritiro da 7 giorni fa in poi.
// Protetto: serve un token staff valido.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Soglia: 7 giorni fa a mezzanotte, fuso Europe/Brussels, in ISO completo
  // (pickup_time è timestamptz, quindi confronto con un istante ISO).
  const soglia = DateTime.now()
    .setZone("Europe/Brussels")
    .minus({ days: 7 })
    .startOf("day")
    .toISO();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at"
    )
    .eq("status", "paid")
    .gte("pickup_time", soglia)
    .order("pickup_time", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: "Lecture impossible" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ orders: data ?? [] }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
