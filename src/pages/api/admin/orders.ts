import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/orders
// Restituisce gli ordini con ritiro da 7 giorni fa in poi:
// paid (attivi), done (terminati), cancelled (annullati).
// I 'pending' (checkout Stripe mai completato) restano fuori.
// Protetto: serve un token staff valido.
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Polling toast "Nouvelle commande": gli ultimi ordini PAGATI (per created_at).
  // Il client tiene gli ID già visti e avvisa sui NUOVI. Non si usa più un
  // segnalibro temporale: un ordine nasce 'pending' e diventa 'paid' dopo
  // (webhook), quindi il confronto su created_at mancava le transizioni.
  const recentPaid = url.searchParams.get("recent_paid");
  if (recentPaid) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, total_cents, pickup_time, created_at")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return json({ orders: [], now });
    return json({ orders: data ?? [], now });
  }

  // (Retro-compat) vecchio parametro `new_since`: ordini pagati creati dopo.
  const newSince = url.searchParams.get("new_since");
  if (newSince) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, total_cents, pickup_time, created_at")
      .eq("status", "paid")
      .gt("created_at", newSince)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) return json({ orders: [], now });
    return json({ orders: data ?? [], now });
  }

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
      "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at, refunded_cents, stripe_session_id"
    )
    .in("status", ["paid", "done", "cancelled"])
    .gte("pickup_time", soglia)
    .order("pickup_time", { ascending: true });

  if (error) {
    return json({ error: "Lecture impossible" }, 500);
  }

  return json({ orders: data ?? [] });
};

// PATCH /api/admin/orders — cambia lo stato di un ordine.
// Usato dai bottoni della pagina Commandes: "Terminée" → done,
// "Annuler" (con conferma) → cancelled. Mai su ordini 'pending'.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const status = String(body.status ?? "");
  if (!["paid", "done", "cancelled"].includes(status)) {
    return json({ error: "Statut invalide" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", id)
    .neq("status", "pending") // gli ordini non pagati non si toccano
    .select("id")
    .maybeSingle();

  if (error) return json({ error: "Modification impossible" }, 500);
  if (!data) return json({ error: "Commande introuvable" }, 404);
  return json({ ok: true });
};
