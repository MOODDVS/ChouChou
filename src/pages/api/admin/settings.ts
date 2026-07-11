import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// Riga oraria di un giorno, come viaggia tra admin e API.
// Due fasce: Midi (lunch_*) e Soir (dinner_*).
// Giornata continua = solo lunch attiva. Chiuso = entrambe spente.
interface GiornoInput {
  day_of_week: number; // 0=domenica ... 6=sabato
  lunch_active: boolean;
  lunch_open: string | null; // "HH:MM"
  lunch_close: string | null;
  dinner_active: boolean;
  dinner_open: string | null;
  dinner_close: string | null;
}

const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function fasciaValida(open: string | null, close: string | null): boolean {
  return !!open && !!close && RE_ORA.test(open) && RE_ORA.test(close) && open < close;
}

// GET /api/admin/settings — orari dei 7 giorni + prep/slot + email cucina
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data: days, error } = await supabaseAdmin
    .from("settings")
    .select(
      "day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close, prep_time_minutes, slot_duration_minutes"
    )
    .order("day_of_week", { ascending: true });

  if (error || !days) {
    return json({ error: "Lecture impossible" }, 500);
  }

  const { data: cfg } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", "kitchen_email")
    .maybeSingle();

  return json({
    days,
    prep_time_minutes: days[0]?.prep_time_minutes ?? 30,
    slot_duration_minutes: days[0]?.slot_duration_minutes ?? 15,
    kitchen_email: cfg?.value ?? "",
  });
};

// PUT /api/admin/settings — salva orari (2 fasce) + prep/slot + email cucina
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: {
    days?: GiornoInput[];
    prep_time_minutes?: number;
    slot_duration_minutes?: number;
    kitchen_email?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  // --- Validazione ---
  if (!Array.isArray(body.days) || body.days.length !== 7) {
    return json({ error: "7 jours requis" }, 400);
  }
  const prep = Math.floor(Number(body.prep_time_minutes));
  const slot = Math.floor(Number(body.slot_duration_minutes));
  if (!Number.isFinite(prep) || prep < 0 || prep > 240) {
    return json({ error: "Préparation invalide (0–240 min)" }, 400);
  }
  if (!Number.isFinite(slot) || slot < 5 || slot > 120) {
    return json({ error: "Durée créneau invalide (5–120 min)" }, 400);
  }
  const email = String(body.kitchen_email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Email cuisine invalide" }, 400);
  }

  const NOMI = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const visti = new Set<number>();
  for (const g of body.days) {
    if (typeof g.day_of_week !== "number" || g.day_of_week < 0 || g.day_of_week > 6 || visti.has(g.day_of_week)) {
      return json({ error: "Jour invalide ou dupliqué" }, 400);
    }
    visti.add(g.day_of_week);
    const nome = NOMI[g.day_of_week];

    if (g.lunch_active && !fasciaValida(g.lunch_open, g.lunch_close)) {
      return json({ error: `Heures Midi invalides (${nome})` }, 400);
    }
    if (g.dinner_active && !fasciaValida(g.dinner_open, g.dinner_close)) {
      return json({ error: `Heures Soir invalides (${nome})` }, 400);
    }
    // Soir senza Midi non ha senso nel modello "continu/coupé"
    if (g.dinner_active && !g.lunch_active) {
      return json({ error: `Soir sans Midi (${nome})` }, 400);
    }
    // Le due fasce non devono sovrapporsi
    if (g.lunch_active && g.dinner_active && g.lunch_close! >= g.dinner_open!) {
      return json({ error: `Midi et Soir se chevauchent (${nome})` }, 400);
    }
  }

  // --- Salvataggio: una update per giorno ---
  for (const g of body.days) {
    const { error } = await supabaseAdmin
      .from("settings")
      .update({
        lunch_active: g.lunch_active,
        lunch_open: g.lunch_active ? g.lunch_open : null,
        lunch_close: g.lunch_active ? g.lunch_close : null,
        dinner_active: g.dinner_active,
        dinner_open: g.dinner_active ? g.dinner_open : null,
        dinner_close: g.dinner_active ? g.dinner_close : null,
        prep_time_minutes: prep,
        slot_duration_minutes: slot,
      })
      .eq("day_of_week", g.day_of_week);
    if (error) {
      return json({ error: "Enregistrement impossible" }, 500);
    }
  }

  if (email) {
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "kitchen_email", value: email });
    if (error) {
      return json({ error: "Email cuisine non enregistrée" }, 500);
    }
  }

  return json({ ok: true });
};
