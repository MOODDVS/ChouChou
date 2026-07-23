import { supabaseAdmin } from "../db";
import { postiDalPlan } from "../planSalle";

// Carica le prenotazioni di un giorno + la configurazione + le chiusure, nella
// forma esatta attesa dalla pagina /admin/reservations. UNICA fonte di verità:
// usata sia da GET /api/admin/reservations?date= sia dal render lato server
// (SSR, Fase 2) del frontmatter della pagina, così non possono divergere.
// Tutte le letture partono IN PARALLELO (una sola andata al DB di latenza).

export interface ResaGiornoConfig {
  slot_minutes: number;
  services: { key: string; from: string; to: string }[];
  zones: string[];
  capacity: number;
  zone_seats: Record<string, number>;
  timezone: string;
}

export interface ResaGiorno {
  reservations: any[];
  couverts: number;
  closures?: { service_key: string; reason: string }[];
  zone_closures?: { zone: string; reason: string }[];
  special_open?: boolean; // jour spécial "ouvert": scavalca i giorni dei services
  special_services?: string[] | null; // lista servizi attivi del giorno speciale (null = tutti)
  hold_minutes?: number;
  config?: ResaGiornoConfig;
  missing?: boolean;
}

export async function caricaResaGiorno(date: string): Promise<ResaGiorno> {
  const [reseQ, cfgQ, chQ, zchQ, spQ] = await Promise.all([
    supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("date", date)
      .order("heure", { ascending: true })
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", [
        "reservation_hold_minutes",
        "reservation_slot_minutes",
        "reservation_services",
        "reservation_zones",
        "reservation_plan_mode",
        "timezone",
        "service_closures_permanent",
        "zone_closures_permanent",
      ]),
    supabaseAdmin.from("service_closures").select("service_key, reason").eq("date", date),
    supabaseAdmin.from("zone_closures").select("zone, reason").eq("date", date),
    supabaseAdmin
      .from("special_days")
      .select("type, services")
      .lte("date_from", date)
      .gte("date_to", date)
      .then(async (r) => {
        // Migrazione #33 non ancora lanciata: senza la colonna (= tutti)
        if (r.error && String(r.error.message ?? "").includes("services")) {
          return supabaseAdmin.from("special_days").select("type").lte("date_from", date).gte("date_to", date);
        }
        return r;
      }),
  ]);

  const { data, error } = reseQ;
  if (error) {
    // Tabella non ancora creata (migrazione da lanciare): pagina vuota, non rotta
    return { reservations: [], couverts: 0, missing: true };
  }

  // Config réservations (Réglages): durata tavolo, créneau, services, sezioni
  let hold = 90;
  let slot = 30;
  let services: { key: string; from: string; to: string }[] = [];
  let zones: string[] = [];
  let capacity = 0;
  const zoneSeats: Record<string, number> = {};
  let tz = "Europe/Brussels";
  try {
    const m = new Map((cfgQ.data ?? []).map((r) => [r.key, String(r.value ?? "")]));
    const nH = Math.floor(Number(m.get("reservation_hold_minutes")));
    if (Number.isFinite(nH) && nH >= 15 && nH <= 360) hold = nH;
    const nS = Math.floor(Number(m.get("reservation_slot_minutes")));
    if (Number.isFinite(nS) && nS >= 10 && nS <= 120) slot = nS;
    try {
      const arr = JSON.parse(m.get("reservation_services") || "[]");
      if (Array.isArray(arr)) services = arr;
    } catch { /* vuoto */ }
    const planPosti = await postiDalPlan(m.get("reservation_plan_mode"));
    try {
      const arr = JSON.parse(m.get("reservation_zones") || "[]");
      if (Array.isArray(arr)) {
        zones = arr.map((z: { name?: string }) => String(z.name ?? "")).filter(Boolean);
        for (const z of arr as { name?: string; seats?: unknown }[]) {
          const nome = String(z.name ?? "");
          const n = planPosti ? Math.floor(planPosti.get(nome.trim()) ?? 0) : Math.floor(Number(z.seats));
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

  // ---- Auto-Fini ----
  // Il bottone "Fini ?" appare a fine durée; se il ristoratore lo ignora per
  // 15 minuti, la prenotazione si chiude DA SOLA (status → done). Gira qui
  // (fonte unica di lettura del giorno): ogni caricamento/refresh la applica.
  try {
    const oggiTz = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    if (date <= oggiTz) {
      const [hh, mm] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date())
        .split(":");
      const adesso = Number(hh) * 60 + Number(mm);
      const minutiHH = (v: string): number => {
        const m = /^(\d{1,2}):(\d{2})/.exec(v);
        return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
      };
      const holdDiKey = (key: string | null): number => {
        const sv = (services as { key?: string; hold?: unknown }[]).find((x) => x.key === key);
        const n = Math.floor(Number(sv?.hold));
        return Number.isFinite(n) && n >= 15 && n <= 360 ? n : hold;
      };
      const daChiudere = (data ?? []).filter((r) => {
        if (r.status !== "confirmed" && r.status !== "seated") return false;
        if (date < oggiTz) return true; // giorni passati: si chiudono comunque
        const inizio = minutiHH(String(r.heure ?? ""));
        if (inizio < 0) return false;
        return adesso >= inizio + holdDiKey(r.service_key ?? null) + 15;
      });
      if (daChiudere.length) {
        // Durata reale del tavolo per l'auto-Fini: il manager ha lasciato correre
        // → si registra fino a heure + durée + 15 (dall'arrivo reale se seated_at).
        const offMin = (() => {
          try {
            const d = new Date();
            const loc = new Date(d.toLocaleString("en-US", { timeZone: tz }));
            const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
            return (loc.getTime() - utc.getTime()) / 60000;
          } catch {
            return 0;
          }
        })();
        const esiti = await Promise.all(
          daChiudere.map((r) => {
            const inizioMs = Date.parse(`${date}T${String(r.heure ?? "").slice(0, 5)}:00Z`) - offMin * 60000;
            const fineMs = inizioMs + (holdDiKey(r.service_key ?? null) + 15) * 60000;
            const arrivo = r.seated_at ? Date.parse(String(r.seated_at)) : NaN;
            const startMs = Number.isFinite(arrivo) ? Math.min(arrivo, fineMs) : inizioMs;
            const durata = Number.isFinite(fineMs) ? Math.max(0, Math.round((fineMs - startMs) / 60000)) : null;
            r.table_minutes = durata;
            return supabaseAdmin.from("reservations").update({ status: "done", table_minutes: durata }).eq("id", r.id);
          })
        );
        // Migrazione #27 non ancora lanciata: si chiude senza durata
        if (esiti.some((e) => e.error && String(e.error.message ?? "").includes("table_minutes"))) {
          await supabaseAdmin
            .from("reservations")
            .update({ status: "done" })
            .in("id", daChiudere.map((r) => r.id));
        }
        for (const r of daChiudere) r.status = "done"; // riflesso subito nella risposta
      }
    }
  } catch { /* mai bloccante */ }

  const couverts = (data ?? [])
    .filter((r) => r.status === "confirmed" || r.status === "seated")
    .reduce((s, r) => s + (r.people ?? 0), 0);

  // Chiusure di servizio e di section del giorno (tabelle assenti = nessuna)
  // + jour spécial "ouvert" (scavalca i giorni di applicazione dei services)
  const closures = (!chQ.error && chQ.data ? chQ.data : []) as { service_key: string; reason: string }[];
  const zoneClosures = (!zchQ.error && zchQ.data ? zchQ.data : []) as { zone: string; reason: string }[];
  // Chiusure «jusqu'à réouverture» (app_config): valgono per OGNI data.
  // reason "permanent" così la UI le distingue (pillole, riapertura).
  try {
    const mPerm = new Map((cfgQ.data ?? []).map((r) => [r.key, String(r.value ?? "")]));
    const leggiPerm = (k: string): string[] => {
      try {
        const a = JSON.parse(mPerm.get(k) || "[]");
        return Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : [];
      } catch { return []; }
    };
    for (const k of leggiPerm("service_closures_permanent")) {
      if (!closures.some((c) => c.service_key === k)) closures.push({ service_key: k, reason: "permanent" });
    }
    for (const z of leggiPerm("zone_closures_permanent")) {
      if (!zoneClosures.some((c) => c.zone === z)) zoneClosures.push({ zone: z, reason: "permanent" });
    }
  } catch { /* mai bloccante */ }
  const righeSp = (!spQ.error && spQ.data ? spQ.data : []) as { type: string; services?: unknown }[];
  const specialOpen = righeSp.some((r) => r.type === "open") && !righeSp.some((r) => r.type === "closed");
  const rigaOpen = specialOpen ? righeSp.find((r) => r.type === "open") : undefined;
  const specialServices =
    rigaOpen && Array.isArray(rigaOpen.services) ? (rigaOpen.services as unknown[]).map((t) => String(t)) : null;

  return {
    reservations: data ?? [],
    couverts,
    closures,
    zone_closures: zoneClosures,
    special_open: specialOpen,
    special_services: specialOpen ? specialServices : null,
    hold_minutes: hold,
    config: { slot_minutes: slot, services, zones, capacity, zone_seats: zoneSeats, timezone: tz },
  };
}
