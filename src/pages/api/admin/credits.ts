import type { APIRoute } from "astro";
import Stripe from "stripe";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// Acquisto crediti newsletter — pagato sullo Stripe di MOODD
// (MOODD_STRIPE_SECRET_KEY), SEPARATO da quello del ristorante.
// POST { pack }        → crea la sessione Stripe Checkout, ritorna l'URL
// PUT  { session_id }  → verifica il pagamento e attiva i crediti
//                        (idempotente: la stessa sessione accredita 1 volta)
// GET                  → "guarigione": verifica le sessioni pending recenti
//                        (browser chiuso prima del ritorno) e ritorna il saldo

const MOODD_STRIPE_SECRET_KEY = import.meta.env.MOODD_STRIPE_SECRET_KEY;
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";

const PACKS: Record<string, { credits: number; amount_cents: number }> = {
  "500": { credits: 500, amount_cents: 599 },
  "1000": { credits: 1000, amount_cents: 999 },
  "2000": { credits: 2000, amount_cents: 1499 },
  "5000": { credits: 5000, amount_cents: 2999 },
};

const moodd = MOODD_STRIPE_SECRET_KEY ? new Stripe(MOODD_STRIPE_SECRET_KEY) : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Verifica una sessione su Stripe e, se pagata, attiva i crediti. */
async function verificaEAccredita(sessionId: string): Promise<{ ok: boolean; credits?: number; errore?: string }> {
  if (!moodd) return { ok: false, errore: "Stripe MOODD non configuré" };

  const { data: riga } = await supabaseAdmin
    .from("newsletter_credits")
    .select("id, credits, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (!riga) return { ok: false, errore: "Achat introuvable" };
  if (riga.status === "paid") return { ok: true, credits: riga.credits }; // già accreditato

  let session: Stripe.Checkout.Session;
  try {
    session = await moodd.checkout.sessions.retrieve(sessionId);
  } catch {
    return { ok: false, errore: "Session Stripe introuvable" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false, errore: "Paiement non confirmé" };
  }

  // Idempotenza: aggiorna solo se ancora pending
  const { error } = await supabaseAdmin
    .from("newsletter_credits")
    .update({ status: "paid" })
    .eq("id", riga.id)
    .eq("status", "pending");
  if (error) return { ok: false, errore: "Enregistrement impossible" };
  return { ok: true, credits: riga.credits };
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!moodd) return json({ error: "MOODD_STRIPE_SECRET_KEY manquante" }, 500);

  let body: { pack?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const pack = PACKS[body.pack ?? ""];
  if (!pack) return json({ error: "Pack inconnu" }, 400);

  const base = SITE_URL.replace(/\/$/, "");
  let session: Stripe.Checkout.Session;
  try {
    session = await moodd.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Crédits newsletter +${pack.credits} — La Molisana`,
              description: "Crédits d'envoi newsletter (sans expiration)",
            },
            unit_amount: pack.amount_cents,
          },
          quantity: 1,
        },
      ],
      customer_email: staff.email ?? undefined,
      success_url: `${base}/admin/marketing?credit_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/admin/marketing`,
    });
  } catch (e) {
    console.error("[credits] Stripe MOODD error:", e);
    return json({ error: "Création du paiement impossible" }, 502);
  }
  if (!session.url) return json({ error: "Stripe n'a pas renvoyé d'URL" }, 502);

  // Riga pending: permette la verifica al ritorno e la "guarigione" dopo
  const { error } = await supabaseAdmin.from("newsletter_credits").insert({
    pack: `+${pack.credits}`,
    credits: pack.credits,
    amount_cents: pack.amount_cents,
    stripe_session_id: session.id,
    status: "pending",
  });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, url: session.url });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { session_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.session_id) return json({ error: "session_id manquant" }, 400);

  const esito = await verificaEAccredita(body.session_id);
  if (!esito.ok) return json({ error: esito.errore }, 409);
  return json({ ok: true, credits: esito.credits });
};

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Guarigione: pagamenti completati ma mai verificati (browser chiuso
  // prima del ritorno all'admin). Controlla i pending delle ultime 48h.
  const dalle = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: pendenti } = await supabaseAdmin
    .from("newsletter_credits")
    .select("stripe_session_id")
    .eq("status", "pending")
    .gte("created_at", dalle);
  let recuperati = 0;
  for (const r of pendenti ?? []) {
    if (!r.stripe_session_id) continue;
    const esito = await verificaEAccredita(r.stripe_session_id);
    if (esito.ok) recuperati += esito.credits ?? 0;
  }

  const { data: acquisti } = await supabaseAdmin
    .from("newsletter_credits")
    .select("pack, credits, amount_cents, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(12);

  return json({ ok: true, recovered: recuperati, purchases: acquisti ?? [] });
};
