import type { APIRoute } from "astro";
import { ambitoDiRichiesta, cercaAmbito, leggi, aggiorna } from "../../../lib/admin/sede";
import { stripeDi } from "../../../lib/stripe";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

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
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { id?: string; amount_cents?: number; difference?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  // amount_cents facoltativo: assente/null → rimborso totale del residuo.
  const amount =
    body.amount_cents === undefined || body.amount_cents === null
      ? null
      : Math.round(Number(body.amount_cents));
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return json({ error: await msg("err.amount") }, 400);
  }

  const { data: ord, error } = await leggi("orders", ambito, "id, total_cents, refunded_cents, stripe_session_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !ord) return json({ error: await msg("err.orderNotFound") }, 404);
  if (!ord.stripe_session_id) return json({ error: await msg("err.noStripePayment") }, 400);

  const giaRimborsato = ord.refunded_cents ?? 0;
  const residuo = (ord.total_cents ?? 0) - giaRimborsato;
  if (residuo <= 0) return json({ error: await msg("err.alreadyRefunded") }, 400);

  // Modalità "differenza" (bottone dopo una modifica al ribasso): l'importo da
  // rendere è quello tracciato in refund_due_cents, che può superare il totale
  // corrente (l'ordine è stato ridotto), quindi NON usa il tetto `residuo`.
  const isDiff = body.difference === true;
  let refundDue = 0;
  if (isDiff) {
    const { data: d50, error: e50 } = await leggi("orders", ambito, "refund_due_cents")
      .eq("id", id)
      .maybeSingle();
    if (e50) return json({ error: await msg("err.migr50") }, 500);
    refundDue = Number((d50 as { refund_due_cents?: number } | null)?.refund_due_cents ?? 0);
    if (refundDue <= 0) return json({ error: await msg("err.noDiff") }, 400);
  }

  const tetto = isDiff ? refundDue : residuo;
  const daRimborsare = amount === null ? tetto : Math.min(amount, tetto);
  if (daRimborsare <= 0) return json({ error: await msg("err.amount") }, 400);

  // ⚠️⚠️ IL RIMBORSO ESCE DAL CONTO CHE HA INCASSATO, cioe' dalla sede
  // scritta NELL'ORDINE — non da quella selezionata nell'header di chi sta
  // premendo il bottone. Sono due cose che quasi sempre coincidono; il giorno
  // che non coincidono, sono soldi che escono dal conto di una societa' che
  // non c'entra, e il payment_intent non si troverebbe nemmeno.
  // ⚠️ Il messaggio d'errore arriva fino allo schermo: dice quale chiave
  // manca e dove metterla. Non contiene nessun segreto, e chi sta guardando
  // questa pagina e' l'unico che puo' risolvere il problema.
  let motivo = "";
  const sp = await stripeDi(await cercaAmbito("orders", id, ambito)).catch((e) => {
    motivo = e instanceof Error ? e.message : "";
    console.error("[refund] client Stripe:", e);
    return null;
  });
  if (!sp) return json({ error: motivo || (await msg("err.stripeLocation")) }, 500);

  // Recupera il payment_intent dalla sessione di checkout salvata sull'ordine.
  let paymentIntent: string | null = null;
  try {
    const session = await sp.checkout.sessions.retrieve(ord.stripe_session_id);
    paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent as { id?: string } | null)?.id ?? null;
  } catch {
    return json({ error: await msg("err.stripeSessionNotFound") }, 502);
  }
  if (!paymentIntent) return json({ error: await msg("err.paymentNotFound") }, 400);

  // Crea il rimborso su Stripe.
  let refund: { id: string };
  try {
    refund = await sp.refunds.create({ payment_intent: paymentIntent, amount: daRimborsare });
  } catch (e) {
    const dettaglio = e instanceof Error ? e.message : "";
    return json({ error: dettaglio ? `${await msg("err.refundRefused")} : ${dettaglio}` : await msg("err.refund") }, 502);
  }

  const nuovoTotale = giaRimborsato + daRimborsare;
  const upd: Record<string, unknown> = {
    refunded_cents: nuovoTotale,
    refunded_at: new Date().toISOString(),
    last_refund_id: refund.id,
  };
  // Differenza saldata: sgonfio (o azzero) refund_due_cents cosi' il bottone
  // "Rembourser la difference" sparisce dalla card.
  if (isDiff) upd.refund_due_cents = Math.max(0, refundDue - daRimborsare);
  await aggiorna("orders", ambito, upd).eq("id", id);

  return json({ ok: true, refunded_cents: nuovoTotale, amount: daRimborsare, refund_id: refund.id });
};
