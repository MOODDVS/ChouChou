// ============================================================
// Logica coupon CONDIVISA fra:
//  - /api/coupon        (validazione live nel checkout, feedback al cliente)
//  - /api/checkout      (ri-validazione autorevole + calcolo dello sconto
//                        incassato: MAI fidarsi del valore mandato dal browser)
// Un solo punto di verità, come pricing.ts per i prezzi.
// ============================================================
import type { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Lang = "fr" | "en" | "it" | "nl" | "es";

// Riga della tabella `coupons` (vedi supabase/coupons.sql).
export interface CouponRow {
  id: string;
  code: string;
  code_norm: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  max_discount_cents: number | null;
  min_spend_cents: number | null;
  schedule_kind: "always" | "dates" | "weekly";
  date_start: string | null;
  date_end: string | null;
  days: number[] | null;
  hour_start: string | null;
  hour_end: string | null;
  per_customer_limit: number | null;
  global_limit: number | null;
  categories: string[];
  combine_with_promo: "stack" | "exclude" | "block";
  new_customers_only: boolean;
  active: boolean;
}

// Una riga di carrello vista dal coupon: prezzo UNITARIO effettivo (già
// scontato dai prezzi promo del menu), se è un piatto in promo, la sezione
// e la quantità.
export interface LineaCoupon {
  price_cents: number;
  is_promo: boolean;
  category: string;
  qty: number;
}

export interface RisultatoSconto {
  discount_cents: number;
  error?: string;
}

/** Normalizza il codice per il confronto: minuscolo, senza spazi ai bordi. */
export function normalizzaCodice(code: string): string {
  return String(code ?? "").trim().toLowerCase();
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/**
 * Messaggi mostrati al CLIENTE nelle 5 lingue pubbliche. Prima erano coppie
 * fr/en scritte a mano: qualunque altra lingua finiva in francese.
 */
export interface TestiCoupon {
  inserisciCodice: string;
  carrelloVuoto: string;
  nonValido: string;
  nonOggi: string;
  nonOra: string;
  minSpesa: (importo: string) => string;
  nonCumulabile: string;
  nonSiApplica: string;
  limiteRaggiunto: string;
  soloNuovi: string;
  giaUsato: string;
}
const TXT_COUPON: Record<Lang, TestiCoupon> = {
  fr: {
    inserisciCodice: "Entrez un code.",
    carrelloVuoto: "Votre panier est vide.",
    nonValido: "Code promo non valide.",
    nonOggi: "Ce code n'est pas valable aujourd'hui.",
    nonOra: "Ce code n'est pas valable en ce moment.",
    minSpesa: (v) => `Minimum ${v} de commande pour ce code.`,
    nonCumulabile: "Code non cumulable avec une promotion en cours.",
    nonSiApplica: "Ce code ne s'applique pas à votre panier.",
    limiteRaggiunto: "Ce code promo a atteint sa limite d'utilisation.",
    soloNuovi: "Ce code est réservé aux nouveaux clients.",
    giaUsato: "Vous avez déjà utilisé ce code promo.",
  },
  en: {
    inserisciCodice: "Enter a code.",
    carrelloVuoto: "Your cart is empty.",
    nonValido: "Invalid promo code.",
    nonOggi: "This code isn't valid today.",
    nonOra: "This code isn't valid right now.",
    minSpesa: (v) => `Minimum order of ${v} for this code.`,
    nonCumulabile: "Code can't be combined with an ongoing promotion.",
    nonSiApplica: "This code doesn't apply to your cart.",
    limiteRaggiunto: "This promo code has reached its usage limit.",
    soloNuovi: "This code is for new customers only.",
    giaUsato: "You've already used this promo code.",
  },
  it: {
    inserisciCodice: "Inserisci un codice.",
    carrelloVuoto: "Il carrello è vuoto.",
    nonValido: "Codice promo non valido.",
    nonOggi: "Questo codice non è valido oggi.",
    nonOra: "Questo codice non è valido in questo momento.",
    minSpesa: (v) => `Ordine minimo di ${v} per questo codice.`,
    nonCumulabile: "Codice non cumulabile con una promozione in corso.",
    nonSiApplica: "Questo codice non si applica al tuo carrello.",
    limiteRaggiunto: "Questo codice promo ha raggiunto il limite di utilizzi.",
    soloNuovi: "Questo codice è riservato ai nuovi clienti.",
    giaUsato: "Hai già usato questo codice promo.",
  },
  nl: {
    inserisciCodice: "Voer een code in.",
    carrelloVuoto: "Je winkelmandje is leeg.",
    nonValido: "Ongeldige kortingscode.",
    nonOggi: "Deze code is vandaag niet geldig.",
    nonOra: "Deze code is op dit moment niet geldig.",
    minSpesa: (v) => `Minimaal ${v} bestellen voor deze code.`,
    nonCumulabile: "Code niet combineerbaar met een lopende actie.",
    nonSiApplica: "Deze code geldt niet voor je winkelmandje.",
    limiteRaggiunto: "Deze kortingscode heeft zijn gebruikslimiet bereikt.",
    soloNuovi: "Deze code is alleen voor nieuwe klanten.",
    giaUsato: "Je hebt deze kortingscode al gebruikt.",
  },
  es: {
    inserisciCodice: "Introduce un código.",
    carrelloVuoto: "Tu carrito está vacío.",
    nonValido: "Código promocional no válido.",
    nonOggi: "Este código no es válido hoy.",
    nonOra: "Este código no es válido en este momento.",
    minSpesa: (v) => `Pedido mínimo de ${v} para este código.`,
    nonCumulabile: "Código no acumulable con una promoción en curso.",
    nonSiApplica: "Este código no se aplica a tu carrito.",
    limiteRaggiunto: "Este código promocional ha alcanzado su límite de uso.",
    soloNuovi: "Este código es solo para nuevos clientes.",
    giaUsato: "Ya has usado este código promocional.",
  },
};

/** Testi nella lingua data; ripiego esplicito sul francese. Accetta qualunque
 *  stringa, così chi chiama non deve restringere prima. */
export function testiCoupon(lang: string | null | undefined): TestiCoupon {
  return TXT_COUPON[(lang ?? "") as Lang] ?? TXT_COUPON.fr;
}

/**
 * Calcola lo sconto in centesimi per un coupon su un carrello.
 * PURA (niente DB): schedule, categorie, cumulabilità, spesa minima, tetto,
 * clamp. I limiti d'uso (per cliente / globale / nuovi clienti) sono in
 * verificaLimitiUso() perché richiedono query sugli ordini.
 */
export function calcolaScontoCoupon(
  coupon: CouponRow,
  linee: LineaCoupon[],
  now: DateTime,
  lang: string = "fr"
): RisultatoSconto {
  if (!coupon.active) {
    return { discount_cents: 0, error: testiCoupon(lang).nonValido };
  }

  // ---- Programmazione (sempre / date / giorni+ore) ----
  if (coupon.schedule_kind === "dates") {
    const oggi = now.toISODate();
    if (!oggi || (coupon.date_start && oggi < coupon.date_start) || (coupon.date_end && oggi > coupon.date_end)) {
      return { discount_cents: 0, error: testiCoupon(lang).nonOggi };
    }
  } else if (coupon.schedule_kind === "weekly") {
    const jsDay = now.weekday % 7; // luxon: 1=lun..7=dom → 0=dom..6=sab
    const oraOk =
      !coupon.hour_start ||
      !coupon.hour_end ||
      (now.toFormat("HH:mm") >= coupon.hour_start && now.toFormat("HH:mm") <= coupon.hour_end);
    const giornoOk = Array.isArray(coupon.days) && coupon.days.includes(jsDay);
    if (!giornoOk || !oraOk) {
      return { discount_cents: 0, error: testiCoupon(lang).nonOra };
    }
  }

  // ---- Totale carrello (per la spesa minima) ----
  const totaleCarrello = linee.reduce((s, l) => s + l.price_cents * l.qty, 0);
  if (coupon.min_spend_cents && totaleCarrello < coupon.min_spend_cents) {
    return {
      discount_cents: 0,
      error: testiCoupon(lang).minSpesa(euro(coupon.min_spend_cents)),
    };
  }

  // ---- Righe idonee: filtro per categoria, poi cumulabilità con le promo ----
  let idonee = coupon.categories.length > 0 ? linee.filter((l) => coupon.categories.includes(l.category)) : linee.slice();

  if (coupon.combine_with_promo === "block" && idonee.some((l) => l.is_promo)) {
    return {
      discount_cents: 0,
      error: testiCoupon(lang).nonCumulabile,
    };
  }
  if (coupon.combine_with_promo === "exclude") {
    idonee = idonee.filter((l) => !l.is_promo);
  }

  const subtotaleIdoneo = idonee.reduce((s, l) => s + l.price_cents * l.qty, 0);

  // ---- Calcolo dello sconto ----
  let sconto =
    coupon.discount_type === "percent"
      ? Math.round((subtotaleIdoneo * Math.min(coupon.discount_value, 100)) / 100)
      : coupon.discount_value;

  if (coupon.max_discount_cents && coupon.max_discount_cents > 0) {
    sconto = Math.min(sconto, coupon.max_discount_cents);
  }
  sconto = Math.max(0, Math.min(sconto, subtotaleIdoneo));

  if (sconto <= 0) {
    return {
      discount_cents: 0,
      error: testiCoupon(lang).nonSiApplica,
    };
  }

  return { discount_cents: sconto };
}

/**
 * Verifica i limiti d'uso che richiedono il DB (conteggio ordini `paid`):
 * limite globale, limite per cliente (per email), solo nuovi clienti.
 * Ritorna un messaggio d'errore oppure null se tutto ok.
 * Se l'email è vuota, i controlli legati all'email vengono saltati (il
 * checkout li rifà con l'email reale).
 */
export async function verificaLimitiUso(
  coupon: CouponRow,
  email: string,
  supabase: SupabaseClient,
  lang: string = "fr"
): Promise<string | null> {
  const emailNorm = String(email ?? "").trim().toLowerCase();

  // Limite globale (tutti i clienti)
  if (coupon.global_limit && coupon.global_limit > 0) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("coupon_id", coupon.id);
    if ((count ?? 0) >= coupon.global_limit) {
      return testiCoupon(lang).limiteRaggiunto;
    }
  }

  if (!emailNorm) return null;

  // Solo nuovi clienti: nessun ordine pagato in precedenza con questa email
  if (coupon.new_customers_only) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .ilike("customer_email", emailNorm);
    if ((count ?? 0) > 0) {
      return testiCoupon(lang).soloNuovi;
    }
  }

  // Limite per cliente
  if (coupon.per_customer_limit && coupon.per_customer_limit > 0) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("coupon_id", coupon.id)
      .ilike("customer_email", emailNorm);
    if ((count ?? 0) >= coupon.per_customer_limit) {
      return testiCoupon(lang).giaUsato;
    }
  }

  return null;
}
