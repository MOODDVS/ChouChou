import type { APIRoute } from "astro";
import Stripe from "stripe";
import { Resend } from "resend";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { CLIENT } from "../../../config/client";
import { K_PRINT_CATALOG, PRINT_DEFAULTS, normalizzaCatalogo, type PrintProduct } from "../../../config/printCatalog";

export const prerender = false;

// Ordine di prodotti STAMPATI acquistati dal ristoratore presso MOODD.
// Pagato sullo Stripe di MOODD (MOODD_STRIPE_SECRET_KEY), come i buoni fisici.
// POST { slug, qty }  → crea la sessione Stripe Checkout, ritorna l'URL
// PUT  { session_id } → verifica il pagamento (idempotente) + avvisa MOODD
// GET                 → "guarigione" dei pending recenti + storico ordini

const MOODD_STRIPE_SECRET_KEY = import.meta.env.MOODD_STRIPE_SECRET_KEY;
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const MOODD_ORDERS_EMAIL = "enquiries@moodd.online";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = ((import.meta.env.RESEND_FROM ?? "") as string).trim().replace(/^["']|["']$/g, "") || undefined;

const moodd = MOODD_STRIPE_SECRET_KEY ? new Stripe(MOODD_STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const euro = (c: number) => (Math.round(c) / 100).toFixed(2).replace(".", ",") + " €";

/** Legge il catalogo del cliente da app_config (o i default se assente). */
async function leggiCatalogo(): Promise<PrintProduct[]> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", K_PRINT_CATALOG)
      .maybeSingle();
    const grezzo = data?.value ?? "";
    if (grezzo && String(grezzo).trim()) return normalizzaCatalogo(String(grezzo));
  } catch {
    /* default */
  }
  return PRINT_DEFAULTS;
}

/** Avvisa MOODD via email che è arrivato un ordine di stampa (best-effort). */
async function avvisaMoodd(o: { label: string; qty: number; amount_cents: number; buyer?: string | null }): Promise<void> {
  if (!resend || !RESEND_FROM) return;
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: MOODD_ORDERS_EMAIL,
      subject: `Nouvelle commande Print — ${CLIENT.nome}`,
      html:
        `<h2>Commande Print — ${CLIENT.nome}</h2>` +
        `<p><b>Produit :</b> ${o.label}<br>` +
        `<b>Quantité :</b> ${o.qty}<br>` +
        `<b>Montant payé :</b> ${euro(o.amount_cents)}<br>` +
        `<b>Client :</b> ${o.buyer ?? "—"}</p>` +
        `<p>L'adresse de livraison est disponible dans Stripe (MOODD).</p>`,
    });
  } catch (e) {
    console.error("[print-order] notifica MOODD fallita:", e);
  }
}

/** Verifica una sessione su Stripe e, se pagata, conferma l'ordine. */
async function verificaEConferma(sessionId: string): Promise<{ ok: boolean; label?: string; qty?: number; errore?: string }> {
  if (!moodd) return { ok: false, errore: "Stripe MOODD non configuré" };

  const { data: riga } = await supabaseAdmin
    .from("print_orders")
    .select("id, product_label, qty, amount_cents, buyer_email, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (!riga) return { ok: false, errore: "Commande introuvable" };
  if (riga.status === "paid") return { ok: true, label: riga.product_label, qty: riga.qty };

  let session: Stripe.Checkout.Session;
  try {
    session = await moodd.checkout.sessions.retrieve(sessionId);
  } catch {
    return { ok: false, errore: "Session Stripe introuvable" };
  }
  if (session.payment_status !== "paid") return { ok: false, errore: "Paiement non confirmé" };

  const { error } = await supabaseAdmin
    .from("print_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", riga.id)
    .eq("status", "pending");
  if (error) return { ok: false, errore: "Enregistrement impossible" };

  await avvisaMoodd({ label: riga.product_label, qty: riga.qty, amount_cents: riga.amount_cents, buyer: riga.buyer_email });
  return { ok: true, label: riga.product_label, qty: riga.qty };
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!moodd) return json({ error: "MOODD_STRIPE_SECRET_KEY manquante" }, 500);

  let body: { slug?: string; qty?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const slug = String(body.slug ?? "").trim();
  const qty = Math.floor(Number(body.qty));
  if (!slug || !Number.isFinite(qty) || qty <= 0) return json({ error: "Requête invalide" }, 400);

  const catalogo = await leggiCatalogo();
  const prodotto = catalogo.find((p) => p.slug === slug && p.visible);
  if (!prodotto) return json({ error: "Produit indisponible" }, 404);
  const tier = prodotto.tiers.find((t) => t.qty === qty);
  if (!tier) return json({ error: "Quantité indisponible" }, 400);

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
              name: `${prodotto.label} — ${qty} ex. (${CLIENT.nome})`,
              description: "Impression commandée à MOODD, livrée par MOODD",
            },
            unit_amount: tier.price_cents,
          },
          quantity: 1,
        },
      ],
      shipping_address_collection: { allowed_countries: ["BE", "FR", "LU", "NL", "DE", "IT", "ES"] },
      customer_email: staff.email ?? undefined,
      success_url: `${base}/admin/print?print_order={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/admin/print?print_cancel=1`,
    });
  } catch (e) {
    console.error("[print-order] Stripe MOODD error:", e);
    return json({ error: "Création du paiement impossible" }, 502);
  }
  if (!session.url) return json({ error: "Stripe n'a pas renvoyé d'URL" }, 502);

  const { error } = await supabaseAdmin.from("print_orders").insert({
    product_slug: prodotto.slug,
    product_label: prodotto.label,
    qty,
    amount_cents: tier.price_cents,
    meta: prodotto.meta ?? {},
    stripe_session_id: session.id,
    buyer_email: staff.email ?? null,
    status: "pending",
  });
  if (error) {
    console.error("[print-order] insert print_orders FALLITO:", error.message ?? error, error.details ?? "", error.hint ?? "", error.code ?? "");
    return json({ error: "Enregistrement impossible" }, 500);
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
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.session_id) return json({ error: "session_id manquant" }, 400);

  const esito = await verificaEConferma(body.session_id);
  if (!esito.ok) return json({ error: esito.errore }, 409);
  return json({ ok: true, label: esito.label, qty: esito.qty });
};

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Guarigione: pagamenti completati ma mai verificati (browser chiuso).
  const dalle = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: pendenti } = await supabaseAdmin
    .from("print_orders")
    .select("stripe_session_id")
    .eq("status", "pending")
    .gte("created_at", dalle);
  for (const r of pendenti ?? []) {
    if (r.stripe_session_id) await verificaEConferma(r.stripe_session_id);
  }

  const { data: ordini } = await supabaseAdmin
    .from("print_orders")
    .select("product_label, qty, amount_cents, status, paid_at, shipped_at, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(20);

  return json({ ok: true, orders: ordini ?? [] });
};
