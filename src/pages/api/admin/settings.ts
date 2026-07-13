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

// Link gestiti dal tab "Liens" (salvati in app_config come link_<chiave>)
const CHIAVI_LINK = ["facebook", "instagram", "tiktok", "linkedin", "x", "google_review"];

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

  const { data: cfgRows } = await supabaseAdmin
    .from("app_config")
    .select("key, value")
    .in("key", ["kitchen_email", "orders_closed", ...CHIAVI_LINK.map((k) => "link_" + k)]);
  const cfg = new Map((cfgRows ?? []).map((r) => [r.key, r.value ?? ""]));
  const links: Record<string, string> = {};
  for (const k of CHIAVI_LINK) links[k] = cfg.get("link_" + k) ?? "";

  return json({
    days,
    prep_time_minutes: days[0]?.prep_time_minutes ?? 30,
    slot_duration_minutes: days[0]?.slot_duration_minutes ?? 15,
    kitchen_email: cfg.get("kitchen_email") ?? "",
    orders_closed: cfg.get("orders_closed") === "1",
    links,
  });
};

// PATCH /api/admin/settings — aggiornamenti rapidi dalla pagina Commandes:
// - { prep_time_minutes } dai bottoni coniglio/cane/tartaruga
// - { orders_closed } dal bottone "Fermer" (chiude le commandes online)
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { prep_time_minutes?: number; orders_closed?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const vuoleChiusura = typeof body.orders_closed === "boolean";
  const vuolePrep = body.prep_time_minutes !== undefined;
  if (!vuoleChiusura && !vuolePrep) {
    return json({ error: "Requête invalide" }, 400);
  }

  // Toggle chiusura ordini online (app_config.orders_closed = "1"/"0").
  // Può arrivare assieme a prep_time_minutes: scegliere un tempo riapre.
  if (vuoleChiusura) {
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "orders_closed", value: body.orders_closed ? "1" : "0" }, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }

  if (vuolePrep) {
    const prep = Math.floor(Number(body.prep_time_minutes));
    if (!Number.isFinite(prep) || prep < 0 || prep > 240) {
      return json({ error: "Préparation invalide (0–240 min)" }, 400);
    }

    const { error } = await supabaseAdmin
      .from("settings")
      .update({ prep_time_minutes: prep })
      .gte("day_of_week", 0); // tutti i giorni (PostgREST vuole un filtro)

    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }

  return json({ ok: true });
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
    links?: Record<string, string>;
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
  // Più indirizzi separati da virgola: valido ciascuno, salvo normalizzato.
  const listaEmail = String(body.kitchen_email ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  for (const e of listaEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return json({ error: `Email cuisine invalide : ${e}` }, 400);
    }
  }
  const email = listaEmail.join(", ");

  // Link (tab Liens): vuoto ok, altrimenti deve essere un URL http(s)
  const linkPuliti: [string, string][] = [];
  if (body.links && typeof body.links === "object") {
    for (const k of CHIAVI_LINK) {
      const v = String((body.links as Record<string, unknown>)[k] ?? "").trim();
      if (v && !/^https?:\/\/.+/i.test(v)) {
        return json({ error: `Lien invalide (${k}) : il doit commencer par https://` }, 400);
      }
      linkPuliti.push(["link_" + k, v]);
    }
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

  for (const [key, value] of linkPuliti) {
    const { error } = await supabaseAdmin.from("app_config").upsert({ key, value });
    if (error) {
      return json({ error: "Liens non enregistrés" }, 500);
    }
  }

  return json({ ok: true });
};
