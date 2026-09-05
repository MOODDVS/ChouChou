import { supabaseAdmin } from "./db";
import { appConfigIn, appConfigEq } from "./appConfigCache";

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
      appConfigEq("reservation_plan_links"),
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

// ------------------------------------------------------------------
// FASE 2 — Assegnazione automatica dei tavoli alla prenotazione
// ------------------------------------------------------------------

export type TavoliAssegnati = { ids: string[]; names: string[]; zone: string };

function minutiDi(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/**
 * Sceglie i tavoli per una prenotazione: la combinazione LIBERA piu' piccola
 * che basta (tavolo singolo, oppure finestra contigua di una catena di
 * liaison). Criterio: meno posti sprecati, poi meno tavoli.
 * `zonaPref` = section scelta (null/"" = indifferent -> tutte, meno le chiuse).
 * Ritorna null se nessuna combinazione libera basta (l'admin puo' bypassare:
 * in quel caso la prenotazione resta senza tavoli).
 */
function scegliCombinazione(
  tavoli: { id: string; zone: string; name: string; seats: number }[],
  legami: Record<string, unknown>,
  occupati: Set<string>,
  zonaPref: string | null,
  zoneChiuse: string[],
  people: number,
  priorita: string[]
): TavoliAssegnati | null {
  const perId = new Map(tavoli.map((t) => [t.id, t]));
  let zone = zonaPref
    ? [zonaPref]
    : [...new Set(tavoli.map((t) => t.zone))].filter((z) => !zoneChiuse.includes(z));
  // Priorità di riempimento (modale Sections): con "Indifférent" si prova
  // PRIMA la section in cima alla lista; senza priorità configurata vince la
  // combinazione globale con meno posti sprecati.
  const conPrio = !zonaPref && priorita.length > 0;
  if (conPrio) {
    const idx = (z: string) => { const i = priorita.indexOf(z); return i === -1 ? 999 : i; };
    zone = [...zone].sort((a, b) => idx(a) - idx(b));
  }

  let best: { ids: string[]; somma: number; zone: string } | null = null;
  const prova = (ids: string[], z: string) => {
    if (ids.some((id) => occupati.has(id) || !perId.has(id))) return;
    const somma = ids.reduce((t, id) => t + (perId.get(id)?.seats ?? 0), 0);
    if (somma < people) return;
    if (!best || somma < best.somma || (somma === best.somma && ids.length < best.ids.length)) {
      best = { ids, somma, zone: z };
    }
  };

  for (const z of zone) {
    for (const t of tavoli) if (t.zone === z) prova([t.id], z);
    const gruppi = Array.isArray(legami[z]) ? (legami[z] as unknown[]) : [];
    for (const g of gruppi) {
      if (!Array.isArray(g)) continue;
      const catena = (g as unknown[]).map(String);
      for (let da = 0; da < catena.length; da++) {
        for (let a = da + 2; a <= catena.length; a++) prova(catena.slice(da, a), z);
      }
    }
    // Con priorità: appena una section (in ordine) ha una combinazione, stop
    if (conPrio && best) break;
  }
  if (!best) return null;
  const b = best as { ids: string[]; somma: number; zone: string };
  return { ids: b.ids, names: b.ids.map((id) => perId.get(id)?.name ?? "?"), zone: b.zone };
}

/**
 * Assegna i tavoli a una (potenziale) prenotazione. Autonoma: legge da sola
 * plan mode, liaisons, services (hold) e l'occupazione del giorno.
 * Occupazione = stesse finestre orarie di verificaCreneau: una prenotazione
 * occupa [heure, heure + hold del suo service]. I tavoli gia' salvati contano
 * come occupati; le prenotazioni senza tavoli (create prima della #37 o con
 * plan spento) vengono "sistemate" virtualmente in ordine d'orario, cosi'
 * l'algoritmo non assegna due volte lo stesso tavolo.
 * Ritorna null se plan mode spento, migrazione mancante o nessuna combinazione.
 */
export async function assegnaTavoli(p: {
  date: string;
  heure: string;
  service_key: string | null;
  zone: string | null;
  people: number;
  excludeId?: string;
}): Promise<TavoliAssegnati | null> {
  try {
    const slotMin = minutiDi(p.heure);
    if (slotMin < 0 || !Number.isFinite(p.people) || p.people < 1) return null;

    const { data: cfgRows } = await appConfigIn(["reservation_plan_mode", "reservation_plan_links", "reservation_services", "reservation_hold_minutes", "reservation_zone_priority", "reservation_zones", "zone_closures_permanent"]);
    const cfg = new Map((cfgRows ?? []).map((r) => [r.key, String(r.value ?? "")]));
    if (cfg.get("reservation_plan_mode") !== "1") return null;

    const holdLeg = (() => {
      const n = Math.floor(Number(cfg.get("reservation_hold_minutes")));
      return Number.isFinite(n) ? Math.min(360, Math.max(15, n)) : 90;
    })();
    const holdByKey = new Map<string, number>();
    try {
      const arr = JSON.parse(cfg.get("reservation_services") || "[]");
      if (Array.isArray(arr)) {
        for (const sv of arr) {
          const k = String(sv?.key ?? "").trim();
          const h = Math.floor(Number(sv?.hold));
          if (k) holdByKey.set(k, Number.isFinite(h) ? Math.min(360, Math.max(15, h)) : holdLeg);
        }
      }
    } catch { /* services non configurati */ }
    const holdNuovo = (p.service_key ? holdByKey.get(p.service_key) : undefined) ?? holdLeg;

    let legami: Record<string, unknown> = {};
    try { legami = JSON.parse(cfg.get("reservation_plan_links") || "{}") as Record<string, unknown>; } catch { legami = {}; }
    let priorita: string[] = [];
    try {
      const pr = JSON.parse(cfg.get("reservation_zone_priority") || "[]");
      if (Array.isArray(pr)) priorita = pr.map(String).filter(Boolean);
    } catch { /* nessuna priorità */ }
    // Nessuna priorità salvata (mai trascinato nel modale Sections): vale
    // l'ordine delle sections dei Réglages — è quello che il modale NUMERA,
    // quindi deve essere sempre vero. La 1ª si riempie prima.
    if (!priorita.length) {
      try {
        const zs = JSON.parse(cfg.get("reservation_zones") || "[]");
        if (Array.isArray(zs)) {
          priorita = (zs as { name?: unknown }[]).map((z) => String(z?.name ?? "").trim()).filter(Boolean);
        }
      } catch { /* niente zones configurate */ }
    }
    // Sezioni ATTUALMENTE configurate: i tavoli agganciati a sezioni non piu
    // esistenti (rinominate) vanno IGNORATI, altrimenti si assegnano a zone
    // fantasma con posti sbagliati.
    let sezioniValide = new Set<string>();
    try {
      const zsv = JSON.parse(cfg.get("reservation_zones") || "[]");
      if (Array.isArray(zsv)) sezioniValide = new Set((zsv as { name?: unknown }[]).map((z) => String(z?.name ?? "").trim()).filter(Boolean));
    } catch { /* niente zones */ }

    const [tavQ, chzQ] = await Promise.all([
      supabaseAdmin.from("restaurant_tables").select("id, zone, name, seats"),
      supabaseAdmin.from("zone_closures").select("zone").eq("date", p.date),
    ]);
    if (tavQ.error || !tavQ.data || tavQ.data.length === 0) return null;
    const tavoli = (tavQ.data as { id: string; zone: string; name: string; seats: number }[])
      .map((t) => ({ id: String(t.id), zone: String(t.zone ?? "").trim(), name: String(t.name ?? ""), seats: Math.floor(Number(t.seats)) || 0 }))
      .filter((t) => t.zone && t.seats > 0 && (sezioniValide.size === 0 || sezioniValide.has(t.zone)));
    let zoneChiuse = (chzQ.data ?? []).map((r) => String(r.zone));
    // Sections chiuse «jusqu'à réouverture»: mai tavoli assegnati lì
    try {
      const permZ = JSON.parse(cfg.get("zone_closures_permanent") || "[]");
      if (Array.isArray(permZ)) zoneChiuse = [...new Set([...zoneChiuse, ...permZ.map((z) => String(z).trim()).filter(Boolean)])];
    } catch { /* niente */ }

    // Prenotazioni del giorno (confirmed/seated). Se la colonna `tables`
    // manca (#37 non lanciata) si riprova senza: tutte "virtuali".
    let dayQ = supabaseAdmin
      .from("reservations")
      .select("id, heure, people, zone, service_key, tables, created_at, extra_minutes")
      .eq("date", p.date)
      .in("status", ["confirmed", "seated"]);
    if (p.excludeId) dayQ = dayQ.neq("id", p.excludeId);
    let day = await dayQ;
    if (day.error && String(day.error.message ?? "").includes("tables")) {
      let q2 = supabaseAdmin
        .from("reservations")
        .select("id, heure, people, zone, service_key, created_at, extra_minutes")
        .eq("date", p.date)
        .in("status", ["confirmed", "seated"]);
      if (p.excludeId) q2 = q2.neq("id", p.excludeId);
      day = (await q2) as typeof day;
    }
    if (day.error) return null;

    type Riga = { id: string; heure: string; people: number; zone: string | null; service_key: string | null; tables?: unknown; created_at?: string; extra_minutes?: number };
    const sovrapposte = ((day.data ?? []) as Riga[]).filter((rr) => {
      const rMin = minutiDi(String(rr.heure).slice(0, 5));
      if (rMin < 0) return false;
      const rHold = (holdByKey.get(rr.service_key ?? "") ?? holdNuovo) + (Number(rr.extra_minutes) || 0);
      return rMin < slotMin + holdNuovo && rMin + rHold > slotMin;
    });

    const occupati = new Set<string>();
    const senzaTavoli: Riga[] = [];
    for (const rr of sovrapposte) {
      const ids = Array.isArray(rr.tables) ? (rr.tables as unknown[]).map(String) : [];
      if (ids.length) ids.forEach((id) => occupati.add(id));
      else senzaTavoli.push(rr);
    }
    // Assegnazione virtuale delle prenotazioni senza tavoli (ordine d'orario)
    senzaTavoli.sort((a, b) =>
      a.heure === b.heure ? String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) : a.heure < b.heure ? -1 : 1
    );
    for (const rr of senzaTavoli) {
      const scelta = scegliCombinazione(tavoli, legami, occupati, String(rr.zone ?? "").trim() || null, zoneChiuse, Math.max(1, Math.floor(Number(rr.people)) || 1), priorita);
      if (scelta) scelta.ids.forEach((id) => occupati.add(id));
    }

    return scegliCombinazione(tavoli, legami, occupati, String(p.zone ?? "").trim() || null, zoneChiuse, p.people, priorita);
  } catch {
    return null;
  }
}

/**
 * Calcola e SALVA i tavoli sulla prenotazione (best-effort: se la migrazione
 * #37 manca o qualcosa va storto, la prenotazione resta semplicemente senza
 * tavoli — mai bloccante). `null` esplicito quando non c'e' combinazione.
 */
export async function assegnaESalva(
  id: string,
  p: { date: string; heure: string; service_key: string | null; zone: string | null; people: number }
): Promise<void> {
  try {
    // Attribuzione manuale (reservation_auto_tables = "0"): il motore non
    // tocca MAI i tavoli — li mette/toglie il ristoratore dal modale.
    const { data: at } = await appConfigEq("reservation_auto_tables");
    if (String(at?.value ?? "1") === "0") return;
    const scelta = await assegnaTavoli({ ...p, excludeId: id });
    await supabaseAdmin.from("reservations").update({ tables: scelta ? scelta.ids : null }).eq("id", id);
  } catch { /* mai bloccante */ }
}

