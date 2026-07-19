import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { stripe } from "../../../lib/stripe";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// POST /api/admin/refund — rimborsa (totale o parziale) un ordine pagato con
// Stripe. body: { id, amount_cents? }. Senza amount_cents → rimborso TOTALE del
// residuo. Il server è la fonte di verità su importi e doppi rimborsi.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { id?: string; amount_cents?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  // amount_cents facoltativo: assente/null → rimborso totale del residuo.
  const amount =
    body.amount_cents === undefined || body.amount_cents === null
      ? null
      : Math.round(Number(body.amount_cents));
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return json({ error: "Montant invalide" }, 400);
  }

  const { data: ord, error } = await supabaseAdmin
    .from("orders")
    .select("id, total_cents, refunded_cents, stripe_session_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !ord) return json({ error: "Commande introuvable" }, 404);
  if (!ord.stripe_session_id) return json({ error: "Pas de paiement Stripe à rembourser" }, 400);

  const giaRimborsato = ord.refunded_cents ?? 0;
  const residuo = (ord.total_cents ?? 0) - giaRimborsato;
  if (residuo <= 0) return json({ error: "Commande déjà entièrement remboursée" }, 400);

  const daRimborsare = amount === null ? residuo : Math.min(amount, residuo);
  if (daRimborsare <= 0) return json({ error: "Montant invalide" }, 400);

  // Recupera il payment_intent dalla sessione di checkout salvata sull'ordine.
  let paymentIntent: string | null = null;
  try {
    const session = await stripe.checkout.sessions.retrieve(ord.stripe_session_id);
    paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent as { id?: string } | null)?.id ?? null;
  } catch {
    return json({ error: "Session Stripe introuvable" }, 502);
  }
  if (!paymentIntent) return json({ error: "Paiement introuvable" }, 400);

  // Crea il rimborso su Stripe.
  let refund: { id: string };
  try {
    refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount: daRimborsare });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return json({ error: msg ? `Remboursement refusé : ${msg}` : "Remboursement impossible" }, 502);
  }

  const nuovoTotale = giaRimborsato + daRimborsare;
  await supabaseAdmin
    .from("orders")
    .update({
      refunded_cents: nuovoTotale,
      refunded_at: new Date().toISOString(),
      last_refund_id: refund.id,
    })
    .eq("id", id);

  return json({ ok: true, refunded_cents: nuovoTotale, amount: daRimborsare, refund_id: refund.id });
};
