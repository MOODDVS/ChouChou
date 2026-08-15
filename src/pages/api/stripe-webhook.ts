import type { APIRoute } from "astro";
import { stripe } from "../../lib/stripe";
import { supabaseAdmin } from "../../lib/db";
import { inviaNotifiche } from "../../lib/notifications";
import { inviaPushOrdine } from "../../lib/push";

export const prerender = false;

const WEBHOOK_SECRET = import.meta.env.STRIPE_WEBHOOK_SECRET;

export const POST: APIRoute = async ({ request }) => {
  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET mancante");
    return new Response("Webhook non configurato", { status: 500 });
  }

  // Il corpo va letto GREZZO (raw) per verificare la firma: niente .json().
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Firma mancante", { status: 400 });
  }

  // --- 1. Verifica la firma Stripe (passo 10 del brief) ---
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
  } catch (e) {
    console.error("Firma webhook non valida:", e);
    return new Response("Firma non valida", { status: 400 });
  }

  // Ci interessa solo il completamento del checkout.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;

    // --- Buono regalo pagato con lien de paiement ---
    const giftId = session.metadata?.gift_card_id;
    if (giftId) {
      const { error: eGift } = await supabaseAdmin
        .from("gift_cards")
        .update({ paid: true, paid_at: new Date().toISOString() })
        .eq("id", giftId)
        .eq("paid", false);
      if (eGift) console.error("Errore aggiornamento bon cadeau:", eGift);
      else console.log(`Bon cadeau ${giftId} payé`);
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- Supplemento di un ordine MODIFICATO (aumento) pagato dal cliente ---
    // La sessione porta metadata.supplement="1": l'ordine e' gia' 'paid', quindi
    // qui NON si tocca lo stato ne' si rimandano le email di conferma: si azzera
    // solo la differenza dovuta e si registra il momento del pagamento.
    if (session.metadata?.supplement === "1" && orderId) {
      const { error: eSup } = await supabaseAdmin
        .from("orders")
        .update({ supplement_due_cents: 0, supplement_paid_at: new Date().toISOString() })
        .eq("id", orderId);
      if (eSup) console.error("Errore aggiornamento supplemento:", eSup);
      else console.log(`Supplemento ordine ${orderId} pagato`);
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!orderId) {
      console.error("Webhook senza order_id nei metadata");
      return new Response("order_id mancante", { status: 400 });
    }

    // --- 2. Idempotenza: aggiorna SOLO se ancora 'pending' ---
    // Se l'evento arriva due volte, la seconda non fa nulla (status già 'paid').
    const { data: aggiornato, error } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        stripe_session_id: session.id, // l'id pulito cs_test_..., non l'URL
      })
      .eq("id", orderId)
      .eq("status", "pending") // <-- chiave dell'idempotenza
      .select("id, customer_name, customer_email, customer_phone, pickup_time, items, total_cents, lang")
      .maybeSingle();

    if (error) {
      console.error("Errore aggiornamento ordine:", error);
      return new Response("Errore DB", { status: 500 });
    }

    if (aggiornato) {
        console.log(`Ordine ${orderId} confermato: pending -> paid`);
        // Notifiche: numero ordine breve dai primi 8 caratteri dell'UUID.
        await inviaNotifiche({
          numero: orderId.slice(0, 8),
          customer_name: aggiornato.customer_name,
          customer_email: aggiornato.customer_email,
          customer_phone: aggiornato.customer_phone,
          pickup_time: aggiornato.pickup_time,
          items: aggiornato.items,
          total_cents: aggiornato.total_cents,
          lang: aggiornato.lang === "en" ? "en" : "fr",
        });
        // Push all'admin: nuova commande payée
        void inviaPushOrdine({
          numero: orderId.slice(0, 8),
          customer_name: aggiornato.customer_name,
          total_cents: aggiornato.total_cents,
        });
        // Registra (o completa) il cliente nella tabella `clients`.
        // Mai bloccante: un errore qui non deve far fallire il webhook.
        await registraCliente({
          name: aggiornato.customer_name,
          email: aggiornato.customer_email,
          phone: aggiornato.customer_phone,
        });
      } else {
      // Nessuna riga aggiornata: ordine già processato (evento duplicato) o inesistente.
      console.log(`Ordine ${orderId} già processato o non trovato (idempotenza)`);
    }
  }

  // Rispondi 200 a Stripe per confermare la ricezione.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

/**
 * Salva il cliente dell'ordine nella tabella `clients` (rubrica admin).
 * - se un cliente con la stessa email esiste già: completa solo il
 *   telefono se mancava (niente doppioni, fusione per email)
 * - altrimenti lo crea
 */
async function registraCliente(c: {
  name: string | null;
  email: string | null;
  phone: string | null;
}): Promise<void> {
  try {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email) return; // senza email non c'è chiave di fusione affidabile

    const { data: esistente } = await supabaseAdmin
      .from("clients")
      .select("id, phone, hidden")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (esistente) {
      // Un nuovo ordine riattiva un cliente nascosto e completa il telefono.
      const patch: { phone?: string; hidden?: boolean } = {};
      if (!esistente.phone && c.phone) patch.phone = c.phone;
      if (esistente.hidden) patch.hidden = false;
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("clients").update(patch).eq("id", esistente.id);
      }
      return;
    }

    await supabaseAdmin.from("clients").insert({
      name: c.name ?? "",
      email,
      phone: c.phone,
    });
  } catch (e) {
    console.error("[webhook] registrazione cliente fallita:", e);
  }
}