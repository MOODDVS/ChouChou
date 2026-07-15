import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";
import { prezzoEffettivo } from "../../lib/pricing";
import { TIMEZONE } from "../../lib/slots";
import {
  calcolaScontoCoupon,
  verificaLimitiUso,
  normalizzaCodice,
  type CouponRow,
  type LineaCoupon,
  type Lang,
} from "../../lib/coupons";

export const prerender = false;

// Validazione LIVE del codice promo, chiamata dal checkout pubblico quando il
// cliente clicca "Appliquer". Ritorna lo sconto calcolato (solo indicativo:
// /api/checkout ricalcola tutto lato server, non ci si fida di questo valore).
//
// Body: { code, items:[{id,qty}], email?, lang? }
// Risposta OK:  { ok:true, discount_cents, code, label }
// Risposta KO:  { ok:false, error }  (200, con messaggio localizzato)

interface Body {
  code?: string;
  items?: { id: string; qty: number }[];
  email?: string;
  lang?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Requête invalide." }, 400);
  }

  const lang: Lang = body.lang === "en" ? "en" : "fr";
  const codeNorm = normalizzaCodice(body.code ?? "");
  if (!codeNorm) return json({ ok: false, error: lang === "en" ? "Enter a code." : "Entrez un code." });

  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.id) : [];
  if (items.length === 0) {
    return json({ ok: false, error: lang === "en" ? "Your cart is empty." : "Votre panier est vide." });
  }

  const { data: coupon } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("code_norm", codeNorm)
    .maybeSingle();

  const introvabile = lang === "en" ? "Invalid promo code." : "Code promo non valide.";
  if (!coupon) return json({ ok: false, error: introvabile });

  // Costruisce le righe carrello leggendo i prezzi REALI dal DB.
  const ids = items.map((i) => i.id);
  const { data: piatti } = await supabaseAdmin
    .from("menu_items")
    .select("id, category, price_cents, discount_type, discount_value, available")
    .in("id", ids);

  const linee: LineaCoupon[] = [];
  for (const it of items) {
    const p = (piatti ?? []).find((x) => x.id === it.id);
    if (!p || !p.available) continue;
    const eff = prezzoEffettivo(p.price_cents, p.discount_type, p.discount_value);
    linee.push({
      price_cents: eff,
      is_promo: eff < p.price_cents,
      category: p.category,
      qty: Math.max(1, Math.floor(it.qty)),
    });
  }
  if (linee.length === 0) {
    return json({ ok: false, error: lang === "en" ? "Your cart is empty." : "Votre panier est vide." });
  }

  const now = DateTime.now().setZone(TIMEZONE);
  const ris = calcolaScontoCoupon(coupon as CouponRow, linee, now, lang);
  if (ris.error) return json({ ok: false, error: ris.error });

  const limite = await verificaLimitiUso(coupon as CouponRow, body.email ?? "", supabaseAdmin, lang);
  if (limite) return json({ ok: false, error: limite });

  return json({
    ok: true,
    discount_cents: ris.discount_cents,
    code: (coupon as CouponRow).code,
    label: (coupon as CouponRow).description || (coupon as CouponRow).code,
  });
};
