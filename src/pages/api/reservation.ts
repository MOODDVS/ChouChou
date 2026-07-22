import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";
import { postiDalPlan, maxInsiemePerZona, assegnaESalva } from "../../lib/planSalle";
import { SERVIZI_WIDGET } from "../../lib/reservationI18n";
import {
  inviaNotificheResa,
  inviaNotificheDemandeResa,
  inviaConfermaResa,
  emailReviewResa,
  annullaEmailReview,
  type ResaEmail,
} from "../../lib/notifications";
import { registraCliente } from "../../lib/registraCliente";

export const prerender = false;

const RE_UUID = /^[0-9a-f-]{36}$/i;

/** Campi restituiti dall'insert/update per comporre le email. */
const CAMPI_EMAIL =
  "id, date, heure, service_key, people, zone, first_name, last_name, phone, email, lang, cancel_token, notes, high_chair, quiet, business, company, birthday, special_event";

/** Programma l'email recensione e salva l'id Resend (best-effort). */
async function programmaReview(r: {
  id: string;
  date: string;
  first_name: string;
  last_name: string;
  email: string;
  lang: string;
}): Promise<void> {
  try {
    const emailId = await emailReviewResa(r);
    if (!emailId) return;
    await supabaseAdmin.from("reservations").update({ review_email_id: emailId }).eq("id", r.id);
  } catch {
    /* nessun blocco */
  }
}

// ============================================================
// API PUBBLICA del widget prenotazioni (senza auth).
// GET ?config=1        → configurazione per il rendering del widget
// GET ?date=YYYY-MM-DD → disponibilità del giorno: prenotazioni CONFERMATE
//                        ridotte a heure/people/zone/service_key (nessun
//                        dato personale) + chiusure services/sections.
// GET ?month=YYYY-MM   → per il datepicker: giorni chiusi e "complets".
// POST                 → creazione prenotazione (in arrivo, prossimo step).
//
// Il calcolo dei créneaux pieni avviene nel widget con questi dati + config;
// la stessa logica verrà ricontrollata lato server nel POST.
// ============================================================

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function intOf(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : NaN;
}
function clamp(n: number, lo: number, hi: number, def: number): number {
  return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
}
function minutiDi(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}
/** Minuti da mezzanotte "adesso" nel fuso del ristorante. */
function oraTzMinuti(tz: string): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .split(":");
  return Number(h) * 60 + Number(m);
}

/** Risolve la key del service: sv.key se valida, altrimenti dal label FR. */
function keyServizio(sv: { key?: string; label?: string }): string | null {
  const k = String(sv.key ?? "");
  if (k && SERVIZI_WIDGET[k]) return k;
  const lab = String(sv.label ?? "").trim().toLowerCase();
  if (lab) {
    const hit = Object.entries(SERVIZI_WIDGET).find(([, vv]) => vv.fr.toLowerCase() === lab);
    if (hit) return hit[0];
  }
  return null;
}

interface WidgetConfig {
  services: { key: string; from: string; to: string; hold: number; slot: number; days: number[] }[];
  zones: { name: string; seats: number; max_ins?: number }[];
  zoneChoice: boolean;
  capacity: number;
  maxPeople: number;
  planMode: boolean;
  autoAccept: boolean;  // "0" = demandes PENDING (niente controllo capienza)
  autoTables: boolean;  // "0" = niente tavoli automatici né vincoli combinazione
  minNoticeMinutes: number;
  cornerStyle: "square" | "rounded";
  languages: string[];
  timezone: string;
}

/** Legge la configurazione réservations da app_config. */
async function leggiConfig(): Promise<WidgetConfig> {
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("key, value")
    .in("key", [
      "reservation_services",
      "reservation_zones",
      "reservation_plan_mode",
      "reservation_zone_choice",
      "reservation_auto_accept",
      "reservation_auto_tables",
      "reservation_max_people",
      "reservation_min_notice_minutes",
      "reservation_min_notice_hours",
      "reservation_hold_minutes",
      "reservation_slot_minutes",
      "reservation_corner_style",
      "reservation_languages",
      "timezone",
    ]);
  const m = new Map((data ?? []).map((r) => [r.key, String(r.value ?? "")]));

  const holdLeg = clamp(intOf(m.get("reservation_hold_minutes")), 15, 360, 90);
  const slotLeg = clamp(intOf(m.get("reservation_slot_minutes")), 10, 120, 30);

  // Services (hold/slot PER service, fallback ai globali legacy)
  const services: WidgetConfig["services"] = [];
  try {
    const arr = JSON.parse(m.get("reservation_services") || "[]");
    if (Array.isArray(arr)) {
      for (const sv of arr) {
        const key = keyServizio(sv);
        const from = String(sv.from ?? "");
        const to = String(sv.to ?? "");
        if (!key || !HHMM.test(from) || !HHMM.test(to)) continue;
        const days: number[] = Array.isArray(sv.days)
          ? (sv.days as unknown[])
              .map((d) => Math.floor(Number(d)))
              .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
              .filter((d, i, a) => a.indexOf(d) === i)
          : [];
        services.push({
          key,
          from,
          to,
          hold: clamp(intOf(sv.hold), 15, 360, holdLeg),
          slot: clamp(intOf(sv.slot), 10, 120, slotLeg),
          days,
        });
      }
    }
  } catch {
    /* nessun service configurato */
  }

  // Zones + capienza totale (plan de salle attivo → posti dai tavoli disegnati)
  const zones: WidgetConfig["zones"] = [];
  let capacity = 0;
  const planPosti = await postiDalPlan(m.get("reservation_plan_mode"));
  const planMaxIns = await maxInsiemePerZona(m.get("reservation_plan_mode"));
  try {
    const arr = JSON.parse(m.get("reservation_zones") || "[]");
    if (Array.isArray(arr)) {
      for (const z of arr) {
        const name = String(z.name ?? "").trim();
        const seats = planPosti ? Math.floor(planPosti.get(name) ?? 0) : intOf(z.seats);
        if (name && Number.isFinite(seats) && seats > 0) {
          zones.push({ name, seats, max_ins: planMaxIns ? planMaxIns.get(name) ?? 0 : undefined });
          capacity += seats;
        }
      }
    }
  } catch {
    /* nessuna section */
  }

  // Délai minimo (minuti; fallback ore×60)
  let minNotice = intOf(m.get("reservation_min_notice_minutes"));
  if (!(minNotice >= 0)) {
    const ore = intOf(m.get("reservation_min_notice_hours"));
    minNotice = ore > 0 ? ore * 60 : 0;
  }
  minNotice = Math.min(4320, Math.max(0, minNotice || 0));

  // Personnes maximum (1–100, default 8)
  let maxPeople = intOf(m.get("reservation_max_people"));
  if (!(maxPeople >= 1)) maxPeople = 8;
  maxPeople = Math.min(100, maxPeople);

  const cornerStyle = m.get("reservation_corner_style") === "square" ? "square" : "rounded";

  // Lingue del widget (fr sempre presente)
  let languages: string[] = ["fr", "en"];
  try {
    const arr = JSON.parse(m.get("reservation_languages") || "[]");
    if (Array.isArray(arr) && arr.length) languages = arr.map((x) => String(x));
  } catch {
    /* default */
  }
  if (!languages.includes("fr")) languages = ["fr", ...languages];

  const zoneChoice = (m.get("reservation_zone_choice") ?? "1") !== "0";

  let timezone = "Europe/Brussels";
  const vTz = m.get("timezone") ?? "";
  if (vTz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: vTz });
      timezone = vTz;
    } catch {
      /* fuso invalido: default */
    }
  }

  const autoAccept = (m.get("reservation_auto_accept") ?? "1") !== "0";
  const autoTables = (m.get("reservation_auto_tables") ?? "1") !== "0";
  // planMode qui governa i VINCOLI di combinazione (max-insieme ecc.):
  // con l'attribuzione automatica spenta contano solo i posti → false.
  // I POSTI restano comunque quelli del disegno (planPosti sopra).
  return { services, zones, zoneChoice, capacity, maxPeople, planMode: !!planPosti && autoTables, autoAccept, autoTables, minNoticeMinutes: minNotice, cornerStyle, languages, timezone };
}

/** Jour spécial che copre la data.
 *  { chiuso:true }                     → giorno fermé (special closed)
 *  { aperto:true, ranges:[[da,a],…] }  → special ouvert con orari PROPRI (minuti)
 *  { aperto:true, ranges:null }        → special ouvert senza orari (si usano i services)
 *  null                                → nessun jour spécial (giorno normale) */
async function specialeDelGiorno(
  date: string
): Promise<{ chiuso: boolean; aperto: boolean; ranges: [number, number][] | null; servizi: string[] | null } | null> {
  try {
    let { data, error } = await supabaseAdmin
      .from("special_days")
      .select("type, lunch_open, lunch_close, dinner_open, dinner_close, services")
      .lte("date_from", date)
      .gte("date_to", date);
    // Migrazione #33 non ancora lanciata: senza la colonna (= tutti i servizi)
    if (error && String(error.message ?? "").includes("services")) {
      const retry = await supabaseAdmin
        .from("special_days")
        .select("type, lunch_open, lunch_close, dinner_open, dinner_close")
        .lte("date_from", date)
        .gte("date_to", date);
      data = retry.data as typeof data;
      error = retry.error;
    }
    const righe = (data ?? []) as { type: string; lunch_open?: unknown; lunch_close?: unknown; dinner_open?: unknown; dinner_close?: unknown; services?: unknown }[];
    if (righe.some((r) => r.type === "closed")) return { chiuso: true, aperto: false, ranges: null, servizi: null };
    const open = righe.find((r) => r.type === "open");
    if (!open) return null;
    const servizi = Array.isArray(open.services) ? (open.services as unknown[]).map((t) => String(t)) : null;
    const ranges: [number, number][] = [];
    const coppie: [unknown, unknown][] = [
      [open.lunch_open, open.lunch_close],
      [open.dinner_open, open.dinner_close],
    ];
    for (const [o, c] of coppie) {
      const da = minutiDi(String(o ?? "").slice(0, 5));
      const a = minutiDi(String(c ?? "").slice(0, 5));
      if (da >= 0 && a > da) ranges.push([da, a]);
    }
    return { chiuso: false, aperto: true, ranges: ranges.length ? ranges : null, servizi };
  } catch {
    return null;
  }
}

/** Un service è attivo in un jour spécial "ouvert" con lista servizi?
 *  lista null = tutti (retro-compatibile) · [] = nessuno · token "key|from-to" o solo key. */
function svAttivoSpeciale(key: string, from: string, to: string, lista: string[] | null): boolean {
  if (lista === null) return true;
  return lista.includes(`${key}|${from}-${to}`) || lista.includes(key);
}

export const GET: APIRoute = async ({ url }) => {
  // ---- Config ----
  if (url.searchParams.get("config")) {
    const config = await leggiConfig();
    return json({ config });
  }

  // ---- Prefill da token (modifica): dati della prenotazione confermata ----
  const token = url.searchParams.get("token") ?? "";
  if (token) {
    if (!RE_UUID.test(token)) return json({ error: "lienInvalide" }, 404);
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select(CAMPI_EMAIL + ", status")
      .eq("cancel_token", token)
      .maybeSingle();
    const riga = (data ?? null) as unknown as ({ status?: string } & Record<string, unknown>) | null;
    if (error || !riga || (riga.status !== "confirmed" && riga.status !== "pending")) return json({ error: "lienInvalide" }, 404);
    const { status, id, ...pub } = riga;
    return json({ reservation: pub });
  }

  // ---- Vista mese (datepicker) ----
  const month = url.searchParams.get("month") ?? "";
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [anno, mese] = month.split("-").map(Number);
    const nGiorni = new Date(anno, mese, 0).getDate();
    const primo = `${month}-01`;
    const ultimo = `${month}-${String(nGiorni).padStart(2, "0")}`;

    const [orari, speciali, cfg, rese, chiusureSv] = await Promise.all([
      supabaseAdmin.from("settings").select("day_of_week, lunch_active, dinner_active"),
      supabaseAdmin
        .from("special_days")
        .select("type, date_from, date_to, services")
        .lte("date_from", ultimo)
        .gte("date_to", primo)
        .then(async (r) => {
          // Migrazione #33 non ancora lanciata: si rilegge senza la colonna
          if (r.error && String(r.error.message ?? "").includes("services")) {
            return supabaseAdmin
              .from("special_days")
              .select("type, date_from, date_to")
              .lte("date_from", ultimo)
              .gte("date_to", primo);
          }
          return r;
        }),
      supabaseAdmin.from("app_config").select("key, value").in("key", ["reservation_services", "reservation_zones", "reservation_plan_mode", "reservation_auto_accept"]),
      supabaseAdmin
        .from("reservations")
        .select("date, service_key, people")
        .gte("date", primo)
        .lte("date", ultimo)
        .in("status", ["confirmed", "seated"]),
      supabaseAdmin.from("service_closures").select("date, service_key").gte("date", primo).lte("date", ultimo),
    ]);

    const apertoSett = new Map<number, boolean>();
    for (const g of orari.data ?? []) apertoSett.set(g.day_of_week, Boolean(g.lunch_active || g.dinner_active));

    const cfgMap = new Map((cfg.data ?? []).map((r) => [r.key, String(r.value ?? "")]));
    // Chiusure di service per giorno (per marcare "complet" i giorni tutti chiusi)
    const chiusePerGiorno = new Map<string, Set<string>>();
    for (const c of chiusureSv.data ?? []) {
      const d = String(c.date);
      if (!chiusePerGiorno.has(d)) chiusePerGiorno.set(d, new Set());
      chiusePerGiorno.get(d)!.add(String(c.service_key));
    }
    let services: { key?: string; label?: string; days?: unknown }[] = [];
    try {
      const arr = JSON.parse(cfgMap.get("reservation_services") || "[]");
      if (Array.isArray(arr)) services = arr;
    } catch {
      /* vuoto */
    }
    let capienza = 0;
    // Auto-accept spento: si accetta tutto → la capienza non rende "complet"
    // (capienza 0 = il calcolo dei giorni pieni sotto viene saltato)
    const mAutoAccept = (cfgMap.get("reservation_auto_accept") ?? "1") !== "0";
    const planPosti = await postiDalPlan(cfgMap.get("reservation_plan_mode"));
    try {
      const arr = JSON.parse(cfgMap.get("reservation_zones") || "[]");
      if (Array.isArray(arr)) {
        capienza = arr.reduce((t: number, z: { name?: unknown; seats?: unknown }) => {
          const n = planPosti ? Math.floor(planPosti.get(String(z.name ?? "").trim()) ?? 0) : intOf(z.seats);
          return t + (Number.isFinite(n) && n > 0 ? n : 0);
        }, 0);
      }
    } catch {
      /* nessuna section */
    }

    const coperti = new Map<string, number>();
    for (const r of rese.data ?? []) {
      const k = `${r.date}|${r.service_key ?? ""}`;
      coperti.set(k, (coperti.get(k) ?? 0) + (r.people ?? 0));
    }

    const closed: string[] = [];
    const full: string[] = [];
    const open: string[] = [];
    for (let g = 1; g <= nGiorni; g++) {
      const iso = `${month}-${String(g).padStart(2, "0")}`;
      const dow = new Date(anno, mese - 1, g).getDay();
      let aperto = apertoSett.get(dow) ?? true;
      for (const sp of speciali.data ?? []) if (iso >= sp.date_from && iso <= sp.date_to && sp.type === "open") aperto = true;
      for (const sp of speciali.data ?? []) if (iso >= sp.date_from && iso <= sp.date_to && sp.type === "closed") aperto = false;
      if (!aperto) {
        closed.push(iso);
        continue;
      }
      const spOpen = (speciali.data ?? []).find(
        (sp) => iso >= sp.date_from && iso <= sp.date_to && sp.type === "open"
      ) as { services?: unknown } | undefined;
      const spOpenDay = Boolean(spOpen);
      const spLista = spOpen && Array.isArray(spOpen.services) ? (spOpen.services as unknown[]).map((t) => String(t)) : null;
      // Services ATTIVI quel giorno: days rispettati; jour spécial ouvert =
      // la LISTA del giorno (null = tutti, [] = nessuno → solo commandes)
      const attivi = services.filter((sv) => {
        if (!keyServizio(sv)) return false;
        if (spOpenDay) {
          return svAttivoSpeciale(String(sv.key ?? ""), String((sv as { from?: unknown }).from ?? ""), String((sv as { to?: unknown }).to ?? ""), spLista);
        }
        const days = Array.isArray(sv.days) ? (sv.days as unknown[]).map((d) => Math.floor(Number(d))) : [];
        return days.length === 0 || days.includes(dow);
      });
      // Giorno speciale con ZERO servizi attivi: non prenotabile → "complet"
      if (spOpenDay && spLista !== null && attivi.length === 0) {
        full.push(iso);
        continue;
      }
      if (spOpenDay && attivi.length > 0) open.push(iso);
      // Tutti i services del giorno chiusi dal ristoratore → giorno "complet"
      const chSet = chiusePerGiorno.get(iso);
      const tuttiChiusi = attivi.length > 0 && !!chSet && attivi.every((sv) => chSet.has(keyServizio(sv) ?? ""));
      let pieno = tuttiChiusi;
      if (!pieno && capienza > 0 && mAutoAccept) {
        pieno = attivi.length
          ? attivi.every((sv) => (coperti.get(`${iso}|${keyServizio(sv) ?? ""}`) ?? 0) >= capienza)
          : (rese.data ?? []).filter((r) => r.date === iso).reduce((t, r) => t + (r.people ?? 0), 0) >= capienza;
      }
      if (pieno) full.push(iso);
    }
    return json({ closed, full, open });
  }

  // ---- Disponibilità del giorno ----
  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);

  // Modifica: esclude la prenotazione stessa dal calcolo disponibilità
  const excl = url.searchParams.get("exclude") ?? "";
  let dayQ = supabaseAdmin
    .from("reservations")
    .select("heure, people, zone, service_key")
    .eq("date", date)
    .in("status", ["confirmed", "seated"]);
  if (excl && RE_UUID.test(excl)) dayQ = dayQ.neq("cancel_token", excl);
  const { data, error } = await dayQ;
  if (error) return json({ reservations: [], service_closures: [], zone_closures: [] });

  let serviceClosures: string[] = [];
  let zoneClosures: string[] = [];
  try {
    const [ch, zch] = await Promise.all([
      supabaseAdmin.from("service_closures").select("service_key").eq("date", date),
      supabaseAdmin.from("zone_closures").select("zone").eq("date", date),
    ]);
    if (!ch.error && ch.data) serviceClosures = ch.data.map((r) => String(r.service_key)).filter(Boolean);
    if (!zch.error && zch.data) zoneClosures = zch.data.map((r) => String(r.zone)).filter(Boolean);
  } catch {
    /* nessuna chiusura */
  }

  // Jour spécial "ouvert": il widget adatta i services alle sue fasce orarie
  const speciale = await specialeDelGiorno(date);

  return json({
    reservations: (data ?? []).map((r) => ({
      heure: r.heure,
      people: r.people,
      zone: r.zone,
      service_key: r.service_key,
    })),
    service_closures: serviceClosures,
    zone_closures: zoneClosures,
    special_open: Boolean(speciale?.aperto),
    special_ranges: speciale?.aperto ? speciale.ranges : null,
    special_services: speciale?.aperto ? speciale.servizi : null,
  });
};

// Ricontrolla la disponibilità LATO SERVER con la stessa logica del widget.
// Ritorna null se OK, oppure la chiave d'errore ("creneauPris").
// excludeToken: in modifica, ignora la prenotazione stessa nel calcolo.
async function verificaCreneau(
  cfg: WidgetConfig,
  p: { date: string; heure: string; service_key: string | null; zone: string | null; people: number; excludeToken?: string }
): Promise<string | null> {
  // Plan de salle attivo: nessuna combinazione di tavoli per questo numero
  // di persone → il créneau non è accettabile (l'admin invece bypassa).
  if (cfg.planMode && cfg.autoAccept) {
    const perZona = (nome: string): number => cfg.zones.find((z) => z.name === nome)?.max_ins ?? 0;
    const consentiti = p.zone ? perZona(p.zone) : Math.max(0, ...cfg.zones.map((z) => z.max_ins ?? 0));
    if (consentiti > 0 && p.people > consentiti) return "creneauPris";
  }
  const slotMin = minutiDi(p.heure);

  // Délai minimo / giorno passato
  const nowMin = oraTzMinuti(cfg.timezone);
  const oggiTz = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timezone }).format(new Date());
  const diff = Math.round((Date.parse(p.date) - Date.parse(oggiTz)) / 86400000);
  const sog = nowMin + cfg.minNoticeMinutes - diff * 1440;
  if (diff < 0 || slotMin < sog) return "creneauPris";

  // Giorno aperto? (special fermé > special ouvert > horaire hebdo)
  const speciale = await specialeDelGiorno(p.date);
  if (speciale?.chiuso) return "creneauPris";
  const dow = new Date(p.date + "T12:00:00").getDay();
  if (!speciale?.aperto) {
    try {
      const { data: sett } = await supabaseAdmin
        .from("settings")
        .select("lunch_active, dinner_active")
        .eq("day_of_week", dow)
        .maybeSingle();
      if (sett && !sett.lunch_active && !sett.dinner_active) return "creneauPris";
    } catch { /* senza orari: nessun blocco */ }
  }

  // Slot dentro la finestra del service scelto; giorni del service rispettati
  // (ma un jour spécial "ouvert" li scavalca); fasce speciali intersecate
  const svScelto = p.service_key ? cfg.services.find((sv) => sv.key === p.service_key) : undefined;
  if (svScelto) {
    const da = minutiDi(svScelto.from);
    const a = minutiDi(svScelto.to);
    if (da >= 0 && a > da && !(slotMin >= da && slotMin <= a)) return "creneauPris";
    if (!speciale?.aperto && svScelto.days.length > 0 && !svScelto.days.includes(dow)) return "creneauPris";
    if (speciale?.aperto && !svAttivoSpeciale(svScelto.key, svScelto.from, svScelto.to, speciale.servizi)) {
      return "creneauPris"; // service spento in quel giorno speciale
    }
    if (speciale?.aperto && speciale.ranges) {
      const dentro = speciale.ranges.some(([r1, r2]) => slotMin >= Math.max(da, r1) && slotMin <= Math.min(a, r2));
      if (!dentro) return "creneauPris";
    }
  }

  let dayQ = supabaseAdmin
    .from("reservations")
    .select("heure, people, zone, service_key")
    .eq("date", p.date)
    .in("status", ["confirmed", "seated"]);
  if (p.excludeToken && RE_UUID.test(p.excludeToken)) dayQ = dayQ.neq("cancel_token", p.excludeToken);

  const [chiusrv, chzone, day] = await Promise.all([
    supabaseAdmin.from("service_closures").select("service_key").eq("date", p.date),
    supabaseAdmin.from("zone_closures").select("zone").eq("date", p.date),
    dayQ,
  ]);
  const svcClosed = (chiusrv.data ?? []).map((r) => String(r.service_key));
  const zoneClosed = (chzone.data ?? []).map((r) => String(r.zone));
  if (p.service_key && svcClosed.includes(p.service_key)) return "creneauPris";
  if (p.zone && zoneClosed.includes(p.zone)) return "creneauPris";

  // Auto-accept spento: orari e chiusure valgono (sopra), la CAPIENZA no —
  // si accetta tutto come demande PENDING e decide il ristoratore.
  if (!cfg.autoAccept) return null;

  // Capienza (meno le sezioni chiuse) + occupazione sovrapposta
  const capienza = cfg.capacity - cfg.zones.filter((z) => zoneClosed.includes(z.name)).reduce((t, z) => t + z.seats, 0);
  const holdByKey = new Map(cfg.services.map((s) => [s.key, s.hold]));
  const holdNuovo = (p.service_key ? holdByKey.get(p.service_key) : undefined) ?? cfg.services[0]?.hold ?? 90;
  const postiZona = p.zone ? cfg.zones.find((z) => z.name === p.zone)?.seats ?? 0 : 0;

  if (capienza > 0) {
    let occTot = 0;
    let occZona = 0;
    const occPer = new Map<string, number>();
    for (const rr of day.data ?? []) {
      const rMin = minutiDi(String(rr.heure).slice(0, 5));
      if (rMin < 0) continue;
      const rHold = holdByKey.get(rr.service_key ?? "") ?? holdNuovo;
      if (rMin < slotMin + holdNuovo && rMin + rHold > slotMin) {
        occTot += rr.people ?? 0;
        const rz = String(rr.zone ?? "").trim();
        if (rz) occPer.set(rz, (occPer.get(rz) ?? 0) + (rr.people ?? 0));
        if (p.zone && (rr.zone ?? "") === p.zone) occZona += rr.people ?? 0;
      }
    }
    if (occTot + p.people > capienza) return "creneauPris";
    if (postiZona > 0 && occZona + p.people > postiZona) return "creneauPris";
    // "Indifférent": ALMENO UNA section deve poter ospitare l'intera tavolata
    // (2 posti liberi qui e 3 là NON fanno un tavolo da 4).
    if (!p.zone && cfg.zones.length > 0) {
      const ok = cfg.zones.some(
        (z) =>
          !zoneClosed.includes(z.name) &&
          (!cfg.planMode || (z.max_ins ?? 0) >= p.people) &&
          (occPer.get(z.name) ?? 0) + p.people <= z.seats
      );
      if (!ok) return "creneauPris";
    }
  }
  return null;
}

/** Cliente BLOCCATO per le prenotazioni (pagina Clients, matita → Bloquer).
 *  Confronto per email (case-insens.) o telefono (solo cifre, senza 0 iniziali):
 *  i formati dei numeri variano (+32 4xx / 04xx). Gli ordini NON passano di qui. */
async function clienteBloccato(email: string, phone: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.from("clients").select("email, phone").eq("blocked", true).limit(500);
    if (error || !data) return false; // colonna assente (#32) o nessun blocco
    const em = email.trim().toLowerCase();
    const cifre = phone.replace(/\D/g, "").replace(/^0+/, "");
    for (const r of data) {
      const re = String(r.email ?? "").trim().toLowerCase();
      if (em && re && re === em) return true;
      const rp = String(r.phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
      if (cifre && rp && Math.min(rp.length, cifre.length) >= 8 && (rp.endsWith(cifre) || cifre.endsWith(rp))) return true;
    }
  } catch { /* mai bloccante */ }
  return false;
}

/** Estrae e normalizza i campi comuni del body (POST/PUT). */
function leggiCampi(body: Record<string, unknown>) {
  const date = String(body.date ?? "");
  const heure = String(body.heure ?? "");
  const people = Math.floor(Number(body.people));
  const first_name = String(body.first_name ?? "").trim();
  const last_name = String(body.last_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim();
  const service_key = /^[a-z_]{1,30}$/.test(String(body.service_key ?? "")) ? String(body.service_key) : null;
  const zone = String(body.zone ?? "").trim() || null;
  const langRaw = String(body.lang ?? "fr");
  const lang = /^[a-z]{2}$/.test(langRaw) ? langRaw : "fr";
  const valido =
    RE_DATA.test(date) &&
    HHMM.test(heure) &&
    Number.isFinite(people) &&
    people >= 1 &&
    people <= 100 &&
    !!last_name &&
    !!phone &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return {
    valido,
    riga: {
      date,
      heure,
      service_key,
      people,
      zone,
      first_name: first_name || last_name,
      last_name,
      phone,
      email,
      lang,
      high_chair: Boolean(body.high_chair),
      quiet: Boolean(body.quiet),
      business: Boolean(body.business),
      company: Boolean(body.business) ? String(body.company ?? "").trim() : "",
      birthday: Boolean(body.birthday),
      special_event: Boolean(body.special_event),
      notes: String(body.notes ?? "").trim() || null,
    },
  };
}

// ============================================================
// POST → crea una prenotazione (dal widget pubblico).
// Ricontrolla la disponibilità LATO SERVER con la stessa logica del widget:
// se il créneau è stato preso nel frattempo → 409 { error: "creneauPris" }.
// Conferma automatica (status confirmed, source web, cancel_token).
// ============================================================
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "champsInvalides" }, 400);
  }

  const { valido, riga } = leggiCampi(body);
  if (!valido) return json({ ok: false, error: "champsInvalides" }, 400);

  // Cliente bloccato: errore GENERICO (non si rivela il blocco)
  if (await clienteBloccato(riga.email, riga.phone)) {
    return json({ ok: false, error: "erreurEnvoi" }, 403);
  }

  const cfg = await leggiConfig();
  const errC = await verificaCreneau(cfg, {
    date: riga.date,
    heure: riga.heure,
    service_key: riga.service_key,
    zone: riga.zone,
    people: riga.people,
  });
  if (errC) return json({ ok: false, error: errC }, 409);

  // Auto-accept spento → la richiesta nasce PENDING (conferma il ristoratore)
  const base: Record<string, unknown> = { ...riga, status: cfg.autoAccept ? "confirmed" : "pending" };

  // Insert (fallback senza `source` se la migrazione #21 non è lanciata)
  let ins = await supabaseAdmin.from("reservations").insert({ ...base, source: "web" }).select(CAMPI_EMAIL).single();
  if (ins.error && ins.error.message.includes("source")) {
    ins = await supabaseAdmin.from("reservations").insert(base).select(CAMPI_EMAIL).single();
  }
  if (ins.error || !ins.data) return json({ ok: false, error: "erreurEnvoi" }, 500);

  // Plan de salle: tavoli assegnati anche alle prenotazioni dal widget
  // (il cliente non li vede; servono ai conteggi e alla lista admin).
  // In modalità demande i tavoli si assegnano ALLA CONFERMA, non ora.
  const resaId = String((ins.data as { id?: unknown }).id ?? "");
  if (cfg.autoAccept) {
    await assegnaESalva(resaId, {
      date: riga.date,
      heure: riga.heure,
      service_key: riga.service_key,
      zone: riga.zone,
      people: riga.people,
    });
  }

  // Email al cliente (conferma O « demande reçue ») + notifica ristorante.
  // La recensione si programma solo per le confermate (per le demandes
  // parte quando il ristoratore conferma, dall'API admin).
  const resa = ins.data as unknown as ResaEmail;
  if (cfg.autoAccept) void inviaNotificheResa(resa);
  else void inviaNotificheDemandeResa(resa);
  // Registra la persona nella rubrica `clients` (come il webhook per gli ordini)
  void registraCliente({ name: `${resa.first_name} ${resa.last_name}`.trim(), email: resa.email, phone: resa.phone });
  if (cfg.autoAccept) {
    void programmaReview({
      id: resa.id,
      date: resa.date,
      first_name: resa.first_name,
      last_name: resa.last_name,
      email: resa.email,
      lang: resa.lang,
    });
  }

  return json({ ok: true, id: resa.id, cancel_token: resa.cancel_token, pending: !cfg.autoAccept });
};

// ============================================================
// PUT → modifica una prenotazione esistente (dal link "Modifier").
// Identificata dal cancel_token; ri-controlla la disponibilità escludendo
// sé stessa; re-invia la conferma aggiornata. 409 se il créneau è pieno.
// ============================================================
export const PUT: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "champsInvalides" }, 400);
  }

  const token = String(body.token ?? "");
  if (!RE_UUID.test(token)) return json({ ok: false, error: "lienInvalide" }, 404);

  // La prenotazione deve esistere ed essere confermata
  const { data: attuale } = await supabaseAdmin
    .from("reservations")
    .select("id, status")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!attuale || (attuale.status !== "confirmed" && attuale.status !== "pending")) return json({ ok: false, error: "lienInvalide" }, 404);

  const { valido, riga } = leggiCampi(body);
  if (!valido) return json({ ok: false, error: "champsInvalides" }, 400);

  // Cliente bloccato: errore GENERICO (non si rivela il blocco)
  if (await clienteBloccato(riga.email, riga.phone)) {
    return json({ ok: false, error: "erreurEnvoi" }, 403);
  }

  const cfg = await leggiConfig();
  const errC = await verificaCreneau(cfg, {
    date: riga.date,
    heure: riga.heure,
    service_key: riga.service_key,
    zone: riga.zone,
    people: riga.people,
    excludeToken: token,
  });
  if (errC) return json({ ok: false, error: errC }, 409);

  let upd = await supabaseAdmin
    .from("reservations")
    .update({ ...riga, client_action_at: new Date().toISOString() })
    .eq("cancel_token", token)
    .in("status", ["confirmed", "pending"])
    .select(CAMPI_EMAIL)
    .single();
  // Migrazione client_action_at non ancora lanciata: si modifica senza il campo
  if (upd.error && String(upd.error.message ?? "").includes("client_action_at")) {
    upd = await supabaseAdmin
      .from("reservations")
      .update(riga)
      .eq("cancel_token", token)
      .in("status", ["confirmed", "pending"])
      .select(CAMPI_EMAIL)
      .single();
  }
  if (upd.error || !upd.data) return json({ ok: false, error: "erreurEnvoi" }, 500);

  // Plan de salle: riassegnazione con i nuovi dettagli (solo se confermata —
  // le demandes pending ricevono i tavoli alla conferma del ristoratore)
  if (attuale.status === "confirmed") {
    await assegnaESalva(String(upd.data.id), {
      date: riga.date,
      heure: riga.heure,
      service_key: riga.service_key,
      zone: riga.zone,
      people: riga.people,
    });
  }

  // Email aggiornata al cliente: conferma, o « demande reçue » se pending
  if (attuale.status === "pending") void inviaNotificheDemandeResa(upd.data as unknown as ResaEmail);
  else void inviaConfermaResa(upd.data as unknown as ResaEmail);

  return json({ ok: true, id: upd.data.id, cancel_token: upd.data.cancel_token });
};

// ============================================================
// DELETE → annulla una prenotazione dal link "Annuler" (cancel_token).
// status → cancelled; annulla l'email recensione programmata. Idempotente.
// ============================================================
export const DELETE: APIRoute = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* token può arrivare anche in query, ma qui è nel body */
  }
  const token = String(body.token ?? "");
  if (!RE_UUID.test(token)) return json({ ok: false, error: "lienInvalide" }, 404);

  const stamp = new Date().toISOString();
  let upd = await supabaseAdmin
    .from("reservations")
    .update({ status: "cancelled", client_action_at: stamp })
    .eq("cancel_token", token)
    .in("status", ["confirmed", "pending"])
    .select("*")
    .maybeSingle();
  // Migrazione client_action_at non ancora lanciata: si annulla senza il campo
  if (upd.error && String(upd.error.message ?? "").includes("client_action_at")) {
    upd = await supabaseAdmin
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("cancel_token", token)
      .in("status", ["confirmed", "pending"])
      .select("*")
      .maybeSingle();
  }
  if (upd.error) return json({ ok: false, error: "erreurEnvoi" }, 500);
  if (!upd.data) return json({ ok: false, error: "lienInvalide" }, 404);

  // Annulla la recensione programmata (se presente)
  const emailId = String((upd.data as { review_email_id?: string | null }).review_email_id ?? "");
  if (emailId) {
    void annullaEmailReview(emailId);
    void supabaseAdmin.from("reservations").update({ review_email_id: null }).eq("id", upd.data.id);
  }

  return json({ ok: true });
};
