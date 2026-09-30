import type { APIRoute } from "astro";
// Multi-sede: qui l'AGGREGATO e' la risposta giusta (vedi sotto).
import Stripe from "stripe";
import { aggiorna, tutteLeSedi, segretiDOgniSede } from "../../lib/admin/sede";
import { supabaseAdmin } from "../../lib/db";
import { confermaOrdinePagato } from "../../lib/confermaOrdine";

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

    // --- 2. La conferma, che non vive piu' qui ---
    // ⚠️ Le quattro cose che succedono quando un pagamento arriva — stato,
    // email al cliente, email alla cucina, notifica, rubrica — stavano tutte
    // dentro questo file, e quindi il webhook era l'UNICO modo di confermare
    // un ordine. Il 29/09/2026 i webhook di 450 Gradi puntavano ancora al
    // dominio di prova: due clienti hanno pagato e il ristorante non ha visto
    // niente, senza un errore da nessuna parte. Ora il gesto sta in
    // `lib/confermaOrdine.ts` e ha piu' di una strada per arrivarci.
    //
    // L'idempotenza (aggiorna solo se ancora `pending`) sta li' dentro: un
    // evento consegnato due volte non manda due email.
    try {
      const fatto = await confermaOrdinePagato({
        orderId,
        ambito,
        sessionId: session.id, // l'id pulito cs_..., non l'URL
      });
      console.log(
        fatto
          ? `Ordine ${orderId} confermato: pending -> paid`
          : `Ordine ${orderId} gia' processato o non trovato (idempotenza)`,
      );
    } catch {
      return new Response("Errore DB", { status: 500 });
    }
  }

  // Rispondi 200 a Stripe per confermare la ricezione.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
