import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { SERVIZI_WIDGET, LINGUE_WIDGET } from "../../../lib/reservationI18n";

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

// Informazioni del tab "Général" (salvate in app_config con la loro chiave)
const CHIAVI_GENERAL = [
  "company_name",
  "restaurant_name",          // nome pubblico del locale (insegna)
  "company_street",
  "company_zip",
  "company_city",
  "company_country",
  "company_vat",
  "company_iban",
  "public_phone",
  "public_email",
  "contact_emails",
  "newsletter_from_email",
  "whatsapp_number",
  "timezone",                 // fuso orario del ristorante (IANA, es. Europe/Brussels)
  "brand_logo",               // URL loghi + favicon (bucket Storage "brand")
  "brand_logo_negative",
  "brand_logo_mono",
  "brand_favicon",
];
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Impostazioni del tab "Réservations" (V1: capienza semplice, niente tavoli)
const CHIAVI_RESA = [
  "reservation_zones",        // sezioni della sala: JSON [{name, seats}]
  "reservation_min_notice_minutes", // minuti minimi di preavviso per prenotare (0 = nessuno)
  "reservation_zone_choice",  // "1" il cliente sceglie la sezione, "0" no
  "reservation_max_people",   // massimo di persone accettato dal widget
  "reservation_services",     // fasce prenotabili: JSON [{key, from, to, hold, slot}] max 3
  "reservation_corner_style", // angoli del widget: "rounded" | "square"
  "reservation_languages",    // lingue attive sul widget: JSON ["fr","en",…]
  "reservation_from_email",   // mittente delle conferme al cliente
  "reservation_notify_email", // dove arrivano le richieste
];

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
    .in("key", [
      "kitchen_email",
      "orders_closed",
      "daily_brief_enabled",
      "daily_brief_hour",
      "daily_brief_email",
      // legacy: durée/créneau globali e délai in ore, solo per il prefill
      "reservation_hold_minutes",
      "reservation_slot_minutes",
      "reservation_min_notice_hours",
      ...CHIAVI_LINK.map((k) => "link_" + k),
      ...CHIAVI_GENERAL,
      ...CHIAVI_RESA,
    ]);
  const cfg = new Map((cfgRows ?? []).map((r) => [r.key, r.value ?? ""]));
  const links: Record<string, string> = {};
  for (const k of CHIAVI_LINK) links[k] = cfg.get("link_" + k) ?? "";
  const general: Record<string, string> = {};
  for (const k of CHIAVI_GENERAL) general[k] = cfg.get(k) ?? "";
  const reservations: Record<string, string> = {};
  for (const k of CHIAVI_RESA) reservations[k] = cfg.get(k) ?? "";
  reservations["reservation_hold_minutes"] = cfg.get("reservation_hold_minutes") ?? "";
  reservations["reservation_slot_minutes"] = cfg.get("reservation_slot_minutes") ?? "";
  reservations["reservation_min_notice_hours"] = cfg.get("reservation_min_notice_hours") ?? "";

  return json({
    days,
    prep_time_minutes: days[0]?.prep_time_minutes ?? 30,
    slot_duration_minutes: days[0]?.slot_duration_minutes ?? 15,
    kitchen_email: cfg.get("kitchen_email") ?? "",
    orders_closed: cfg.get("orders_closed") === "1",
    daily_brief_enabled: cfg.get("daily_brief_enabled") === "1",
    daily_brief_hour: cfg.get("daily_brief_hour") || "09:00",
    daily_brief_email: cfg.get("daily_brief_email") ?? "",
    links,
    general,
    reservations,
  });
};

// PATCH /api/admin/settings — aggiornamenti rapidi dalla pagina Commandes:
// - { prep_time_minutes } dai bottoni coniglio/cane/tartaruga
// - { orders_closed } dal bottone "Fermer" (chiude le commandes online)
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { prep_time_minutes?: number; orders_closed?: boolean; daily_brief_enabled?: boolean; daily_brief_hour?: string; daily_brief_email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const vuoleChiusura = typeof body.orders_closed === "boolean";
  const vuolePrep = body.prep_time_minutes !== undefined;
  const vuoleBrief = typeof body.daily_brief_enabled === "boolean";
  const vuoleBriefOra = typeof body.daily_brief_hour === "string";
  const vuoleBriefEmail = typeof body.daily_brief_email === "string";
  if (!vuoleChiusura && !vuolePrep && !vuoleBrief && !vuoleBriefOra && !vuoleBriefEmail) {
    return json({ error: "Requête invalide" }, 400);
  }

  // Ora d'invio dell'email quotidienne (HH:MM, fuso del ristorante)
  if (vuoleBriefOra) {
    const ora = String(body.daily_brief_hour).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ora)) return json({ error: "Heure invalide" }, 400);
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "daily_brief_hour", value: ora }, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }

  // Destinatario dell'email quotidienne (vuoto = default réservations)
  if (vuoleBriefEmail) {
    const em = String(body.daily_brief_email).trim();
    if (em && !RE_EMAIL.test(em)) return json({ error: `Email invalide : ${em}` }, 400);
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "daily_brief_email", value: em }, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }

  // Toggle email "Votre journée" (récap quotidiano delle 9h00)
  if (vuoleBrief) {
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "daily_brief_enabled", value: body.daily_brief_enabled ? "1" : "0" }, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
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
    general?: Record<string, string>;
    reservations?: Record<string, string>;
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

  // Tab Général: testi liberi + email validate
  const generalPulito: [string, string][] = [];
  if (body.general && typeof body.general === "object") {
    for (const k of CHIAVI_GENERAL) {
      const v = String((body.general as Record<string, unknown>)[k] ?? "").trim();
      if (k === "contact_emails" && v) {
        for (const e of v.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!RE_EMAIL.test(e)) return json({ error: `Email contact invalide : ${e}` }, 400);
        }
      }
      if ((k === "newsletter_from_email" || k === "public_email") && v && !RE_EMAIL.test(v)) {
        return json({ error: `Email invalide : ${v}` }, 400);
      }
      if (k === "timezone" && v) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
        } catch {
          return json({ error: `Fuseau horaire invalide : ${v}` }, 400);
        }
      }
      generalPulito.push([k, v]);
    }
  }

  // Tab Réservations: numeri e email validati
  const resaPulito: [string, string][] = [];
  if (body.reservations && typeof body.reservations === "object") {
    for (const k of CHIAVI_RESA) {
      let v = String((body.reservations as Record<string, unknown>)[k] ?? "").trim();
      if (k === "reservation_zones" && v) {
        // JSON [{name, seats}]: nomi non vuoti, posti 1-500, max 20 sezioni
        let zone: { name?: unknown; seats?: unknown }[];
        try {
          zone = JSON.parse(v);
        } catch {
          return json({ error: "Sections invalides" }, 400);
        }
        if (!Array.isArray(zone) || zone.length > 20) {
          return json({ error: "Sections invalides (max 20)" }, 400);
        }
        const pulite: { name: string; seats: number }[] = [];
        for (const z of zone) {
          const name = String(z.name ?? "").trim();
          const seats = Math.floor(Number(z.seats));
          if (!name) return json({ error: "Chaque section doit avoir un nom" }, 400);
          if (!Number.isFinite(seats) || seats < 1 || seats > 500) {
            return json({ error: `Couverts invalides pour « ${name} » (1–500)` }, 400);
          }
          pulite.push({ name, seats });
        }
        v = JSON.stringify(pulite);
      }
      if (k === "reservation_hold_minutes" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 15 || n > 360) {
          return json({ error: "Durée d'occupation invalide (15–360 min)" }, 400);
        }
      }
      if (k === "reservation_slot_minutes" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 10 || n > 120) {
          return json({ error: "Créneau de réservation invalide (10–120 min)" }, 400);
        }
      }
      if (k === "reservation_zone_choice" && v && v !== "0" && v !== "1") {
        return json({ error: "Valeur invalide (choix de section)" }, 400);
      }
      if (k === "reservation_corner_style" && v && v !== "rounded" && v !== "square") {
        return json({ error: "Valeur invalide (style des angles)" }, 400);
      }
      if (k === "reservation_languages" && v) {
        let lista: unknown;
        try {
          lista = JSON.parse(v);
        } catch {
          return json({ error: "Langues invalides" }, 400);
        }
        if (!Array.isArray(lista)) return json({ error: "Langues invalides" }, 400);
        const validi = new Set<string>(LINGUE_WIDGET.map((l) => l.code));
        const scelte = new Set<string>(lista.filter((c): c is string => typeof c === "string" && validi.has(c)));
        scelte.add("fr"); // il francese resta sempre attivo
        v = JSON.stringify(LINGUE_WIDGET.map((l) => l.code).filter((c) => scelte.has(c)));
      }
      if (k === "reservation_min_notice_minutes" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 0 || n > 4320) {
          return json({ error: "Délai minimum invalide (0–4320 minutes)" }, 400);
        }
      }
      if (k === "reservation_max_people" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          return json({ error: "Personnes maximum invalide (1–100)" }, 400);
        }
      }
      if (k === "reservation_services" && v) {
        let lista: unknown;
        try {
          lista = JSON.parse(v);
        } catch {
          return json({ error: "Services invalides" }, 400);
        }
        if (!Array.isArray(lista) || lista.length > 5) {
          return json({ error: "Services invalides (max 5)" }, 400);
        }
        const RE_ORA = /^\d{2}:\d{2}$/;
        const puliti: { key: string; from: string; to: string; hold: number; slot: number; days: number[] }[] = [];
        for (const sv of lista) {
          const key = String((sv as { key?: unknown }).key ?? "").trim();
          if (!SERVIZI_WIDGET[key]) return json({ error: "Service inconnu" }, 400);
          const from = String((sv as { from?: unknown }).from ?? "");
          const to = String((sv as { to?: unknown }).to ?? "");
          if (!RE_ORA.test(from) || !RE_ORA.test(to) || from >= to) {
            return json({ error: `Horaires invalides pour « ${SERVIZI_WIDGET[key].fr} »` }, 400);
          }
          // Durée d'occupation e créneau propri di ogni service
          const hold = Math.floor(Number((sv as { hold?: unknown }).hold));
          if (!Number.isFinite(hold) || hold < 15 || hold > 360) {
            return json({ error: `Durée d'occupation invalide pour « ${SERVIZI_WIDGET[key].fr} » (15–360 min)` }, 400);
          }
          const slot = Math.floor(Number((sv as { slot?: unknown }).slot));
          if (!Number.isFinite(slot) || slot < 10 || slot > 120) {
            return json({ error: `Créneau invalide pour « ${SERVIZI_WIDGET[key].fr} » (10–120 min)` }, 400);
          }
          // Giorni di applicazione (0=dim … 6=sam). Assenti/vuoti = tutti i giorni.
          const giorniRaw = (sv as { days?: unknown }).days;
          const days = Array.isArray(giorniRaw)
            ? Array.from(new Set(giorniRaw.map((d) => Math.floor(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
            : [];
          puliti.push({ key, from, to, hold, slot, days });
        }
        v = JSON.stringify(puliti);
      }
      if ((k === "reservation_from_email" || k === "reservation_notify_email") && v && !RE_EMAIL.test(v)) {
        return json({ error: `Email invalide : ${v}` }, 400);
      }
      resaPulito.push([k, v]);
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

  for (const [key, value] of generalPulito) {
    const { error } = await supabaseAdmin.from("app_config").upsert({ key, value });
    if (error) {
      return json({ error: "Informations générales non enregistrées" }, 500);
    }
  }

  for (const [key, value] of resaPulito) {
    const { error } = await supabaseAdmin.from("app_config").upsert({ key, value });
    if (error) {
      return json({ error: "Réservations non enregistrées" }, 500);
    }
  }

  return json({ ok: true });
};
