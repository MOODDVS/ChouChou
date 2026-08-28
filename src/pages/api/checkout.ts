import type { APIRoute } from "astro";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";
import { creaCheckoutSession, type VoceCheckout } from "../../lib/stripe";
import { calcolaSlotGiorno, TIMEZONE } from "../../lib/slots";
import { configGiornoEffettiva } from "../../lib/schedule";
import { prezzoEffettivo } from "../../lib/pricing";
import {
  calcolaScontoCoupon,
  verificaLimitiUso,
  normalizzaCodice,
  type CouponRow,
  type LineaCoupon,
} from "../../lib/coupons";

export const prerender = false;

type Supplemento = "none" | "gluten-free" | "ricotta";

const SUPPL: Record<Supplemento, number> = {
  none: 0,
  "gluten-free": 400,
  ricotta: 300,
};
const SUPPL_LABEL: Record<Supplemento, string> = {
  none: "",
  "gluten-free": "Sans gluten",
  ricotta: "Croûte ricotta",
};

interface CheckoutRequest {
  items: { id: string; qty: number; supplement?: Supplemento }[];
  slot: string;
  note?: string;
  coupon?: string;
  customer: {
    name: string;
    surname: string;
    phone: string;
    email: string;
  };
  lang?: "fr" | "en";
}

function isPizza(categoryOrder: number): boolean {
  return categoryOrder === 2 || categoryOrder === 3;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return err(400, "Richiesta non valida");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return err(400, "Carrello vuoto");
  }
  if (!body.slot || !body.customer?.email || !body.customer?.name) {
    return err(400, "Dati mancanti");
  }

  const lang: "fr" | "en" = body.lang === "en" ? "en" : "fr";

  // Servizio chiuso dall'admin (bottone "Fermer" nella pagina Commandes):
  // blocco anche lato server, per chi avesse la pagina già aperta.
  const { data: cfgChiusura } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", "orders_closed")
    .maybeSingle();
  if (cfgChiusura?.value === "1") {
    return err(
      503,
      lang === "en"
        ? "Online ordering is temporarily closed. Please try again later."
        : "Les commandes en ligne sont momentanément fermées. Réessayez plus tard."
    );
  }

  const ora = DateTime.now().setZone(TIMEZONE);

  // Config effettiva: orari settimanali + giorni speciali (special_days).
  // Stessa fonte di /api/slots: i due DEVONO essere d'accordo.
  const config = await configGiornoEffettiva(ora);
  if (!config) {
    return err(503, "Configurazione orari non disponibile");
  }

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);
  const slotValidi = [...lunch, ...dinner];
  if (!slotValidi.includes(body.slot)) {
    return err(409, "Orario di ritiro non più disponibile");
  }

  const ids = body.items.map((i) => i.id);
  const { data: piatti, error: errMenu } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, category, price_cents, available, category_order, discount_type, discount_value")
    .in("id", ids);

  if (errMenu || !piatti) {
    return err(503, "Impossibile leggere il menu");
  }

  const voci: VoceCheckout[] = [];
  const itemsOrdine: {
    id: string;
    name: string;
    qty: number;
    price_cents: number;
    notes: string;
  }[] = [];
  // Righe per il calcolo del coupon (prezzo base effettivo, senza supplementi).
  const lineeCoupon: LineaCoupon[] = [];

  for (const richiesto of body.items) {
    const piatto = piatti.find((p) => p.id === richiesto.id);
    if (!piatto || !piatto.available) {
      return err(409, "Un piatto selezionato non è più disponibile");
    }
    const qty = Math.max(1, Math.floor(richiesto.qty));

    let supplemento: Supplemento = "none";
    const richiestoSuppl = richiesto.supplement;
    if (
      (richiestoSuppl === "gluten-free" || richiestoSuppl === "ricotta") &&
      isPizza(piatto.category_order)
    ) {
      supplemento = richiestoSuppl;
    }
    const supplCents = SUPPL[supplemento];
    // Prezzo base EFFETTIVO: gli sconti (fissi o %) valgono sempre online.
    const prezzoBase = prezzoEffettivo(piatto.price_cents, piatto.discount_type, piatto.discount_value);
    const prezzoUnitario = prezzoBase + supplCents;

    const nomeRiga =
      supplemento === "none"
        ? piatto.name
        : `${piatto.name} (${SUPPL_LABEL[supplemento]})`;

    voci.push({ name: nomeRiga, price_cents: prezzoUnitario, qty });
    itemsOrdine.push({
      id: piatto.id,
      name: nomeRiga,
      qty,
      price_cents: prezzoUnitario,
      notes: supplemento === "none" ? "" : SUPPL_LABEL[supplemento],
    });
    lineeCoupon.push({
      price_cents: prezzoBase,
      is_promo: prezzoBase < piatto.price_cents,
      category: piatto.category,
      qty,
    });
  }

  // Nota libera dell'ordine: la aggiungo come voce speciale in items (qty 0, prezzo 0),
  // così appare nelle notifiche cucina senza modificare il totale né lo schema.
  const noteText = (body.note ?? "").trim().slice(0, 500);
  if (noteText) {
    itemsOrdine.push({
      id: "note",
      name: "NOTE CLIENT",
      qty: 0,
      price_cents: 0,
      notes: noteText,
    });
  }

  const totalCents = itemsOrdine.reduce((s, i) => s + i.price_cents * i.qty, 0);

  // ---- Code promo: validazione + sconto REALE, ricalcolato lato server ----
  // Non ci si fida mai dell'importo mandato dal browser: si rilegge il coupon
  // dal DB e si ricalcola. Se non è (più) valido si rifiuta, così il cliente
  // può togliere il codice e riprovare.
  let couponId: string | null = null;
  let couponCodeSalvato: string | null = null;
  let scontoCents = 0;
  const codeInput = normalizzaCodice(body.coupon ?? "");
  if (codeInput) {
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("*")
      .eq("code_norm", codeInput)
      .maybeSingle();
    if (!coupon) {
      return err(409, lang === "en" ? "Invalid promo code." : "Code promo non valide.");
    }
    const ris = calcolaScontoCoupon(coupon as CouponRow, lineeCoupon, ora, lang);
    if (ris.error) return err(409, ris.error);
    const limite = await verificaLimitiUso(coupon as CouponRow, body.customer.email, supabaseAdmin, lang);
    if (limite) return err(409, limite);
    scontoCents = Math.min(ris.discount_cents, totalCents);
    couponId = (coupon as CouponRow).id;
    couponCodeSalvato = (coupon as CouponRow).code;
  }

  const totaleIncassato = Math.max(0, totalCents - scontoCents);

  const [h, m] = body.slot.split(":").map((n) => parseInt(n, 10));
  const pickup = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });

  // Le colonne coupon_* si scrivono SOLO se un coupon è stato applicato: così
  // gli ordini normali funzionano anche se la migration coupons.sql non è
  // ancora stata lanciata su Supabase.
  const datiOrdine: Record<string, unknown> = {
    status: "pending",
    pickup_time: pickup.toISO(),
    customer_name: normalizzaNome(`${body.customer.name} ${body.customer.surname}`),
    customer_email: body.customer.email,
    customer_phone: body.customer.phone,
    items: itemsOrdine,
    total_cents: totaleIncassato,
    lang,
  };
  if (couponId) {
    datiOrdine.coupon_id = couponId;
    datiOrdine.coupon_code = couponCodeSalvato;
    datiOrdine.coupon_discount_cents = scontoCents;
  }

  const { data: ordine, error: errInsert } = await supabaseAdmin
    .from("orders")
    .insert(datiOrdine)
    .select("id")
    .single();

  if (errInsert || !ordine) {
    return err(500, "Impossibile creare l'ordine");
  }

  const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  try {
    const url = await creaCheckoutSession({
      voci,
      orderId: ordine.id,
      siteUrl,
      lang,
      returnBase: (body as { source?: string }).source === "demo01" ? "/demo01" : undefined,
      discount:
        scontoCents > 0
          ? { amount_cents: scontoCents, label: couponCodeSalvato ?? "Code promo" }
          : undefined,
    });
    await supabaseAdmin
      .from("orders")
      .update({ stripe_session_id: url })
      .eq("id", ordine.id);

    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // Il motivo vero (chiave Stripe, metodo di pagamento non attivo…)
    // finisce nel log del server: mai nel browser del cliente.
    console.error("[checkout] Stripe error:", e);
    return err(502, "Errore nella creazione del pagamento");
  }
};

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}