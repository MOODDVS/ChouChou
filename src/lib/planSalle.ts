import { supabaseAdmin } from "./db";

/**
 * Plan de salle come FONTE DEI POSTI (reservation_plan_mode = "1"):
 * somma i posti dei tavoli disegnati (restaurant_tables) per ogni section.
 * Ritorna null se il modo è spento, la migrazione #36 manca o c'è un
 * errore → il chiamante usa i couverts dichiarati nelle Sections.
 * Una section senza tavoli disegnati vale 0 posti (non prenotabile).
 */
export async function postiDalPlan(planMode: string | undefined): Promise<Map<string, number> | null> {
  if (planMode !== "1") return null;
  try {
    const { data, error } = await supabaseAdmin.from("restaurant_tables").select("zone, seats");
    if (error || !data) return null;
    const m = new Map<string, number>();
    for (const r of data as { zone?: unknown; seats?: unknown }[]) {
      const z = String(r.zone ?? "").trim();
      const n = Math.floor(Number(r.seats));
      if (z && Number.isFinite(n) && n > 0) m.set(z, (m.get(z) ?? 0) + n);
    }
    return m;
  } catch {
    return null;
  }
}

/**
 * Max persone che possono sedersi INSIEME per ogni section (plan mode):
 * il tavolo singolo più capiente oppure la catena di liaison più grande.
 * null se il plan mode è spento o i dati mancano.
 */
export async function maxInsiemePerZona(planMode: string | undefined): Promise<Map<string, number> | null> {
  if (planMode !== "1") return null;
  try {
    const [{ data: tavoli, error }, { data: cfg }] = await Promise.all([
      supabaseAdmin.from("restaurant_tables").select("id, zone, seats"),
      supabaseAdmin.from("app_config").select("value").eq("key", "reservation_plan_links").maybeSingle(),
    ]);
    if (error || !tavoli) return null;
    const posti = new Map<string, number>();
    const m = new Map<string, number>();
    for (const r of tavoli as { id?: unknown; zone?: unknown; seats?: unknown }[]) {
      const z = String(r.zone ?? "").trim();
      const n = Math.floor(Number(r.seats));
      if (!z || !Number.isFinite(n) || n <= 0) continue;
      posti.set(String(r.id), n);
      m.set(z, Math.max(m.get(z) ?? 0, n));
    }
    let legami: Record<string, unknown> = {};
    try { legami = JSON.parse(cfg?.value || "{}") as Record<string, unknown>; } catch { legami = {}; }
    for (const [z, gruppi] of Object.entries(legami)) {
      if (!Array.isArray(gruppi)) continue;
      for (const g of gruppi) {
        if (!Array.isArray(g)) continue;
        const somma = (g as unknown[]).reduce((t: number, id) => t + (posti.get(String(id)) ?? 0), 0);
        m.set(z, Math.max(m.get(z) ?? 0, somma));
      }
    }
    return m;
  } catch {
    return null;
  }
}
