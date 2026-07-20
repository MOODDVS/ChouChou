import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";
import { stripe } from "../../lib/stripe";

// Annullamento PUBBLICO di un ordine manuale non ancora pagato.
// Identificato dal cancel_token (email "Annuler ma commande").
// Solo status 'pending': un ordine pagato non si annulla da qui (si chiama).

export const prerender = false;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET ?token= → riepilogo minimo per la pagina di conferma
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token") ?? "";
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);
  const { data } = await supabaseAdmin
    .from("orders")
    .select("status, pickup_time, total_cents, customer_name, lang")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!data) return json({ error: "invalid" }, 404);
  return json({
    status: data.status,
    pickup_time: data.pickup_time,
    total_cents: data.total_cents,
    customer_name: data.customer_name,
    lang: data.lang === "en" ? "en" : "fr",
  });
};

// POST { token } → annulla (solo pending) + fa scadere la sessione Stripe,
// così il link di pagamento non può più incassare un ordine annullato.
export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* token solo nel body */
  }
  const token = String(body.token ?? "");
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);

  const { data: ordine } = await supabaseAdmin
    .from("orders")
    .select("id, status, stripe_session_id")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!ordine) return json({ error: "invalid" }, 404);
  if (ordine.status === "cancelled") return json({ ok: true }); // idempotente
  if (ordine.status !== "pending") return json({ error: "paid" }, 409);

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", ordine.id)
    .eq("status", "pending");
  if (error) return json({ error: "server" }, 500);

  // La sessione Stripe viene fatta scadere (l'id cs_… può essere nell'URL salvato)
  const m = /cs_(?:test|live)_[A-Za-z0-9]+/.exec(String(ordine.stripe_session_id ?? ""));
  if (m) {
    try {
      await stripe.checkout.sessions.expire(m[0]);
    } catch {
      /* già scaduta o pagata nel frattempo: non bloccante */
    }
  }
  return json({ ok: true });
};
