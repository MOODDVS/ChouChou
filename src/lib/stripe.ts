import Stripe from "stripe";

const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY mancante nel file .env");
}

/**
 * Client Stripe lato SERVER.
 * Usa la secret key: solo in endpoint API / codice server, mai nel browser.
 */
export const stripe = new Stripe(STRIPE_SECRET_KEY);

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
}: CreaSessioneInput): Promise<string> {
  // Prefisso lingua per gli URL di ritorno: EN sotto /en/, FR senza prefisso.
  const prefix = lang === "en" ? "/en" : "";
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
    metadata: { order_id: orderId },
    success_url: `${siteUrl}${prefix}/order-confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${prefix}/order-cancel`,
  });

  if (!session.url) {
    throw new Error("Stripe non ha restituito un URL di checkout");
  }
  return session.url;
}