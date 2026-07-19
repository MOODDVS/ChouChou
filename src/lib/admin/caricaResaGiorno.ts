import { supabaseAdmin } from "../db";

// Carica le prenotazioni di un giorno + la configurazione + le chiusure, nella
// forma esatta attesa dalla pagina /admin/reservations. UNICA fonte di verità:
// usata sia da GET /api/admin/reservations?date= sia dal render lato server
// (SSR, Fase 2) del frontmatter della pagina, così non possono divergere.

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
  hold_minutes?: number;
  config?: ResaGiornoConfig;
  missing?: boolean;
}

export async function caricaResaGiorno(date: string): Promise<ResaGiorno> {
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("*")
    .eq("date", date)
    .order("heure", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    // Tabella non ancora creata (migrazione da lanciare): pagina vuota, non rotta
    return { reservations: [], couverts: 0, missing: true };
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

  return {
    reservations: data ?? [],
    couverts,
    closures,
    zone_closures: zoneClosures,
    hold_minutes: hold,
    config: { slot_minutes: slot, services, zones, capacity, zone_seats: zoneSeats, timezone: tz },
  };
}
