import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { postiDalPlan, assegnaESalva } from "../../../lib/planSalle";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { emailReviewResa, annullaEmailReview, emailAnnullataResa, emailNoShowResa, inviaConfermaResa, type ResaEmail } from "../../../lib/notifications";
import { registraCliente } from "../../../lib/registraCliente";
import { caricaResaGiorno } from "../../../lib/admin/caricaResaGiorno";

/** Id tavoli validi (uuid) da un body: max 8, [] -> null. */
function tavoliDalBody(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ids = (v as unknown[]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 8);
  return ids.length ? ids : null;
}

/** Registra il cliente di una prenotazione manuale nella rubrica `clients`. */
function registraClienteResa(r: { first_name?: string; last_name?: string; email?: string; phone?: string }): void {
  // NB: nessuna cattura lingua qui — le prenotazioni manuali (walk-in/telefono)
  // hanno lang di default 'fr' e non riflettono una scelta del cliente. La
  // lingua del cliente si cattura solo dal widget web (vedi registraCliente in
  // api/reservation.ts) o si imposta a mano nel modale cliente.
  void registraCliente({
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    email: r.email ?? null,
    phone: r.phone ?? null,
  });
}

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
const STATI = ["pending", "confirmed", "seated", "cancelled", "noshow", "done"];
// Lingue supportate dalle email cliente (widget prenotazione). Default fr.
const LINGUE_RESA = new Set(["fr", "en", "es", "it", "nl", "de", "ru", "ar", "zh", "ja"]);
const normLang = (v: unknown): string => {
  const c = String(v ?? "").trim().toLowerCase();
  return LINGUE_RESA.has(c) ? c : "fr";
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Polling: nuove prenotazioni PUBBLICHE create dopo `new_since` (per il
  // toast globale dell'admin). Solo source web/google (le walk-in/phone le
  // crea lo staff stesso → nessun avviso). Ritorna anche l'ora del server.
  const newSince = url.searchParams.get("new_since");
  if (newSince) {
    const now = new Date().toISOString();

    // Nuove prenotazioni (INSERT dopo `since`)
    const ins = await supabaseAdmin
      .from("reservations")
      .select("id, first_name, last_name, date, heure, people, source, status, created_at")
      .gt("created_at", newSince)
      .order("created_at", { ascending: true })
      .limit(30);

    // Azioni del CLIENTE (annullo / modifica dal link email), se la colonna
    // client_action_at esiste. Se la migrazione non è lanciata: lista vuota.
    let chgRows: { id: string; first_name: string; last_name: string; date: string; heure: string; people: number; status: string }[] = [];
    try {
      const chg = await supabaseAdmin
        .from("reservations")
        .select("id, first_name, last_name, date, heure, people, status, client_action_at")
        .gt("client_action_at", newSince)
        .order("client_action_at", { ascending: true })
        .limit(30);
      if (!chg.error && chg.data) chgRows = chg.data as typeof chgRows;
    } catch {
      chgRows = [];
    }

    const changedIds = new Set(chgRows.map((r) => r.id));
    const news = (ins.error ? [] : ins.data ?? [])
      .filter((r) => (r.source === "web" || r.source === "google") && !changedIds.has(r.id))
      .map((r) => ({ id: r.id, first_name: r.first_name, last_name: r.last_name, date: r.date, heure: r.heure, people: r.people }));
    const changes = chgRows.map((r) => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      date: r.date,
      heure: r.heure,
      people: r.people,
      kind: r.status === "cancelled" ? "cancelled" : "modified",
    }));

    return json({ news, changes, now });
  }

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

  // Typeahead CLIENTI per il modale "Nuova prenotazione": cerca per nome/cognome
  // nella tabella `clients` (manuali/materializzati) + nelle prenotazioni passate,
  // deduplica e ritorna max 8 risultati leggeri (nome, email, telefono).
  const cs = (url.searchParams.get("client_search") ?? "").trim();
  if (cs.length >= 2) {
    const pulito = cs.replace(/[%,()*]/g, "").slice(0, 60);
    if (!pulito) return json({ clients: [] });
    type Match = { name: string; first_name: string; last_name: string; email: string; phone: string; blocked: boolean };
    const out = new Map<string, Match>();
    const keyOf = (m: Match) => (m.email || m.phone || m.name).toLowerCase();

    // 1) tabella clients (campo `name` unico)
    try {
      const { data } = await supabaseAdmin
        .from("clients")
        .select("name, email, phone, blocked, hidden")
        .ilike("name", `%${pulito}%`)
        .limit(12);
      for (const c of (data ?? []) as { name?: string; email?: string; phone?: string; blocked?: boolean; hidden?: boolean }[]) {
        if (c.hidden) continue;
        const name = String(c.name ?? "").trim();
        if (!name) continue;
        const parts = name.split(/\s+/);
        const m: Match = {
          name,
          first_name: parts[0] ?? "",
          last_name: parts.slice(1).join(" "),
          email: String(c.email ?? "").trim(),
          phone: String(c.phone ?? "").trim(),
          blocked: Boolean(c.blocked),
        };
        out.set(keyOf(m), m);
      }
    } catch {
      /* colonne blocked/hidden assenti su installazioni non migrate: si ignora */
    }

    // 2) prenotazioni passate (first_name / last_name)
    try {
      const { data } = await supabaseAdmin
        .from("reservations")
        .select("first_name, last_name, email, phone")
        .or(`first_name.ilike.%${pulito}%,last_name.ilike.%${pulito}%`)
        .order("created_at", { ascending: false })
        .limit(40);
      for (const r of (data ?? []) as { first_name?: string; last_name?: string; email?: string; phone?: string }[]) {
        const fn = String(r.first_name ?? "").trim();
        const ln = String(r.last_name ?? "").trim();
        const name = `${fn} ${ln}`.trim();
        if (!name) continue;
        const m: Match = { name, first_name: fn, last_name: ln, email: String(r.email ?? "").trim(), phone: String(r.phone ?? "").trim(), blocked: false };
        const k = keyOf(m);
        if (!out.has(k)) out.set(k, m);
      }
    } catch {
      /* ignore */
    }

    return json({ clients: [...out.values()].slice(0, 8) });
  }

  // Statistiche CLIENTE per il modale dettagli (match per email e/o telefono)
  if (url.searchParams.get("client_stats") === "1") {
    const email = (url.searchParams.get("client_email") ?? "").trim().toLowerCase();
    const phone = (url.searchParams.get("client_phone") ?? "").trim();
    if (!email && !phone) return json({ error: "Client manquant" }, 400);

    type RigaStat = {
      id: string;
      date: string;
      heure: string;
      people: number | null;
      status: string;
      source?: string | null;
      created_at: string;
      table_minutes?: number | null;
      spent_cents?: number | null;
    };
    const campiStat = "id, date, heure, people, status, source, created_at, table_minutes, spent_cents";
    const righe = new Map<string, RigaStat>();
    if (email) {
      const { data } = await supabaseAdmin.from("reservations").select(campiStat).ilike("email", email).limit(500);
      for (const r of (data ?? []) as RigaStat[]) righe.set(r.id, r);
    }
    if (phone) {
      const { data } = await supabaseAdmin.from("reservations").select(campiStat).eq("phone", phone).limit(500);
      for (const r of (data ?? []) as RigaStat[]) righe.set(r.id, r);
    }
    const tutte = [...righe.values()];

    // Anticipo di prenotazione: momento della résa (fuso ristorante) - created_at.
    const { data: tzRow } = await supabaseAdmin.from("app_config").select("value").eq("key", "timezone").maybeSingle();
    const tz = String(tzRow?.value || "Europe/Brussels");
    const offsetMin = (utcMs: number): number => {
      try {
        const d = new Date(utcMs);
        const loc = new Date(d.toLocaleString("en-US", { timeZone: tz }));
        const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
        return (loc.getTime() - utc.getTime()) / 60000;
      } catch {
        return 0;
      }
    };

    const visites = tutte.filter((r) => r.status === "done" || r.status === "seated").length;
    const noshows = tutte.filter((r) => r.status === "noshow").length;
    const annullate = tutte.filter((r) => r.status === "cancelled").length;
    const conPers = tutte.filter((r) => r.status !== "cancelled" && Number(r.people) > 0);
    const mediaPers = conPers.length
      ? conPers.reduce((t, r) => t + Number(r.people), 0) / conPers.length
      : null;
    const anticipi = tutte
      .filter((r) => r.status !== "cancelled" && r.source !== "walkin" && r.created_at && /^\d{2}:\d{2}/.test(r.heure ?? ""))
      .map((r) => {
        const base = Date.parse(`${r.date}T12:00:00Z`);
        const resaMs = Date.parse(`${r.date}T${r.heure.slice(0, 5)}:00Z`) - offsetMin(base) * 60000;
        return (resaMs - Date.parse(r.created_at)) / 60000;
      })
      .filter((m) => Number.isFinite(m) && m >= 0);
    const mediaAnticipo = anticipi.length ? anticipi.reduce((a, b) => a + b, 0) / anticipi.length : null;
    const durate = tutte
      .filter((r) => r.status === "done" && Number.isFinite(Number(r.table_minutes)) && Number(r.table_minutes) > 0)
      .map((r) => Number(r.table_minutes));
    const mediaTavolo = durate.length ? durate.reduce((a, b) => a + b, 0) / durate.length : null;
    const spese = tutte
      .filter((r) => Number.isFinite(Number(r.spent_cents)) && Number(r.spent_cents) > 0)
      .map((r) => Number(r.spent_cents));
    const mediaSpesa = spese.length ? spese.reduce((a, b) => a + b, 0) / spese.length : null;

    return json({
      total: tutte.length,
      visites,
      noshows,
      cancelled: annullate,
      avg_people: mediaPers,
      avg_lead_min: mediaAnticipo,
      avg_table_min: mediaTavolo,
      avg_spent_cents: mediaSpesa,
    });
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
      supabaseAdmin.from("app_config").select("key, value").in("key", ["reservation_services", "reservation_zones", "reservation_plan_mode", "timezone"]),
      supabaseAdmin
        .from("reservations")
        .select("date, service_key, people, status")
        .gte("date", primo)
        .lte("date", ultimo)
        .neq("status", "cancelled"), // tutte tranne le annullate (per il pallino "occupé")
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
    const planPosti = await postiDalPlan(cfgMap.get("reservation_plan_mode"));
    try {
      const arr = JSON.parse(cfgMap.get("reservation_zones") || "[]");
      if (Array.isArray(arr)) {
        capienza = arr.reduce((t: number, z: { name?: unknown; seats?: unknown }) => {
          const n = planPosti ? Math.floor(planPosti.get(String(z.name ?? "").trim()) ?? 0) : Math.floor(Number(z.seats));
          return t + (Number.isFinite(n) && n > 0 ? n : 0);
        }, 0);
      }
    } catch { /* nessuna section: mai completo */ }

    // Oggi nel fuso del ristorante (per contare i "Fini" solo nel passato)
    const tz = cfgMap.get("timezone") || "Europe/Brussels";
    let oggiIso = new Date().toISOString().slice(0, 10);
    try {
      oggiIso = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    } catch { /* timezone non valida: fallback UTC */ }

    // Coperti per giorno+service (prenotazioni senza service noto: ignorate).
    // Occupano: confirmed + seated; i "done" contano solo per i giorni passati
    // (storico "complet"), oggi/futuro liberano il tavolo. No-show: mai.
    const coperti = new Map<string, number>();
    const copertiGiorno = new Map<string, number>();
    const occupati = new Set<string>();
    for (const r of rese.data ?? []) {
      occupati.add(r.date);
      const conta =
        r.status === "confirmed" || r.status === "seated" || (r.status === "done" && r.date < oggiIso);
      if (!conta) continue;
      const k = `${r.date}|${r.service_key ?? ""}`;
      coperti.set(k, (coperti.get(k) ?? 0) + (r.people ?? 0));
      copertiGiorno.set(r.date, (copertiGiorno.get(r.date) ?? 0) + (r.people ?? 0));
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
          : (copertiGiorno.get(iso) ?? 0) >= capienza;
        if (pieno) pieni.push(iso);
      }
    }
    // Tasso d'occupazione per giorno (colore del pallino nel datepicker):
    // coperti contati / capacità della giornata (capienza sala × n. services)
    const taux: Record<string, number> = {};
    if (capienza > 0) {
      const capGiorno = capienza * Math.max(1, services.length);
      for (const [iso, n] of copertiGiorno) taux[iso] = Math.round((n / capGiorno) * 100);
    }
    return json({ closed: chiusi, full: pieni, busy: [...occupati].sort(), taux });
  }

  // Intervallo di giorni (viste Semaine/Mois): tutte le prenotazioni ordinate
  const da = url.searchParams.get("from") ?? "";
  const a = url.searchParams.get("to") ?? "";
  if (RE_DATA.test(da) && RE_DATA.test(a) && da <= a) {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .gte("date", da)
      .lte("date", a)
      .order("date", { ascending: true })
      .order("heure", { ascending: true })
      .limit(1000);
    if (error) return json({ reservations: [] });
    return json({ reservations: data ?? [] });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);

  // Stessa logica del render lato server (SSR): fonte unica in caricaResaGiorno.
  return json(await caricaResaGiorno(date));
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
    birthday?: boolean;
    special_event?: boolean;
    spent_cents?: number | null;
    source?: string;
    lang?: string;
    tables?: unknown; // attribuzione MANUALE (auto_tables spento)
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
  const langCliente = normLang(body.lang);

  const svKey = /^[a-z_]{1,30}$/.test(String(body.service_key ?? "")) ? String(body.service_key) : null;
  const zonaSel = String(body.zone ?? "").trim() || null;
  const riga: Record<string, unknown> = {
    source: body.source === "phone" ? "phone" : "walkin",
  };
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .insert({
      ...riga,
      date,
      heure,
      service_key: svKey,
      people,
      zone: zonaSel,
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
      birthday: Boolean(body.birthday),
      special_event: Boolean(body.special_event),
      lang: langCliente,
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
          service_key: svKey,
          people,
          zone: zonaSel,
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
          birthday: Boolean(body.birthday),
          special_event: Boolean(body.special_event),
          lang: langCliente,
          status: "confirmed",
        })
        .select("*")
        .single();
      if (!e2 && d2) {
        await assegnaESalva(String((d2 as { id?: unknown }).id ?? ""), { date, heure, service_key: svKey, zone: zonaSel, people });
        if (body.tables !== undefined && Array.isArray(body.tables)) {
          try {
            await supabaseAdmin.from("reservations").update({ tables: tavoliDalBody(body.tables) }).eq("id", String((d2 as { id?: unknown }).id ?? ""));
          } catch { /* #37 assente */ }
        }
        if (String((d2 as { email?: string }).email ?? "").trim()) {
          void inviaConfermaResa(d2 as unknown as ResaEmail);
        }
        void programmaReview(d2 as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
        registraClienteResa(d2 as { first_name?: string; last_name?: string; email?: string; phone?: string });
        return json({ reservation: d2 });
      }
    }
    return json({ error: "Création impossible" }, 500);
  }
  await assegnaESalva(String((data as { id?: unknown }).id ?? ""), { date, heure, service_key: svKey, zone: zonaSel, people });
  if (body.tables !== undefined && Array.isArray(body.tables)) {
    try {
      await supabaseAdmin.from("reservations").update({ tables: tavoliDalBody(body.tables) }).eq("id", String((data as { id?: unknown }).id ?? ""));
    } catch { /* #37 assente */ }
  }
  // Se lo staff ha inserito un'email, parte la conferma al cliente (come per
  // le prenotazioni web). Senza email (walk-in anonimo) non si invia nulla.
  if (String((data as { email?: string }).email ?? "").trim()) {
    void inviaConfermaResa(data as unknown as ResaEmail);
  }
  void programmaReview(data as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
  registraClienteResa(data as { first_name?: string; last_name?: string; email?: string; phone?: string });
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
    birthday?: boolean;
    special_event?: boolean;
    spent_cents?: number | null;
    source?: string;
    lang?: string;
    tables?: unknown; // attribuzione MANUALE (auto_tables spento)
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
  let statoPrima = ""; // per la transizione Demande (pending) -> Confirmée
  if (body.status !== undefined) {
    if (!STATI.includes(body.status)) return json({ error: "Statut invalide" }, 400);
    upd.status = body.status;
    if (body.status === "confirmed") {
      const { data: pv } = await supabaseAdmin.from("reservations").select("status").eq("id", id).maybeSingle();
      statoPrima = String(pv?.status ?? "");
    }
    // Timer tavolo: "En cours" manuale = arrivo reale; ritorno a Confirmée lo azzera
    if (body.status === "seated") {
      upd.seated_at = new Date().toISOString();
      upd.table_minutes = null;
    }
    if (body.status === "confirmed") {
      upd.seated_at = null;
      upd.table_minutes = null;
    }
    // No-show / annulée: il tempo al tavolo non conta (azzerato)
    if (body.status === "noshow" || body.status === "cancelled") upd.table_minutes = null;
    // Fini MANUALE: registra la durata reale (dall'arrivo al click)
    if (body.status === "done") {
      const { data: cur } = await supabaseAdmin
        .from("reservations")
        .select("date, heure, seated_at, status")
        .eq("id", id)
        .maybeSingle();
      if (cur && (cur.status === "confirmed" || cur.status === "seated")) {
        const { data: tzRow } = await supabaseAdmin
          .from("app_config")
          .select("value")
          .eq("key", "timezone")
          .maybeSingle();
        const tz = String(tzRow?.value || "Europe/Brussels");
        let offMin = 0;
        try {
          const d = new Date();
          const loc = new Date(d.toLocaleString("en-US", { timeZone: tz }));
          const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
          offMin = (loc.getTime() - utc.getTime()) / 60000;
        } catch { /* fuso invalido: UTC */ }
        const inizioMs =
          Date.parse(`${cur.date}T${String(cur.heure ?? "").slice(0, 5)}:00Z`) - offMin * 60000;
        const arrivo = cur.seated_at ? Date.parse(String(cur.seated_at)) : NaN;
        const startMs = Number.isFinite(arrivo) ? arrivo : inizioMs;
        if (Number.isFinite(startMs)) {
          upd.table_minutes = Math.max(0, Math.round((Date.now() - startMs) / 60000));
        }
      }
    }
  }
  if ((body as { extra_add?: number }).extra_add !== undefined) {
    const add = Math.floor(Number((body as { extra_add?: number }).extra_add));
    if (Number.isFinite(add) && add > 0) {
      const { data: cur } = await supabaseAdmin
        .from("reservations")
        .select("extra_minutes, status, seated_at")
        .eq("id", id)
        .maybeSingle();
      const base = Math.max(0, Math.floor(Number(cur?.extra_minutes) || 0));
      upd.extra_minutes = Math.min(600, base + add);
      if (cur?.status === "done") {
        upd.status = cur.seated_at ? "seated" : "confirmed";
        upd.table_minutes = null;
      }
    }
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
  if (body.lang !== undefined) upd.lang = normLang(body.lang);
  if (body.high_chair !== undefined) upd.high_chair = Boolean(body.high_chair);
  if (body.quiet !== undefined) upd.quiet = Boolean(body.quiet);
  if (body.birthday !== undefined) upd.birthday = Boolean(body.birthday);
  if (body.special_event !== undefined) upd.special_event = Boolean(body.special_event);
  if (body.spent_cents !== undefined) {
    if (body.spent_cents === null) {
      upd.spent_cents = null;
    } else {
      const n = Math.round(Number(body.spent_cents));
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return json({ error: "Montant invalide" }, 400);
      upd.spent_cents = n;
    }
  }
  if (body.business !== undefined) {
    upd.business = Boolean(body.business);
    upd.company = Boolean(body.business) ? String(body.company ?? "").trim() : "";
  }
  if (body.source !== undefined) {
    if (body.source !== "walkin" && body.source !== "phone") return json({ error: "Origine invalide" }, 400);
    upd.source = body.source;
  }
  if (body.tables !== undefined && Array.isArray(body.tables)) upd.tables = tavoliDalBody(body.tables);
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
  // Migrazione #26 non ancora lanciata: si riprova senza la colonna seated_at
  if (error && upd.seated_at !== undefined && error.message.includes("seated_at")) {
    delete upd.seated_at;
    if (Object.keys(upd).length) {
      ({ data, error } = await supabaseAdmin
        .from("reservations")
        .update(upd)
        .eq("id", id)
        .select("*")
        .single());
    }
  }
  // Migrazione #27 non ancora lanciata: si riprova senza la colonna table_minutes
  if (error && upd.table_minutes !== undefined && error.message.includes("table_minutes")) {
    delete upd.table_minutes;
    if (Object.keys(upd).length) {
      ({ data, error } = await supabaseAdmin
        .from("reservations")
        .update(upd)
        .eq("id", id)
        .select("*")
        .single());
    }
  }
  // Migrazione #37 non ancora lanciata: si riprova senza la colonna tables
  if (error && upd.tables !== undefined && error.message.includes("tables")) {
    delete upd.tables;
    if (Object.keys(upd).length) {
      ({ data, error } = await supabaseAdmin
        .from("reservations")
        .update(upd)
        .eq("id", id)
        .select("*")
        .single());
    }
  }
  // Migrazione #28 non ancora lanciata: si riprova senza la colonna spent_cents
  if (error && upd.spent_cents !== undefined && error.message.includes("spent_cents")) {
    delete upd.spent_cents;
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
  // Annullata dal ristoratore: avvisa il cliente nella sua lingua
  if (upd.status === "cancelled" && (data as { email?: string }).email) {
    // Motivo facoltativo dal modale admin: mostrato nell'email al cliente.
    const motivo = String((body as { reason?: unknown }).reason ?? "").trim().slice(0, 500);
    (data as Record<string, unknown>).cancel_reason = motivo || null;
    void emailAnnullataResa(data as unknown as ResaEmail);
  }
  // No-show: email formale al cliente (rispettosa ma ferma), nella sua lingua.
  // Solo alla transizione verso no-show, per non reinviare su PATCH ripetute.
  if (
    upd.status === "noshow" &&
    statoPrima !== "noshow" &&
    (body as { notify?: unknown }).notify === true &&
    (data as { email?: string }).email
  ) {
    void emailNoShowResa(data as unknown as ResaEmail);
  }
  // Demande CONFERMATA dal ristoratore: ORA parte l'email di conferma al
  // cliente + la recensione J+1 (in modalità demande non erano partite)
  if (upd.status === "confirmed" && statoPrima === "pending") {
    if ((data as { email?: string }).email) void inviaConfermaResa(data as unknown as ResaEmail);
    void programmaReview(data as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
  }
  // RIPRISTINO da Annulée/No-show a Confirmée: la recensione era stata
  // annullata su Resend → si RIPROGRAMMA. Solo se non ce n'è già una attiva
  // (review_email_id vuoto — l'annullo lo azzera); emailReviewResa salta da
  // sola gli orari già passati (mai invii retroattivi).
  if (upd.status === "confirmed" && (statoPrima === "cancelled" || statoPrima === "noshow")) {
    const giaProgrammata = String((data as { review_email_id?: string | null }).review_email_id ?? "");
    if (!giaProgrammata) {
      void programmaReview(data as { id: string; date: string; first_name: string; last_name: string; email: string; lang: string });
    }
  }
  // Plan de salle: annullata/no-show libera i tavoli; dati cambiati (o ritorno
  // a Confirmée) -> riassegnazione con i valori AGGIORNATI della riga
  if (upd.status === "cancelled" || upd.status === "noshow") {
    try { await supabaseAdmin.from("reservations").update({ tables: null }).eq("id", id); } catch { /* #37 assente */ }
  } else if (
    body.tables === undefined && // tavoli scelti a mano: non si ricalcola nulla
    (body.date !== undefined || body.heure !== undefined || body.people !== undefined ||
      body.zone !== undefined || body.service_key !== undefined || upd.status === "confirmed")
  ) {
    const r = data as { date?: string; heure?: string; service_key?: string | null; zone?: string | null; people?: number };
    await assegnaESalva(id, {
      date: String(r.date ?? ""),
      heure: String(r.heure ?? "").slice(0, 5),
      service_key: r.service_key ?? null,
      zone: r.zone ?? null,
      people: Math.floor(Number(r.people)) || 1,
    });
  }
  return json({ reservation: data });
};

// DELETE /api/admin/reservations?id=... — ELIMINA DEFINITIVAMENTE la
// prenotazione (riga rimossa dal DB). Nessuna email al cliente: l'annullamento
// con avviso resta la transizione di stato → cancelled (badge di stato).
// Arriva come POST + X-Method-Override: DELETE (il WAF blocca i DELETE mobili).
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  // Se c'era una email-recensione programmata, annullala prima di eliminare.
  try {
    const { data: pre } = await supabaseAdmin
      .from("reservations")
      .select("review_email_id")
      .eq("id", id)
      .maybeSingle();
    const emailId = (pre as { review_email_id?: string | null } | null)?.review_email_id;
    if (emailId) void annullaEmailReview(emailId);
  } catch {
    /* best-effort */
  }

  const { error } = await supabaseAdmin.from("reservations").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
