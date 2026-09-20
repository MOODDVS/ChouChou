import type { APIRoute } from "astro";
import Stripe from "stripe";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { CLIENT } from "../../../config/client";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Acquisto di BUONI FISICI (cartoncini) dal ristoratore presso MOODD.
// Pagato sullo Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i crediti
// newsletter — NON sullo Stripe del ristorante.
// POST { pack }       → crea la sessione Stripe Checkout, ritorna l'URL
// PUT  { session_id } → verifica il pagamento (idempotente)
// GET                 → "guarigione" dei pending recenti + storico acquisti

const MOODD_STRIPE_SECRET_KEY = import.meta.env.MOODD_STRIPE_SECRET_KEY;
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";

export const PACKS_BONS: Record<string, { qty: number; amount_cents: number }> = {
  "25": { qty: 25, amount_cents: 9000 },
  "100": { qty: 100, amount_cents: 12900 },
  "250": { qty: 250, amount_cents: 18500 },
};

const moodd = MOODD_STRIPE_SECRET_KEY ? new Stripe(MOODD_STRIPE_SECRET_KEY) : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Verifica una sessione su Stripe e, se pagata, conferma l'ordine. */
async function verificaEConferma(sessionId: string): Promise<{ ok: boolean; qty?: number; errore?: string }> {
  if (!moodd) return { ok: false, errore: "err.stripeMoodd" };

  const { data: riga } = await supabaseAdmin
    .from("gift_card_orders")
    .select("id, qty, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (!riga) return { ok: false, errore: "err.orderNotFound" };
  if (riga.status === "paid") return { ok: true, qty: riga.qty };

  let session: Stripe.Checkout.Session;
  try {
    session = await moodd.checkout.sessions.retrieve(sessionId);
  } catch {
    return { ok: false, errore: "err.stripeSessionNotFound" };
  }
  if (session.payment_status !== "paid") return { ok: false, errore: "err.paymentUnconfirmed" };

  const { error } = await supabaseAdmin
    .from("gift_card_orders")
    .update({ status: "paid" })
    .eq("id", riga.id)
    .eq("status", "pending");
  if (error) return { ok: false, errore: "err.save" };
  return { ok: true, qty: riga.qty };
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!moodd) return json({ error: await msg("err.stripeKeyMissing") }, 500);

  let body: { pack?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  const pack = PACKS_BONS[body.pack ?? ""];
  if (!pack) return json({ error: await msg("err.packUnknown") }, 400);

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
              name: `${pack.qty} bons cadeaux imprimés — ${CLIENT.nome}`,
              description: "Cartes cadeaux physiques personnalisées, livrées par MOODD",
            },
            unit_amount: pack.amount_cents,
          },
          quantity: 1,
        },
      ],
      // L'indirizzo di consegna dei cartoncini lo raccoglie Stripe
      shipping_address_collection: { allowed_countries: ["BE", "FR", "LU", "NL", "DE", "IT", "ES"] },
      customer_email: staff.email ?? undefined,
      success_url: `${base}/admin/marketing?cards_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/admin/marketing`,
    });
  } catch (e) {
    console.error("[bons] Stripe MOODD error:", e);
    return json({ error: await msg("err.paymentCreate") }, 502);
  }
  if (!session.url) return json({ error: await msg("err.stripeNoUrl") }, 502);

  const { error } = await supabaseAdmin.from("gift_card_orders").insert({
    qty: pack.qty,
    amount_cents: pack.amount_cents,
    stripe_session_id: session.id,
    buyer_email: staff.email ?? null,
    status: "pending",
  });
  if (error) {
    console.error("[bons] insert gift_card_orders FALLITO:", error.message ?? error, error.details ?? "", error.hint ?? "", error.code ?? "");
    return json({ error: await msg("err.save") }, 500);
  }

  return json({ ok: true, url: session.url });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { session_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  if (!body.session_id) return json({ error: await msg("err.sessionId") }, 400);

  const esito = await verificaEConferma(body.session_id);
  if (!esito.ok) return json({ error: await msg(esito.errore ?? "err.save") }, 409);
  return json({ ok: true, qty: esito.qty });
};

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Guarigione: pagamenti completati ma mai verificati (browser chiuso).
  const dalle = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: pendenti } = await supabaseAdmin
    .from("gift_card_orders")
    .select("stripe_session_id")
    .eq("status", "pending")
    .gte("created_at", dalle);
  for (const r of pendenti ?? []) {
    if (r.stripe_session_id) await verificaEConferma(r.stripe_session_id);
  }

  const { data: acquisti } = await supabaseAdmin
    .from("gift_card_orders")
    .select("qty, amount_cents, status, shipped_at, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(10);

  return json({ ok: true, purchases: acquisti ?? [] });
};
