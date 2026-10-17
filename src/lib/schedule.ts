import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { cacheOr, cacheDelPrefisso } from "./cache";
import { type ConfigGiorno } from "./slots";
import { fusoDi } from "./fuso";
import { leggiOrari, applicaFiltro, leggi, leggiConfig, type Ambito } from "./admin/sede";
import { fonteOrari, serviziDaConfig, finestreDaServizi, type ServizioOrari } from "./ordiniGiorniRegole";

/**
 * Config oraria EFFETTIVA del giorno di `ora`:
 * 1. parte dagli orari settimanali (tabella settings);
 * 2. se la data cade in un giorno speciale (tabella special_days),
 *    l'eccezione vince: 'closed' chiude tutto, 'open' apre con i
 *    suoi orari anche un giorno normalmente chiuso.
 * A parità di data, 'closed' ha priorità su 'open'.
 * Usata sia da /api/slots sia dal checkout: DEVONO essere d'accordo.
 *
 * PERFORMANCE: le due tabelle vengono lette UNA volta e tenute in una
 * cache da 60s. Chiamare questa funzione più volte nella stessa pagina
 * (es. il calcolo della prossima riapertura) non costa query extra.
 *
 * ⚠️ MULTI-SEDE: l'ambito NON ha un valore di default, di proposito. Queste
 * due letture decidono a che ora si può ordinare e prenotare; un ambito
 * dimenticato darebbe gli orari di un altro punto senza dare errore. Chi
 * chiama deve dire dove si trova — `SEDE_UNICA` compreso, che è una risposta
 * legittima e si vede nel codice.
 *
 * ⚠️ E la CHIAVE DI CACHE porta la sede dentro. Senza, la prima richiesta che
 * arriva riempie la cache e per 60 secondi tutti gli altri punti si vedono
 * serviti i suoi orari.
 */

interface RigaSettings {
  day_of_week: number;
  lunch_active: boolean;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_active: boolean;
  dinner_open: string | null;
  dinner_close: string | null;
  prep_time_minutes: number;
  slot_duration_minutes: number;
  exceptional_closures: unknown;
}

interface RigaSpeciale {
  date_from: string;
  date_to: string;
  type: string;
  /** #33 — i service aperti quel giorno (`null` = tutti). Assente sui
   *  database dove la migrazione non e' stata lanciata. */
  services?: unknown;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_open: string | null;
  dinner_close: string | null;
}

/** Suffisso della chiave di cache: la sede fa parte dell'identità del dato. */
const perAmbito = (a: Ambito) => (a.modo === "sede" ? a.id : a.modo);

/** I 7 giorni che valgono in questo ambito (cache 60s). */
async function tutteLeSettings(ambito: Ambito): Promise<RigaSettings[]> {
  return cacheOr(`sched:settings:${perAmbito(ambito)}`, async () => {
    return (await leggiOrari(ambito)) as unknown as RigaSettings[];
  });
}

/** Giorni speciali di questo ambito (cache 60s).
 *  `special_days` è «mista»: il filtro rende le chiusure della sede E quelle
 *  che valgono per tutte — Natale chiude tutti, i lavori chiudono uno. */
async function giorniSpeciali(ambito: Ambito): Promise<RigaSpeciale[]> {
  return cacheOr(`sched:special:${perAmbito(ambito)}`, async () => {
    const leggiSpeciali = async (campi: string) => {
      const q = applicaFiltro(
        supabaseAdmin
          .from("special_days")
          .select(campi)
          .order("type", { ascending: true }) as never, // 'closed' prima di 'open'
        "special_days",
        ambito,
      );
      return (await (q as unknown as PromiseLike<{ data: RigaSpeciale[] | null; error: unknown }>));
    };
    /* ⚠️ `services` (#33) serve solo agli orari di ritiro dai service: su un
       database che non ce l'ha, una `select` con quella colonna FALLISCE —
       e qui un errore chiude gli ordini di tutti. Si riprova senza. */
    const BASE = "date_from, date_to, type, lunch_open, lunch_close, dinner_open, dinner_close";
    let r = await leggiSpeciali(`${BASE}, services`);
    if (r.error || !r.data) r = await leggiSpeciali(BASE);
    if (r.error || !r.data) throw new Error("special_days illeggibili");
    return r.data as RigaSpeciale[];
  });
}

export async function configGiornoEffettiva(
  ora: DateTime,
  ambito: Ambito,
): Promise<ConfigGiorno | null> {
  const oggi = ora.setZone(await fusoDi(ambito));
  const dayOfWeek = oggi.weekday === 7 ? 0 : oggi.weekday;
  const iso = oggi.toFormat("yyyy-MM-dd");

  let settings: RigaSettings | undefined;
  let sp: RigaSpeciale | undefined;
  try {
    const [tutte, speciali] = await Promise.all([tutteLeSettings(ambito), giorniSpeciali(ambito)]);
    settings = tutte.find((r) => r.day_of_week === dayOfWeek);
    sp = speciali.find((s) => s.date_from <= iso && s.date_to >= iso);
  } catch {
    return null;
  }
  if (!settings) return null;

  const base: ConfigGiorno = {
    lunch_active: settings.lunch_active,
    lunch_open: settings.lunch_open,
    lunch_close: settings.lunch_close,
    dinner_active: settings.dinner_active,
    dinner_open: settings.dinner_open,
    dinner_close: settings.dinner_close,
    prep_time_minutes: settings.prep_time_minutes,
    slot_duration_minutes: settings.slot_duration_minutes,
    exceptional_closures: Array.isArray(settings.exceptional_closures)
      ? settings.exceptional_closures
      : [],
  };

  if (!sp) return base;

  if (sp.type === "closed") {
    return { ...base, lunch_active: false, dinner_active: false };
  }

  // Apertura eccezionale: usa gli orari dell'eccezione e ignora
  // le chiusure legacy (l'apertura è esplicita).
  return {
    ...base,
    lunch_active: !!(sp.lunch_open && sp.lunch_close),
    lunch_open: sp.lunch_open,
    lunch_close: sp.lunch_close,
    dinner_active: !!(sp.dinner_open && sp.dinner_close),
    dinner_open: sp.dinner_open,
    dinner_close: sp.dinner_close,
    exceptional_closures: [],
  };
}

/* ───────── Gli orari di RITIRO ─────────
 *
 * ⚠️ UNA FUNZIONE A PARTE, non un ramo dentro `configGiornoEffettiva`. Quella
 * dice gli ORARI D'APERTURA, e la usano anche la sala (si ordina dal tavolo
 * finche' la cucina e' aperta), la home dell'admin e la pagina pubblica degli
 * orari. Se seguisse i service delle prenotazioni, un «Soir» chiuso perche'
 * COMPLET fermerebbe gli ordini di chi e' gia' seduto al tavolo. I service
 * valgono solo per l'ASPORTO — sito, checkout e ordine a mano dell'admin.
 */

interface DatiServizi {
  fonte: "hours" | "services";
  servizi: ServizioOrari[];
  /** Service chiusi per data (`service_closures`), da oggi in poi. */
  chiusePerData: Map<string, Set<string>>;
  /** Service chiusi «fino a riapertura». */
  permanenti: string[];
}

async function datiServizi(ambito: Ambito, oggiIso: string): Promise<DatiServizi> {
  return cacheOr(`sched:ritiro:${perAmbito(ambito)}:${oggiIso}`, async () => {
    const { valori } = await leggiConfig(ambito, ["orders_slot_source", "reservation_services", "service_closures_permanent"]);
    const fonte = fonteOrari(valori.get("orders_slot_source"));
    if (fonte === "hours") return { fonte, servizi: [], chiusePerData: new Map(), permanenti: [] };
    let permanenti: string[] = [];
    try {
      const arr = JSON.parse(valori.get("service_closures_permanent") || "[]");
      if (Array.isArray(arr)) permanenti = arr.map((x) => String(x).trim()).filter(Boolean);
    } catch { /* nessuna */ }
    const chiusePerData = new Map<string, Set<string>>();
    const { data } = await leggi("service_closures", ambito, "date, service_key").gte("date", oggiIso);
    for (const c of (data ?? []) as { date: string; service_key: string }[]) {
      const d = String(c.date);
      if (!chiusePerData.has(d)) chiusePerData.set(d, new Set());
      chiusePerData.get(d)!.add(String(c.service_key));
    }
    return { fonte, servizi: serviziDaConfig(valori.get("reservation_services")), chiusePerData, permanenti };
  });
}

/** Da chiamare quando cambia qualcosa che decide gli orari di ritiro (la
 *  fonte, i service, una chiusura): altrimenti per un minuto il sito propone
 *  uno slot che il ristoratore ha appena chiuso. */
export function scadeOrariRitiro(): void {
  cacheDelPrefisso("sched:ritiro");
}

/**
 * La config del giorno per il RITIRO: gli orari d'apertura, oppure — se il
 * ristoratore l'ha scelto (`orders_slot_source = services`) — i service delle
 * prenotazioni di quel giorno, senza quelli chiusi. Stessa forma di
 * `configGiornoEffettiva`, quindi `calcolaSlotGiorno` non cambia.
 *
 * ⚠️ La usano TUTTI quelli che propongono o controllano un orario di ritiro:
 * `/api/slots`, il checkout, l'ordine a mano dell'admin. Devono essere
 * d'accordo, o il cliente sceglie uno slot che il checkout rifiuta.
 */
export async function configRitiro(ora: DateTime, ambito: Ambito): Promise<ConfigGiorno | null> {
  const base = await configGiornoEffettiva(ora, ambito);
  if (!base) return null;
  const fuso = await fusoDi(ambito);
  const giorno = ora.setZone(fuso);
  const iso = giorno.toFormat("yyyy-MM-dd");
  let dati: DatiServizi;
  try {
    // Le chiusure si leggono da OGGI in poi: un giorno nel futuro (ordini
    // per i prossimi giorni) le trova nella stessa lettura.
    dati = await datiServizi(ambito, DateTime.now().setZone(fuso).toFormat("yyyy-MM-dd"));
  } catch {
    // Config dei service illeggibile: gli orari d'apertura, come prima.
    return base;
  }
  if (dati.fonte === "hours") return base;

  // Il giorno speciale vale anche qui: «fermé» chiude, «ouvert» sceglie i service.
  let sp: RigaSpeciale | undefined;
  try {
    sp = (await giorniSpeciali(ambito)).find((s) => s.date_from <= iso && s.date_to >= iso);
  } catch { /* nessuno */ }
  if (sp?.type === "closed") return { ...base, lunch_active: false, dinner_active: false };
  const speciale = sp?.type === "open"
    ? { services: Array.isArray(sp.services) ? (sp.services as unknown[]).map((x) => String(x)) : null }
    : undefined;

  const dow = giorno.weekday === 7 ? 0 : giorno.weekday;
  const chiusi = new Set([...(dati.chiusePerData.get(iso) ?? []), ...dati.permanenti]);
  const f = finestreDaServizi(dati.servizi, dow, speciale, chiusi);
  return {
    ...base,
    lunch_active: !!f.lunch,
    lunch_open: f.lunch?.[0] ?? null,
    lunch_close: f.lunch?.[1] ?? null,
    dinner_active: !!f.dinner,
    dinner_open: f.dinner?.[0] ?? null,
    dinner_close: f.dinner?.[1] ?? null,
  };
}

