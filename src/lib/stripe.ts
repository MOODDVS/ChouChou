import Stripe from "stripe";

const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;

/**
 * Client Stripe lato SERVER, creato in modo PIGRO alla prima vera chiamata.
 * Cosi' il motore parte anche SENZA STRIPE_SECRET_KEY nel .env (template,
 * clienti senza ordini online): l'errore arriva solo se si usa davvero
 * Stripe (checkout, rimborso, link di pagamento).
 * Usa la secret key: solo in endpoint API / codice server, mai nel browser.
 */
let _stripe: Stripe | null = null;

function clientStripe(): Stripe {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY mancante nel file .env");
    _stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// Proxy: stessa interfaccia di prima (`stripe.checkout...`), zero modifiche
// negli altri file; l'istanza vera nasce al primo accesso a una proprieta'.
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    const c = clientStripe() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

/** Una riga d'ordine già validata e con prezzo letto dal DB. */
export interface VoceCheckout {
  name: string;
  price_cents: number;
  qty: number;
}

interface CreaSessioneInput {
  voci: VoceCheckout[];
  orderId: string;
  siteUrl: string;
  lang?: "fr" | "en";
  // Sconto coupon già calcolato lato server (centesimi). Se presente, viene
  // creato un coupon Stripe "usa e getta" (duration: once) applicato alla
  // sessione: il cliente vede la riduzione e paga il totale scontato.
  discount?: { amount_cents: number; label: string };
}

/**
 * Crea una Stripe Checkout Session (hosted).
 * Ritorna l'URL a cui reindirizzare il browser per pagare.
 */
export async function creaCheckoutSession({
  voci,
  orderId,
  siteUrl,
  lang = "fr",
  discount,
}: CreaSessioneInput): Promise<string> {
  // Prefisso lingua per gli URL di ritorno: EN sotto /en/, FR senza prefisso.
  const prefix = lang === "en" ? "/en" : "";

  // Sconto coupon → coupon Stripe monouso applicato alla sessione.
  let discounts: { coupon: string }[] | undefined;
  if (discount && discount.amount_cents > 0) {
    const c = await stripe.coupons.create({
      amount_off: discount.amount_cents,
      currency: "eur",
      duration: "once",
      name: discount.label.slice(0, 40) || "Code promo",
    });
    discounts = [{ coupon: c.id }];
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: voci.map((v) => ({
      price_data: {
        currency: "eur",
        product_data: { name: v.name },
        unit_amount: v.price_cents,
      },
      quantity: v.qty,
    })),
    ...(discounts ? { discounts } : {}),
    metadata: { order_id: orderId },
    success_url: `${siteUrl}${prefix}/order-confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${prefix}/order-cancel`,
  });

  if (!session.url) {
    throw new Error("Stripe non ha restituito un URL di checkout");
  }
  return session.url;
}

/**
 * Crea una Checkout Session per l'acquisto di un BUONO REGALO.
 * Il pagamento è a carico di chi offre (lien de paiement inviato per email).
 * `metadata.gift_card_id` permette al webhook di marcarlo come pagato.
 */
export async function creaCheckoutBon(opts: {
  giftCardId: string;
  code: string;
  valueCents: number;
  shippingCents?: number;
  siteUrl: string;
  nomeRistorante: string;
}): Promise<string> {
  const voci: { name: string; amount: number }[] = [
    { name: `Bon cadeau ${opts.nomeRistorante} — ${opts.code}`, amount: opts.valueCents },
  ];
  if (opts.shippingCents && opts.shippingCents > 0) {
    voci.push({ name: "Frais d'envoi", amount: opts.shippingCents });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: voci.map((v) => ({
      price_data: { currency: "eur", product_data: { name: v.name }, unit_amount: v.amount },
      quantity: 1,
    })),
    metadata: { gift_card_id: opts.giftCardId },
    success_url: `${opts.siteUrl}/order-confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.siteUrl}/order-cancel`,
  });
  if (!session.url) throw new Error("Stripe non ha restituito un URL di checkout");
  return session.url;
}
