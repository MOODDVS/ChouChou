import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";
import { normalizzaCodice } from "../../../lib/coupons";

export const prerender = false;

// CRUD dei codici promo (admin Marketing → Coupons).
// GET    → elenco + numero di utilizzi (ordini paid) per coupon
// POST   → crea
// PUT    → aggiorna (id obbligatorio) — oppure toggle rapido { id, active }
// DELETE → elimina (?id=…)

const KIND_VALIDI = ["always", "dates", "weekly"];
const COMBINE_VALIDI = ["stack", "exclude", "block"];
const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!code) return { errore: "Le code est obligatoire." };
  const code_norm = normalizzaCodice(code);
  if (!code_norm) return { errore: "Code invalide." };

  const discount_type = b.discount_type === "fixed" ? "fixed" : "percent";
  const discount_value = Math.floor(Number(b.discount_value));
  if (!Number.isFinite(discount_value) || discount_value <= 0) {
    return { errore: "La valeur de la réduction doit être positive." };
  }
  if (discount_type === "percent" && discount_value > 100) {
    return { errore: "Le pourcentage ne peut pas dépasser 100." };
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
      return { errore: "Dates de début et de fin obligatoires." };
    }
    if (date_start > date_end) return { errore: "La date de fin précède le début." };
  }

  let days: number[] | null = null;
  let hour_start: string | null = null;
  let hour_end: string | null = null;
  if (kind === "weekly") {
    days = Array.isArray(b.days)
      ? b.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    if (days.length === 0) return { errore: "Choisissez au moins un jour." };
    hour_start = (b.hour_start ?? "").trim() || null;
    hour_end = (b.hour_end ?? "").trim() || null;
    if (!hour_start || !hour_end || !RE_ORA.test(hour_start) || !RE_ORA.test(hour_end)) {
      return { errore: "Heures de début et de fin obligatoires (HH:MM)." };
    }
    if (hour_start >= hour_end) return { errore: "L'heure de fin précède le début." };
  }

  const categories = Array.isArray(b.categories)
    ? Array.from(new Set(b.categories.map((c) => String(c).trim()).filter(Boolean)))
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
  if (error) return json({ error: "Lecture impossible" }, 500);

  // Conteggio utilizzi: ordini pagati con un coupon_id.
  const usi = new Map<string, number>();
  const { data: ordini } = await supabaseAdmin
    .from("orders")
    .select("coupon_id")
    .eq("status", "paid")
    .not("coupon_id", "is", null);
  for (const o of ordini ?? []) {
    if (o.coupon_id) usi.set(o.coupon_id, (usi.get(o.coupon_id) ?? 0) + 1);
  }

  const coupons = (data ?? []).map((c) => ({ ...c, uses: usi.get(c.id) ?? 0 }));
  return json({ coupons });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: CouponInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  const { data, error } = await supabaseAdmin.from("coupons").insert(v.valori!).select("id").single();
  if (error) {
    if (error.code === "23505") return json({ error: "Ce code existe déjà." }, 409);
    return json({ error: "Enregistrement impossible" }, 500);
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
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.id) return json({ error: "id manquant" }, 400);

  // Toggle rapido attivo/pausa: solo { id, active }
  if (body.code === undefined && typeof body.active === "boolean") {
    const { error } = await supabaseAdmin.from("coupons").update({ active: body.active }).eq("id", body.id);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true });
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  const { error } = await supabaseAdmin.from("coupons").update(v.valori!).eq("id", body.id);
  if (error) {
    if (error.code === "23505") return json({ error: "Ce code existe déjà." }, 409);
    return json({ error: "Enregistrement impossible" }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id manquant" }, 400);

  const { error } = await supabaseAdmin.from("coupons").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
