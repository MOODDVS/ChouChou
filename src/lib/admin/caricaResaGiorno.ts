import { leggi, aggiorna, type Ambito } from "./sede";
import { copertiDelGiorno } from "./resaConti";
import { appConfigIn } from "../appConfigCache";
import { postiDalPlan } from "../planSalle";
import { capienzaDelleZone, zoneDaConfig } from "../salaRegole";

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
  /** Nome dei tavoli per id — `reservations.tables` porta gli id, e un id non
   *  dice niente a chi legge: in sala il tavolo si chiama «3» o «Terrasse 2».
   *  Vuoto se il piano sala non c'e' (migrazione non lanciata, o cliente senza
   *  tavoli disegnati): chi lo usa mostra quello che puo'. */
  tables_map?: Record<string, string>;
  config?: ResaGiornoConfig;
  missing?: boolean;
}

export async function caricaResaGiorno(date: string, ambito: Ambito): Promise<ResaGiorno> {
  const [reseQ, cfgQ, tavQ, chQ, zchQ, spQ] = await Promise.all([
    leggi("reservations", ambito, "*")
      .eq("date", date)
      .order("heure", { ascending: true })
      .order("created_at", { ascending: true }),
    appConfigIn([
        "reservation_hold_minutes",
        "reservation_slot_minutes",
        "reservation_services",
        "reservation_zones",
        "reservation_plan_mode",
        "timezone",
        "service_closures_permanent",
        "zone_closures_permanent",
      ], ambito),
    // ⚠️ Una lettura a se', col suo ripiego: su un cliente senza piano sala la
    // tabella non c'e', e un errore qui non deve portarsi via le prenotazioni.
    leggi("restaurant_tables", ambito, "id, name").then((r) => r, () => ({ data: null, error: true })),
    leggi("service_closures", ambito, "service_key, reason").eq("date", date),
    leggi("zone_closures", ambito, "zone, reason").eq("date", date),
    leggi("special_days", ambito, "type, services")
      .lte("date_from", date)
      .gte("date_to", date)
      .then(async (r) => {
        // Migrazione #33 non ancora lanciata: senza la colonna (= tutti)
        if (r.error && String(r.error.message ?? "").includes("services")) {
          return leggi("special_days", ambito, "type").lte("date_from", date).gte("date_to", date);
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
    const planPosti = await postiDalPlan(m.get("reservation_plan_mode"), ambito);
    // ⚠️ La regola sta in `salaRegole.ts`, una volta sola: qui e nel widget
    // pubblico era scritta due volte, e le due copie divergevano gia'.
    const conf = zoneDaConfig(m.get("reservation_zones"));
    zones = (Array.isArray(conf) ? conf : [])
      .map((z: { name?: unknown }) => String(z?.name ?? "").trim())
      .filter(Boolean);
    const cap = capienzaDelleZone(conf, planPosti);
    for (const z of cap.zones) zoneSeats[z.name] = z.seats;
    capacity = cap.capienza;
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
      // ⚠️ La stessa chiave puo' avere PIU' righe: «soir» feriale e «soir» del
      // weekend, con durate diverse. Un `find` secco prende la prima, e il
      // sabato si chiudevano i tavoli mezz'ora prima del dovuto. Si cerca la
      // riga attiva in QUESTO giorno, e solo se non c'e' si ripiega sulla prima.
      const dowGiorno = new Date(date + "T12:00:00").getDay();
      const holdDiKey = (key: string | null): number => {
        const righe = (services as { key?: string; hold?: unknown; days?: unknown }[])
          .filter((x) => x.key === key);
        const attiva = righe.find((x) => {
          const d = Array.isArray(x.days) ? (x.days as unknown[]).map((v) => Math.floor(Number(v))) : [];
          return d.length === 0 || d.includes(dowGiorno);
        });
        const n = Math.floor(Number((attiva ?? righe[0])?.hold));
        return Number.isFinite(n) && n >= 15 && n <= 360 ? n : hold;
      };
      const daChiudere = (data ?? []).filter((r) => {
        if (r.status !== "confirmed" && r.status !== "seated") return false;
        if (date < oggiTz) return true; // giorni passati: si chiudono comunque
        const inizio = minutiHH(String(r.heure ?? ""));
        if (inizio < 0) return false;
        return adesso >= inizio + holdDiKey(r.service_key ?? null) + (Number((r as { extra_minutes?: number }).extra_minutes) || 0) + 20;
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
            // Auto-Fini (nessuno ha chiuso): registra il tempo NOMINALE del tavolo
            // (durée configurata in admin), non il tempo reale.
            void offMin;
            const durata = holdDiKey(r.service_key ?? null) + (Number((r as { extra_minutes?: number }).extra_minutes) || 0);
            r.table_minutes = durata;
            return aggiorna("reservations", ambito, { status: "done", table_minutes: durata }).eq("id", r.id);
          })
        );
        // Migrazione #27 non ancora lanciata: si chiude senza durata
        if (esiti.some((e) => e.error && String(e.error.message ?? "").includes("table_minutes"))) {
          await aggiorna("reservations", ambito, { status: "done" })
            .in("id", daChiudere.map((r) => r.id));
        }
        for (const r of daChiudere) r.status = "done"; // riflesso subito nella risposta
      }
    }
  } catch { /* mai bloccante */ }

  // ⚠️ `copertiDelGiorno`, non «confirmed + seated» scritto qui: l'auto-Fini
  // qui sopra ha appena girato a `done` i tavoli della sera, e quel conto
  // CALAVA mentre la serata andava avanti — zero a mezzanotte per un servizio
  // pieno, e zero per sempre su un giorno passato. Il numero sullo schermo che
  // resta aperto tutta la sera e' questo.
  const couverts = copertiDelGiorno(data ?? []);

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

  const tablesMap: Record<string, string> = {};
  for (const t of ((tavQ as { data?: unknown[] | null })?.data ?? []) as { id?: unknown; name?: unknown }[]) {
    const id = String(t.id ?? "");
    const nome = String(t.name ?? "").trim();
    if (id && nome) tablesMap[id] = nome;
  }

  return {
    reservations: data ?? [],
    couverts,
    tables_map: tablesMap,
    closures,
    zone_closures: zoneClosures,
    special_open: specialOpen,
    special_services: specialOpen ? specialServices : null,
    hold_minutes: hold,
    config: { slot_minutes: slot, services, zones, capacity, zone_seats: zoneSeats, timezone: tz },
  };
}
