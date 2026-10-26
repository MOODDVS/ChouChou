import Stripe from "stripe";
// La lingua di DEFAULT del sito pubblico e' una scelta del cliente
// (src/i18n/ui.ts, file per-cliente): il motore la legge invece di dare per
// scontato che sia il francese e che l'unica altra lingua sia l'inglese.
import { defaultLang } from "../i18n/ui";
import { prefissoLingua } from "./linguaUrl";
import { leggiSegreto, type Ambito } from "./admin/sede";
/* ⚠️ La valuta dell'incasso NON si scrive qui. Era `"eur"` a mano in quattro
   punti, e tre su quattro e' il modo in cui un pagamento parte nella moneta
   sbagliata. Vedi `lib/valuta.ts` per cosa va verificato con Stripe prima di
   accendere un cliente fuori dall'euro. */
import { valutaStripe } from "./valuta";


/**
 * IL CLIENT STRIPE E' PER SEDE — perche' il conto e' della SOCIETA'.
 *
 * Tre pizzerie a Bruxelles, tre societa' diverse, un solo sito e un solo
 * deploy. La chiave segreta non puo' piu' essere una costante del `.env`:
 * sceglierne una a caso vorrebbe dire incassare su un'altra societa', e non
 * lo scoprirebbe nessuno fino al commercialista.
 *
 * ⚠️ L'ambito che conta e' QUELLO DEL DATO. Chi incassa lo decide l'ordine
 * (`ambitoDiRiga(ordine.location_id)`), non la sede selezionata nell'header
 * da chi sta guardando lo schermo. Vedi la nota lunga in `admin/sede.ts`.
 *
 * ⚠️ Niente piu' `export const stripe`: era un Proxy sincrono, e con le
 * chiavi nel database la costruzione e' diventata asincrona. Ma il motivo
 * vero e' un altro — un oggetto globale gia' pronto e' un oggetto che si usa
 * senza dire di chi e', ed e' esattamente l'errore che questo pezzo esiste
 * per rendere impossibile. Adesso il conto si nomina, sempre.
 */
const CLIENTI = new Map<string, Stripe>();

export async function stripeDi(ambito: Ambito): Promise<Stripe> {
  const chiave = await leggiSegreto(ambito, "stripe_secret_key");
  if (!chiave) {
    throw new Error(
      ambito.modo === "sede"
        ? "Chiave Stripe mancante: mettila in Super admin > Sedi, oppure STRIPE_SECRET_KEY nel .env"
        : "STRIPE_SECRET_KEY mancante nel file .env",
    );
  }
  // ⚠️ La mappa e' indicizzata sulla CHIAVE, non sull'id della sede: cosi'
  // una chiave ruotata produce da sola un client nuovo, senza che nessuno si
  // ricordi di svuotare niente. (Il segreto ha gia' la sua cache da 60 s in
  // `leggiSegreto`, quindi qui non si legge il database a ogni chiamata.)
  let c = CLIENTI.get(chiave);
  if (!c) {
    if (CLIENTI.size > 20) CLIENTI.clear(); // tetto: mai crescere all'infinito
    c = new Stripe(chiave);
    CLIENTI.set(chiave, c);
  }
  return c;
}

/** Una riga d'ordine già validata e con prezzo letto dal DB. */
export interface VoceCheckout {
  name: string;
  price_cents: number;
  qty: number;
}

interface CreaSessioneInput {
  /** ⚠️ Di CHI e' l'incasso. Obbligatorio apposta: un parametro facoltativo
   *  e' un parametro dimenticato, e qui dimenticarlo vuol dire i soldi di
   *  una societa' sul conto di un'altra. */
  ambito: Ambito;
  voci: VoceCheckout[];
  orderId: string;
  siteUrl: string;
  /** Lingua della pagina da cui arriva l'ordine (qualunque lingua pubblica). */
  lang?: string;
  // Base URL di ritorno (es. "/demo01") per gli ordini che partono da un
  // template: vince sul prefisso lingua. Assente = comportamento standard.
  returnBase?: string;
  /** Dove torna chi preme «indietro» su Stripe. Assente = `/order-cancel`,
   *  come sempre. ⚠️ Al tavolo NON e' un annullamento: e' un ripensamento
   *  (un piatto in piu', un'altra carta), e la pagina giusta e' il carrello
   *  che aveva davanti, non una pagina che gli dice «commande annulée». */
  cancelUrl?: string;
  /** Dove si torna DOPO aver pagato, se non e' la conferma del ritiro.
   *  L'ordine dal tavolo torna sulla pagina del tavolo (vedi checkout). */
  successUrl?: string;
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
  ambito,
  voci,
  orderId,
  siteUrl,
  lang = defaultLang,
  returnBase,
  cancelUrl,
  successUrl,
  discount,
}: CreaSessioneInput): Promise<string> {
  const sp = await stripeDi(ambito);
  const prefix = prefissoLingua(lang, defaultLang);

  // Sconto coupon → coupon Stripe monouso applicato alla sessione.
  let discounts: { coupon: string }[] | undefined;
  if (discount && discount.amount_cents > 0) {
    const c = await sp.coupons.create({
      amount_off: discount.amount_cents,
      currency: valutaStripe(),
      duration: "once",
      name: discount.label.slice(0, 40) || "Code promo",
    });
    discounts = [{ coupon: c.id }];
  }

  const session = await sp.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: voci.map((v) => ({
      price_data: {
        currency: valutaStripe(),
        product_data: { name: v.name },
        unit_amount: v.price_cents,
      },
      quantity: v.qty,
    })),
    ...(discounts ? { discounts } : {}),
    metadata: { order_id: orderId },
    success_url: successUrl ?? `${siteUrl}${returnBase ?? prefix}/order-confirm?session_id={CHECKOUT_SESSION_ID}${returnBase ? `&lang=${lang}` : ""}`,
    cancel_url: cancelUrl ?? `${siteUrl}${returnBase ?? prefix}/order-cancel${returnBase ? `?lang=${lang}` : ""}`,
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
  /** ⚠️ Di CHI e' l'incasso: vedi la nota su `CreaSessioneInput.ambito`. */
  ambito: Ambito;
  giftCardId: string;
  code: string;
  valueCents: number;
  shippingCents?: number;
  siteUrl: string;
  nomeRistorante: string;
  /** Lingua della pagina da cui si compra. Assente = la lingua di base del
   *  sito, cioe' la radice: e' il comportamento che c'era prima. */
  lang?: string;
}): Promise<string> {
  const voci: { name: string; amount: number }[] = [
    { name: `Bon cadeau ${opts.nomeRistorante} — ${opts.code}`, amount: opts.valueCents },
  ];
  if (opts.shippingCents && opts.shippingCents > 0) {
    voci.push({ name: "Frais d'envoi", amount: opts.shippingCents });
  }
  const session = await (await stripeDi(opts.ambito)).checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: voci.map((v) => ({
      price_data: { currency: valutaStripe(), product_data: { name: v.name }, unit_amount: v.amount },
      quantity: 1,
    })),
    metadata: { gift_card_id: opts.giftCardId },
    // ⚠️ Anche il buono regalo torna nella lingua da cui si e' partiti. Qui
    // l'indirizzo era cucito sulla radice: chi comprava dalla pagina `/en`
    // si ritrovava la conferma in francese. Senza `lang` il risultato e'
    // identico a prima — la radice — quindi per i clienti di oggi non
    // cambia niente finche' non gliela passano.
    success_url: `${opts.siteUrl}${prefissoLingua(opts.lang, defaultLang)}/order-confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.siteUrl}${prefissoLingua(opts.lang, defaultLang)}/order-cancel`,
  });
  if (!session.url) throw new Error("Stripe non ha restituito un URL di checkout");
  return session.url;
}

/**
 * Crea una Checkout Session per il SUPPLEMENTO di un ordine gia' pagato:
 * la DIFFERENZA da incassare dopo una modifica che ha aumentato il totale.
 * metadata.supplement="1" + order_id -> il webhook la riconosce, azzera
 * supplement_due_cents e segna supplement_paid_at, SENZA ritoccare lo stato
 * ne' rimandare le email di conferma (l'ordine e' gia' 'paid').
 */
export async function creaCheckoutSupplemento(opts: {
  /** ⚠️ Di CHI e' l'incasso: vedi la nota su `CreaSessioneInput.ambito`. */
  ambito: Ambito;
  orderId: string;
  diffCents: number;
  numero: string;
  siteUrl: string;
  lang?: string;
  returnBase?: string;
}): Promise<string> {
  const prefix = prefissoLingua(opts.lang, defaultLang);
  // Etichetta mostrata sulla pagina di pagamento Stripe, nella lingua del cliente.
  const SUPPL: Record<string, (n: string) => string> = {
    fr: (n) => `Commande #${n} — supplément`,
    en: (n) => `Order #${n} — extra`,
    it: (n) => `Ordine #${n} — supplemento`,
    nl: (n) => `Bestelling #${n} — supplement`,
    es: (n) => `Pedido #${n} — suplemento`,
  };
  const label = (SUPPL[String(opts.lang ?? "")] ?? SUPPL[defaultLang] ?? SUPPL.fr)(opts.numero);
  const session = await (await stripeDi(opts.ambito)).checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: { currency: valutaStripe(), product_data: { name: label }, unit_amount: opts.diffCents },
        quantity: 1,
      },
    ],
    metadata: { order_id: opts.orderId, supplement: "1" },
    success_url: `${opts.siteUrl}${opts.returnBase ?? prefix}/order-confirm?session_id={CHECKOUT_SESSION_ID}${opts.returnBase ? `&lang=${opts.lang ?? defaultLang}` : ""}`,
    cancel_url: `${opts.siteUrl}${opts.returnBase ?? prefix}/order-cancel${opts.returnBase ? `?lang=${opts.lang ?? defaultLang}` : ""}`,
  });
  if (!session.url) throw new Error("Stripe non ha restituito un URL di checkout");
  return session.url;
}

/**
 * Crea una Checkout Session per PAGARE (una parte del) CONTO APERTO al tavolo
 * (fase 4, #88). `metadata.tab_payment_id` -> il webhook segna pagata la riga
 * di `table_payments`, e se il conto e' saldato lo chiude.
 *
 * ⚠️ `expiresAt` e' la fine della PRENOTAZIONE dell'importo (`hold_until`):
 * finche' la sessione si puo' pagare, nessun altro al tavolo ripaga la stessa
 * parte. Stripe la vuole fra 30 minuti e 24 ore da adesso.
 */
export async function creaCheckoutConto(opts: {
  /** ⚠️ Di CHI e' l'incasso: vedi la nota su `CreaSessioneInput.ambito`. */
  ambito: Ambito;
  pagamentoId: string;
  voci: VoceCheckout[];
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  email?: string;
}): Promise<{ url: string; id: string }> {
  const session = await (await stripeDi(opts.ambito)).checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: opts.voci.map((v) => ({
      price_data: { currency: valutaStripe(), product_data: { name: v.name }, unit_amount: v.price_cents },
      quantity: v.qty,
    })),
    metadata: { tab_payment_id: opts.pagamentoId },
    expires_at: Math.floor(opts.expiresAt.getTime() / 1000),
    ...(opts.email ? { customer_email: opts.email } : {}),
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe non ha restituito un URL di checkout");
  return { url: session.url, id: session.id };
}

/**
 * L'INCASSO COL QR (26/10/2026): il cameriere (o la cassa) mostra un QR, il
 * cliente lo inquadra col telefono e paga uno o piu' ordini DA INCASSARE
 * (`pending` + `onsite`) di un tavolo. Una riga sola, il totale del tavolo:
 * e' il conto di quel tavolo, non un nuovo ordine.
 * `metadata.incasso_ordini` (gli id separati da virgola) -> il webhook li
 * segna pagati (`lib/incassoQr.ts`) SENZA riannunciarli: la comanda e' gia'
 * uscita, e un secondo annuncio vorrebbe dire una seconda email in cucina.
 * ⚠️ Scade da sola dopo 30 minuti (il minimo di Stripe): un QR rimasto su uno
 * schermo non deve incassare domani un tavolo di oggi.
 */
export async function creaCheckoutIncasso(opts: {
  ambito: Ambito;
  ordini: string[];
  /** Il palmare: la seduta da chiudere quando arriva il pagamento. */
  chiudiSeduta?: string;
  nome: string;
  totaleCents: number;
  /** Dove torna il telefono del cliente: la pagina del motore `/paiement/ok`
   *  (non del sito del cliente, quindi senza lingua nell'indirizzo). */
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; id: string }> {
  const session = await (await stripeDi(opts.ambito)).checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: { currency: valutaStripe(), product_data: { name: opts.nome }, unit_amount: opts.totaleCents },
      quantity: 1,
    }],
    metadata: { incasso_ordini: opts.ordini.join(","), ...(opts.chiudiSeduta ? { chiudi_seduta: opts.chiudiSeduta } : {}) },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe non ha restituito un URL di checkout");
  return { url: session.url, id: session.id };
}
