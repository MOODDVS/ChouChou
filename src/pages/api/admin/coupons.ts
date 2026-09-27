import type { APIRoute } from "astro";
import { leggi, elencoSedi, tutteLeSedi } from "../../../lib/admin/sede";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { normalizzaCodice } from "../../../lib/coupons";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// CRUD dei codici promo (admin Marketing → Coupons).
// GET    → elenco + numero di utilizzi (ordini paid) per coupon
// POST   → crea
// PUT    → aggiorna (id obbligatorio) — oppure toggle rapido { id, active }
// DELETE → elimina (?id=…)

const KIND_VALIDI = ["always", "dates", "weekly"];
const COMBINE_VALIDI = ["stack", "exclude", "block"];
const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CouponInput {
  id?: string;
  code?: string;
  description?: string;
  discount_type?: string;
  discount_value?: number;
  max_discount_cents?: number | null;
  min_spend_cents?: number | null;
  schedule_kind?: string;
  date_start?: string | null;
  date_end?: string | null;
  days?: number[] | null;
  hour_start?: string | null;
  hour_end?: string | null;
  per_customer_limit?: number | null;
  global_limit?: number | null;
  categories?: string[];
  combine_with_promo?: string;
  new_customers_only?: boolean;
  active?: boolean;
  locations?: string[] | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Intero positivo opzionale (null se vuoto/0). */
function intPosOpz(v: unknown): number | null {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function valida(b: CouponInput): { errore?: string; valori?: Record<string, unknown> } {
  const code = (b.code ?? "").trim().slice(0, 40);
  if (!code) return { errore: "err.codeRequired" };
  const code_norm = normalizzaCodice(code);
  if (!code_norm) return { errore: "err.code" };

  const discount_type = b.discount_type === "fixed" ? "fixed" : "percent";
  const discount_value = Math.floor(Number(b.discount_value));
  if (!Number.isFinite(discount_value) || discount_value <= 0) {
    return { errore: "err.discountPositive" };
  }
  if (discount_type === "percent" && discount_value > 100) {
    return { errore: "err.percent100" };
  }

  const max_discount_cents = intPosOpz(b.max_discount_cents);
  const min_spend_cents =
    b.min_spend_cents == null || Number(b.min_spend_cents) <= 0 ? null : Math.floor(Number(b.min_spend_cents));

  const kind = KIND_VALIDI.includes(b.schedule_kind ?? "") ? b.schedule_kind! : "always";

  let date_start: string | null = null;
  let date_end: string | null = null;
  if (kind === "dates") {
    date_start = (b.date_start ?? "").trim() || null;
    date_end = (b.date_end ?? "").trim() || null;
    if (!date_start || !date_end || !RE_DATA.test(date_start) || !RE_DATA.test(date_end)) {
      return { errore: "err.datesStartEnd" };
    }
    if (date_start > date_end) return { errore: "err.endBeforeStart" };
  }

  let days: number[] | null = null;
  let hour_start: string | null = null;
  let hour_end: string | null = null;
  if (kind === "weekly") {
    days = Array.isArray(b.days)
      ? b.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    if (days.length === 0) return { errore: "err.pickDay" };
    hour_start = (b.hour_start ?? "").trim() || null;
    hour_end = (b.hour_end ?? "").trim() || null;
    if (!hour_start || !hour_end || !RE_ORA.test(hour_start) || !RE_ORA.test(hour_end)) {
      return { errore: "err.hoursStartEnd" };
    }
    if (hour_start >= hour_end) return { errore: "err.endTimeBeforeStart" };
  }

  const categories = Array.isArray(b.categories)
    ? Array.from(new Set(b.categories.map((c) => String(c).trim()).filter(Boolean)))
    : [];

  // LE SEDI in cui il codice vale. Vuoto = tutte, ed e' il valore di tutti i
  // coupon esistenti. Si validano gli uuid perche' finiscono in un array
  // Postgres: un valore storto farebbe fallire l'insert con un errore di
  // sintassi SQL che non dice niente a chi sta compilando un modulo.
  const locations = Array.isArray(b.locations)
    ? Array.from(new Set(b.locations.map((x) => String(x).trim().toLowerCase()).filter((x) => RE_UUID.test(x))))
    : [];

  const combine_with_promo = COMBINE_VALIDI.includes(b.combine_with_promo ?? "")
    ? b.combine_with_promo!
    : "stack";

  return {
    valori: {
      code,
      code_norm,
      description: (b.description ?? "").trim() || null,
      discount_type,
      discount_value,
      max_discount_cents,
      min_spend_cents,
      schedule_kind: kind,
      date_start,
      date_end,
      days,
      hour_start,
      hour_end,
      per_customer_limit: intPosOpz(b.per_customer_limit),
      global_limit: intPosOpz(b.global_limit),
      categories,
      combine_with_promo,
      new_customers_only: b.new_customers_only === true,
      active: b.active !== false,
      locations,
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const { data, error } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return json({ error: await msg("err.read") }, 500);

  // ⚠️ IL CONTEGGIO E' DI TUTTO IL GRUPPO, e deve restarlo.
  //
  // Fino al 16/09/2026 qui c'era l'ambito della richiesta, cioe' la sede
  // selezionata nell'header. Ma il limite d'uso lo fa rispettare
  // `verificaLimitiUso`, che conta gli ordini di TUTTE le sedi: l'admin
  // mostrava un numero e il motore ne applicava un altro. Un codice da 100
  // usato 40 volte a Schaerbeek, 35 a Jourdan e 25 a Stockel appariva come
  // «40 / 100» ed era gia' esaurito — e il ristoratore, convinto di averne
  // 60, non capiva perche' i clienti si vedessero rifiutare il codice.
  //
  // Stesso guasto della pagina Clienti, che mostrava i totali del gruppo e
  // mezzo secondo dopo quelli di un punto. Due conti della stessa cosa
  // divergono sempre; quello giusto e' quello che decide.
  const usi = new Map<string, number>();
  const { data: ordini } = await leggi("orders", tutteLeSedi(), "coupon_id")
    .eq("status", "paid")
    .not("coupon_id", "is", null);
  for (const o of ordini ?? []) {
    if (o.coupon_id) usi.set(o.coupon_id, (usi.get(o.coupon_id) ?? 0) + 1);
  }

  const coupons = (data ?? []).map((c) => ({ ...c, uses: usi.get(c.id) ?? 0 }));
  // L'elenco dei punti viaggia con i coupon: serve a disegnare le caselle
  // del modale e le etichette delle schede, e una chiamata a parte
  // vorrebbe dire due letture per una riga di testo.
  const sedi = (await elencoSedi()).map((s) => ({ id: s.id, name: s.name }));
  return json({ coupons, sedi });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: CouponInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  const v = valida(body);
  if (v.errore) return json({ error: await msg(v.errore) }, 400);

  const { data, error } = await supabaseAdmin.from("coupons").insert(v.valori!).select("id").single();
  if (error) {
    if (error.code === "23505") return json({ error: await msg("err.codeTaken") }, 409);
    return json({ error: await msg("err.save") }, 500);
  }
  return json({ ok: true, id: data.id }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: CouponInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  if (!body.id) return json({ error: await msg("err.idMissing") }, 400);

  // Toggle rapido attivo/pausa: solo { id, active }
  if (body.code === undefined && typeof body.active === "boolean") {
    const { error } = await supabaseAdmin.from("coupons").update({ active: body.active }).eq("id", body.id);
    if (error) return json({ error: await msg("err.save") }, 500);
    return json({ ok: true });
  }

  const v = valida(body);
  if (v.errore) return json({ error: await msg(v.errore) }, 400);

  const { error } = await supabaseAdmin.from("coupons").update(v.valori!).eq("id", body.id);
  if (error) {
    if (error.code === "23505") return json({ error: await msg("err.codeTaken") }, 409);
    return json({ error: await msg("err.save") }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: await msg("err.idMissing") }, 400);

  const { error } = await supabaseAdmin.from("coupons").delete().eq("id", id);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
