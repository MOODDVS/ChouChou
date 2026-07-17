import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { emailReviewResa, annullaEmailReview } from "../../../lib/notifications";

export const prerender = false;

// Réservations (admin) — V1 semplice.
// GET ?date=YYYY-MM-DD → prenotazioni del giorno (tutte, ordinate per ora)
//                        + couverts = somma persone delle confermate
// GET ?month=YYYY-MM   → per il datepicker: giorni chiusi (horaire +
//                        jours spéciaux) e giorni "fully booked"
// GET ?q=testo         → ricerca per nome / email / telefono (max 100)
// POST → prenotazione MANUALE (walk-in / telefono), subito confermata
// PATCH { id, ... }    → cambio stato E/O modifica completa dei campi

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const STATI = ["confirmed", "cancelled", "noshow", "done"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Ricerca libera: nome, email o telefono
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length >= 2) {
    const pulito = q.replace(/[%,()*]/g, "").slice(0, 60);
    if (!pulito) return json({ reservations: [] });
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .or(
        `first_name.ilike.%${pulito}%,last_name.ilike.%${pulito}%,email.ilike.%${pulito}%,phone.ilike.%${pulito}%`
      )
      .order("date", { ascending: false })
      .order("heure", { ascending: true })
      .limit(100);
    if (error) return json({ reservations: [] });
    return json({ reservations: data ?? [] });
  }

  // Vista mese per il datepicker del modale manuale
  const month = url.searchParams.get("month") ?? "";
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [anno, mese] = month.split("-").map(Number);
    const nGiorni = new Date(anno, mese, 0).getDate();
    const primo = `${month}-01`;
    const ultimo = `${month}-${String(nGiorni).padStart(2, "0")}`;

    const [orari, speciali, cfg, rese] = await Promise.all([
      supabaseAdmin.from("settings").select("day_of_week, lunch_active, dinner_active"),
      supabaseAdmin
        .from("special_days")
        .select("type, date_from, date_to")
        .lte("date_from", ultimo)
        .gte("date_to", primo),
      supabaseAdmin.from("app_config").select("key, value").in("key", ["reservation_services", "reservation_zones"]),
      supabaseAdmin
        .from("reservations")
        .select("date, service_key, people")
        .gte("date", primo)
        .lte("date", ultimo)
        .eq("status", "confirmed"), // Fini/annullate/no-show liberano i tavoli
    ]);

    const apertoSett = new Map<number, boolean>();
    for (const g of orari.data ?? []) {
      apertoSett.set(g.day_of_week, Boolean(g.lunch_active || g.dinner_active));
    }

    const cfgMap = new Map((cfg.data ?? []).map((r) => [r.key, String(r.value ?? "")]));
    let services: { key?: string }[] = [];
    try {
      const arr = JSON.parse(cfgMap.get("reservation_services") || "[]");
      if (Array.isArray(arr)) services = arr;
    } catch { /* nessun service configurato */ }
    // Capacità per servizio = somma dei coperti delle sections (Réglages)
    let capienza = 0;
    try {
      const arr = JSON.parse(cfgMap.get("reservation_zones") || "[]");
      if (Array.isArray(arr)) {
        capienza = arr.reduce((t: number, z: { seats?: unknown }) => {
          const n = Math.floor(Number(z.seats));
          return t + (Number.isFinite(n) && n > 0 ? n : 0);
        }, 0);
      }
    } catch { /* nessuna section: mai completo */ }

    // Coperti per giorno+service (prenotazioni senza service noto: ignorate)
    const coperti = new Map<string, number>();
    for (const r of rese.data ?? []) {
      const k = `${r.date}|${r.service_key ?? ""}`;
      coperti.set(k, (coperti.get(k) ?? 0) + (r.people ?? 0));
    }

    const chiusi: string[] = [];
    const pieni: string[] = [];
    for (let g = 1; g <= nGiorni; g++) {
      const iso = `${month}-${String(g).padStart(2, "0")}`;
      const dow = new Date(anno, mese - 1, g).getDay();
      // Chiusura: jour spécial fermé > jour spécial ouvert > horaire hebdo
      let aperto = apertoSett.get(dow) ?? true;
      for (const sp of speciali.data ?? []) {
        if (iso >= sp.date_from && iso <= sp.date_to && sp.type === "open") aperto = true;
      }
      for (const sp of speciali.data ?? []) {
        if (iso >= sp.date_from && iso <= sp.date_to && sp.type === "closed") aperto = false;
      }
      if (!aperto) {
        chiusi.push(iso);
        continue;
      }
      // Completo: ogni service ha raggiunto la capacità totale della sala
      // (senza services configurati: somma dell'intera giornata)
      if (capienza > 0) {
        const pieno = services.length
          ? services.every((sv) => (coperti.get(`${iso}|${sv.key}`) ?? 0) >= capienza)
          : (rese.data ?? []).filter((r) => r.date === iso).reduce((t, r) => t + (r.people ?? 0), 0) >= capienza;
        if (pieno) pieni.push(iso);
      }
    }
    return json({ closed: chiusi, full: pieni });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);

  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("*")
    .eq("date", date)
    .order("heure", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    // Tabella non ancora creata (migrazione da lanciare): pagina vuota, non rotta
    return json({ reservations: [], couverts: 0, missing: true });
  }

  const couverts = (data ?? [])
    .filter((r) => r.status === "confirmed")
    .reduce((s, r) => s + (r.people ?? 0), 0);

  // Config réservations (Réglages): durata tavolo, créneau, services, sezioni
  let hold = 90;
  let slot = 30;
  let services: { key: string; from: string; to: string }[] = [];
  let zones: string[] = [];
  let capacity = 0;
  const zoneSeats: Record<string, number> = {};
  let tz = "Europe/Brussels";
  try {
    const { data: cfg } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", [
        "reservation_hold_minutes",
        "reservation_slot_minutes",
        "reservation_services",
        "reservation_zones",
        "timezone",
      ]);
    const m = new Map((cfg ?? []).map((r) => [r.key, String(r.value ?? "")]));
    const nH = Math.floor(Number(m.get("reservation_hold_minutes")));
    if (Number.isFinite(nH) && nH >= 15 && nH <= 360) hold = nH;
    const nS = Math.floor(Number(m.get("reservation_slot_minutes")));
    if (Number.isFinite(nS) && nS >= 10 && nS <= 120) slot = nS;
    try {
      const arr = JSON.parse(m.get("reservation_services") || "[]");
      if (Array.isArray(arr)) services = arr;
    } catch { /* vuoto */ }
    try {
      const arr = JSON.parse(m.get("reservation_zones") || "[]");
      if (Array.isArray(arr)) {
        zones = arr.map((z: { name?: string }) => String(z.name ?? "")).filter(Boolean);
        for (const z of arr as { name?: string; seats?: unknown }[]) {
          const nome = String(z.name ?? "");
          const n = Math.floor(Number(z.seats));
          if (nome && Number.isFinite(n) && n > 0) {
            zoneSeats[nome] = n;
            capacity += n;
          }
        }
      }
    } catch { /* vuoto */ }
    const vTz = m.get("timezone") ?? "";
    if (vTz) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: vTz });
        tz = vTz;
      } catch { /* fuso invalido: default */ }
    }
  } catch {
    /* default */
  }
  // Chiusure di servizio e di section del giorno (tabelle assenti = nessuna)
  let closures: { service_key: string; reason: string }[] = [];
  let zoneClosures: { zone: string; reason: string }[] = [];
  try {
    const [ch, zch] = await Promise.all([
      supabaseAdmin.from("service_closures").select("service_key, reason").eq("date", date),
      supabaseAdmin.from("zone_closures").select("zone, reason").eq("date", date),
    ]);
    if (!ch.error && ch.data) closures = ch.data;
    if (!zch.error && zch.data) zoneClosures = zch.data;
  } catch { /* nessuna chiusura */ }

  return json({
    reservations: data ?? [],
    couverts,
    closures,
    zone_closures: zoneClosures,
    hold_minutes: hold,
    config: { slot_minutes: slot, services, zones, capacity, zone_seats: zoneSeats, timezone: tz },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: {
    date?: string;
    heure?: string;
    service_key?: string;
    people?: number;
    zone?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    high_chair?: boolean;
    quiet?: boolean;
    business?: boolean;
    company?: string;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const date = String(body.date ?? "");
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);
  const heure = String(body.heure ?? "");
  if (!/^\d{2}:\d{2}$/.test(heure)) return json({ error: "Heure invalide" }, 400);
  const people = Math.floor(Number(body.people));
  if (!Number.isFinite(people) || people < 1 || people > 100) {
    return json({ error: "Personnes invalide (1–100)" }, 400);
  }

  const riga: Record<string, unknown> = {
    source: body.source === "phone" ? "phone" : "walkin",
  };
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .insert({
      ...riga,
      date,
      heure,
      service_key: /^[a-z_]{1,30}$/.test(String(body.service_key ?? "")) ? String(body.service_key) : null,
      people,
      zone: String(body.zone ?? "").trim() || null,
      first_name:
        String(body.first_name ?? "").trim() ||
        (String(body.last_name ?? "").trim() ? "" : "Walk-in"),
      last_name: String(body.last_name ?? "").trim(),
      phone: String(body.phone ?? "").trim(),
      email: String(body.email ?? "").trim(),
      notes: String(body.notes ?? "").trim() || null,
      high_chair: Boolean(body.high_chair),
      quiet: Boolean(body.quiet),
      business: Boolean(body.business),
      company: Boolean(body.business) ? String(body.company ?? "").trim() : "",
      lang: "fr",
      status: "confirmed",
    })
    .select("*")
    .single();
  if (error || !data) {
    // Migrazione #21 non ancora lanciata (colonna source assente): si salva senza
    if (error?.message.includes("source")) {
      const { data: d2, error: e2 } = await supabaseAdmin
        .from("reservations")
        .insert({
          date,
          heure,
          service_key: /^[a-z_]{1,30}$/.test(String(body.service_key ?? "")) ? String(body.service_key) : null,
          people,
          zone: String(body.zone ?? "").trim() || null,
          first_name:
            String(body.first_name ?? "").trim() ||
            (String(body.last_name ?? "").trim() ? "" : "Walk-in"),
          last_name: String(body.last_name ?? "").trim(),
          phone: String(body.phone ?? "").trim(),
          email: String(body.email ?? "").trim(),
          notes: String(body.notes ?? "").trim() || null,
          high_chair: Boolean(body.high_chair),
          quiet: Boolean(body.quiet),
          business: Boolean(body.business),
          company: Boolean(body.business) ? String(body.company ?? "").trim() : "",
          lang: "fr",
          status: "confirmed",
        })
        .select("*")
        .single();
      if (!e2 && d2) {
        void programmaReview(d2 as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
        return json({ reservation: d2 });
      }
    }
    return json({ error: "Création impossible" }, 500);
  }
  void programmaReview(data as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
  return json({ reservation: data });
};

/** Programma l'email recensione (11:30 del giorno dopo) e salva l'id Resend. */
async function programmaReview(r: { id: string; date: string; first_name: string; last_name: string; email: string; lang: string }): Promise<void> {
  try {
    const emailId = await emailReviewResa(r);
    if (!emailId) return;
    // Colonna assente (migrazione #24 non lanciata): si ignora l'errore
    await supabaseAdmin.from("reservations").update({ review_email_id: emailId }).eq("id", r.id);
  } catch { /* nessun blocco */ }
}

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: {
    id?: string;
    status?: string;
    date?: string;
    heure?: string;
    service_key?: string;
    people?: number;
    zone?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    high_chair?: boolean;
    quiet?: boolean;
    business?: boolean;
    company?: string;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  // Solo i campi presenti nel body vengono modificati
  const upd: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!STATI.includes(body.status)) return json({ error: "Statut invalide" }, 400);
    upd.status = body.status;
  }
  if (body.date !== undefined) {
    if (!RE_DATA.test(String(body.date))) return json({ error: "Date invalide" }, 400);
    upd.date = body.date;
  }
  if (body.heure !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(String(body.heure))) return json({ error: "Heure invalide" }, 400);
    upd.heure = body.heure;
  }
  if (body.people !== undefined) {
    const n = Math.floor(Number(body.people));
    if (!Number.isFinite(n) || n < 1 || n > 100) return json({ error: "Personnes invalide (1–100)" }, 400);
    upd.people = n;
  }
  if (body.service_key !== undefined) {
    upd.service_key = /^[a-z_]{1,30}$/.test(String(body.service_key)) ? String(body.service_key) : null;
  }
  if (body.zone !== undefined) upd.zone = String(body.zone).trim() || null;
  if (body.first_name !== undefined || body.last_name !== undefined) {
    const fn = String(body.first_name ?? "").trim();
    const ln = String(body.last_name ?? "").trim();
    upd.first_name = fn || (ln ? "" : "Walk-in");
    upd.last_name = ln;
  }
  if (body.phone !== undefined) upd.phone = String(body.phone).trim();
  if (body.email !== undefined) upd.email = String(body.email).trim();
  if (body.notes !== undefined) upd.notes = String(body.notes).trim() || null;
  if (body.high_chair !== undefined) upd.high_chair = Boolean(body.high_chair);
  if (body.quiet !== undefined) upd.quiet = Boolean(body.quiet);
  if (body.business !== undefined) {
    upd.business = Boolean(body.business);
    upd.company = Boolean(body.business) ? String(body.company ?? "").trim() : "";
  }
  if (body.source !== undefined) {
    if (body.source !== "walkin" && body.source !== "phone") return json({ error: "Origine invalide" }, 400);
    upd.source = body.source;
  }
  if (!Object.keys(upd).length) return json({ error: "Rien à modifier" }, 400);

  let { data, error } = await supabaseAdmin
    .from("reservations")
    .update(upd)
    .eq("id", id)
    .select("*")
    .single();
  // Migrazione #21 non ancora lanciata: si riprova senza la colonna source
  if (error && upd.source !== undefined && error.message.includes("source")) {
    delete upd.source;
    if (Object.keys(upd).length) {
      ({ data, error } = await supabaseAdmin
        .from("reservations")
        .update(upd)
        .eq("id", id)
        .select("*")
        .single());
    }
  }
  if (error || !data) return json({ error: "Modification impossible" }, 500);
  // Annullata o no-show: l'email recensione programmata non deve partire
  if (upd.status === "cancelled" || upd.status === "noshow") {
    const emailId = String((data as { review_email_id?: string | null }).review_email_id ?? "");
    if (emailId) {
      void annullaEmailReview(emailId);
      void supabaseAdmin.from("reservations").update({ review_email_id: null }).eq("id", id);
    }
  }
  return json({ reservation: data });
};
