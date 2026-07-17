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
