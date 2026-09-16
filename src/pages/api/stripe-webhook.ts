import type { APIRoute } from "astro";
// Multi-sede: qui l'AGGREGATO e' la risposta giusta (vedi sotto).
import Stripe from "stripe";
import { aggiorna, tutteLeSedi, segretiDOgniSede } from "../../lib/admin/sede";
import { supabaseAdmin } from "../../lib/db";
import { inviaNotifiche } from "../../lib/notifications";
import { inviaPushOrdine } from "../../lib/push";
import { ambitoDiRiga } from "../../lib/admin/sede";

export const prerender = false;

/**
 * ⚠️ UN SOLO INDIRIZZO, PIU' CHIAVI DI FIRMA.
 *
 * Tre societa' = tre conti Stripe = tre webhook, e ognuno firma con la SUA
 * chiave. Ma la firma va verificata PRIMA di poter leggere il corpo, quindi
 * nell'istante in cui serve la chiave non si sa ancora di chi sia l'evento:
 * e' il caso rovesciato rispetto a tutto il resto del multi-sede.
 *
 * Si provano tutte le chiavi di firma note. Quella che verifica dice anche da
 * quale conto arriva l'evento — l'informazione si ricava dalla prova, non va
 * chiesta a nessuno. Sono tre HMAC su qualche kB: niente.
 *
 * ⚠️ NON si mette la sede nell'URL (`/api/stripe-webhook/<slug>`), che pure
 * sarebbe piu' esplicito nel pannello di Stripe. Lo slug si puo' cambiare
 * dall'admin, e il giorno che qualcuno lo cambia i tre indirizzi registrati
 * su Stripe puntano nel vuoto: i pagamenti riescono, gli ordini restano «in
 * attesa» per sempre e nessun errore lo dice. Un indirizzo solo, uguale per
 * tutti e tre i conti, non si rompe rinominando niente.
 *
 * ⚠️ `Stripe.webhooks` e' STATICO: verificare una firma e' crittografia pura
 * e non ha bisogno di nessuna chiave API. Quindi qui non si costruisce
 * nessun client, e un gruppo che tiene tutte le chiavi nel database (niente
 * `STRIPE_SECRET_KEY` nel `.env`) funziona lo stesso.
 */

export const POST: APIRoute = async ({ request }) => {
  // ⚠️ AGGREGATO, chiesto per nome. Stripe chiama con l'id della sessione e
  // non sa niente di sedi. L'ordine da aggiornare e' quello, e puo' essere di
  // qualsiasi punto: filtrando, il pagamento di due sedi su tre resterebbe
  // per sempre «in attesa». La firma dell'evento e' l'autorizzazione.
  const ambito = tutteLeSedi();
  const chiaviFirma = await segretiDOgniSede("stripe_webhook_secret");
  if (chiaviFirma.length === 0) {
    console.error("Nessuna chiave di firma webhook: ne' STRIPE_WEBHOOK_SECRET nel .env, ne' in nessuna sede");
    return new Response("Webhook non configurato", { status: 500 });
  }

  // Il corpo va letto GREZZO (raw) per verificare la firma: niente .json().
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Firma mancante", { status: 400 });
  }

  // --- 1. Verifica la firma Stripe (passo 10 del brief) ---
  let event: Stripe.Event | null = null;
  let conto = "ambiente";
  for (const c of chiaviFirma) {
    try {
      event = Stripe.webhooks.constructEvent(payload, signature, c.valore);
      conto = c.ambito.modo === "sede" ? c.ambito.id : "ambiente";
      break;
    } catch {
      // Non e' questa chiave: si prova la prossima. Non si registra niente —
      // con piu' conti i tentativi falliti sono la normalita', e un log per
      // ognuno renderebbe illeggibili i guasti veri.
    }
  }
  if (!event) {
    console.error(`Firma webhook non valida (provate ${chiaviFirma.length} chiavi)`);
    return new Response("Firma non valida", { status: 400 });
  }
  console.log(`[stripe-webhook] ${event.type} — conto: ${conto}`);

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
      const { error: eSup } = await aggiorna("orders", ambito, { supplement_due_cents: 0, supplement_paid_at: new Date().toISOString() })
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
    const { data: aggiornato, error } = await aggiorna("orders", ambito, {
        status: "paid",
        stripe_session_id: session.id, // l'id pulito cs_test_..., non l'URL
      })
      .eq("id", orderId)
      .eq("status", "pending") // <-- chiave dell'idempotenza
      // `location_id` serve alla notifica push: dice a QUALE pizzeria suona.
      .select("id, customer_name, customer_email, customer_phone, pickup_time, items, total_cents, lang, location_id")
      .maybeSingle();

    if (error) {
      console.error("Errore aggiornamento ordine:", error);
      return new Response("Errore DB", { status: 500 });
    }

    if (aggiornato) {
        console.log(`Ordine ${orderId} confermato: pending -> paid`);
        // Notifiche: numero ordine breve dai primi 8 caratteri dell'UUID.
        await inviaNotifiche({
          // La sede la dice la RIGA: e' lei che decide indirizzo, mittente e
          // cucina a cui arriva il ticket.
          location_id: aggiornato.location_id ?? null,
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
        // ⚠️ La sede la dice la RIGA, non la richiesta: Stripe non sa niente
        // di sedi (per questo la lettura qui sopra usa l'aggregato). Senza,
        // un ordine di Stockel farebbe squillare anche Jourdan e Schaerbeek.
        void inviaPushOrdine({
          numero: orderId.slice(0, 8),
          customer_name: aggiornato.customer_name,
          total_cents: aggiornato.total_cents,
        }, ambitoDiRiga(aggiornato.location_id));
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