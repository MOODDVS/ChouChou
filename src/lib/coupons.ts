// ============================================================
// Logica coupon CONDIVISA fra:
//  - /api/coupon        (validazione live nel checkout, feedback al cliente)
//  - /api/checkout      (ri-validazione autorevole + calcolo dello sconto
//                        incassato: MAI fidarsi del valore mandato dal browser)
// Un solo punto di verità, come pricing.ts per i prezzi.
// ============================================================
import type { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Lang = "fr" | "en";

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

function msg(lang: Lang, fr: string, en: string): string {
  return lang === "en" ? en : fr;
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
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
  lang: Lang = "fr"
): RisultatoSconto {
  if (!coupon.active) {
    return { discount_cents: 0, error: msg(lang, "Code promo non valide.", "Invalid promo code.") };
  }

  // ---- Programmazione (sempre / date / giorni+ore) ----
  if (coupon.schedule_kind === "dates") {
    const oggi = now.toISODate();
    if (!oggi || (coupon.date_start && oggi < coupon.date_start) || (coupon.date_end && oggi > coupon.date_end)) {
      return { discount_cents: 0, error: msg(lang, "Ce code n'est pas valable aujourd'hui.", "This code isn't valid today.") };
    }
  } else if (coupon.schedule_kind === "weekly") {
    const jsDay = now.weekday % 7; // luxon: 1=lun..7=dom → 0=dom..6=sab
    const oraOk =
      !coupon.hour_start ||
      !coupon.hour_end ||
      (now.toFormat("HH:mm") >= coupon.hour_start && now.toFormat("HH:mm") <= coupon.hour_end);
    const giornoOk = Array.isArray(coupon.days) && coupon.days.includes(jsDay);
    if (!giornoOk || !oraOk) {
      return { discount_cents: 0, error: msg(lang, "Ce code n'est pas valable en ce moment.", "This code isn't valid right now.") };
    }
  }

  // ---- Totale carrello (per la spesa minima) ----
  const totaleCarrello = linee.reduce((s, l) => s + l.price_cents * l.qty, 0);
  if (coupon.min_spend_cents && totaleCarrello < coupon.min_spend_cents) {
    return {
      discount_cents: 0,
      error: msg(
        lang,
        `Minimum ${euro(coupon.min_spend_cents)} de commande pour ce code.`,
        `Minimum order of ${euro(coupon.min_spend_cents)} for this code.`
      ),
    };
  }

  // ---- Righe idonee: filtro per categoria, poi cumulabilità con le promo ----
  let idonee = coupon.categories.length > 0 ? linee.filter((l) => coupon.categories.includes(l.category)) : linee.slice();

  if (coupon.combine_with_promo === "block" && idonee.some((l) => l.is_promo)) {
    return {
      discount_cents: 0,
      error: msg(lang, "Code non cumulable avec une promotion en cours.", "Code can't be combined with an ongoing promotion."),
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
      error: msg(lang, "Ce code ne s'applique pas à votre panier.", "This code doesn't apply to your cart."),
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
  lang: Lang = "fr"
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
      return msg(lang, "Ce code promo a atteint sa limite d'utilisation.", "This promo code has reached its usage limit.");
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
      return msg(lang, "Ce code est réservé aux nouveaux clients.", "This code is for new customers only.");
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
      return msg(lang, "Vous avez déjà utilisé ce code promo.", "You've already used this promo code.");
    }
  }

  return null;
}
