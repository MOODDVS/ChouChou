import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { SERVIZI_WIDGET, LINGUE_WIDGET } from "../../../lib/reservationI18n";
import { cacheDel } from "../../../lib/cache";
import { invalidaAppConfig } from "../../../lib/appConfigCache";
import { CACHE_ADMIN_BOOT } from "../../../lib/admin/adminBoot";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
// Multi-sede: `app_config` e' il livello del MARCHIO, `location_config` le
// eccezioni della sede. Queste due funzioni sono l'unico posto che lo sa.
import {
  ambitoDiRichiesta, leggiConfig, scriviConfig,
  leggiOrari, scriviOrari, assicuraOrariSede,
} from "../../../lib/admin/sede";

export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

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
/**
 * A CHE LIVELLO VIVE OGNI SCHEDA di Réglages (deciso 14/09/2026,
 * corretto il 16/09 — vedi la nota in fondo).
 *
 *   Général       SEDE    indirizzo, telefono, email, mittenti: sono di un
 *                         posto fisico. UNA eccezione dentro: `timezone`.
 *   Horaires      SEDE    gli orari sono di una porta che apre e chiude
 *   Réservations  SEDE    sezioni, servizi, capienza: sono di una sala
 *   Cuisine       SEDE    l'email della cucina e' di quella cucina
 *   Notifications SEDE    il recap arriva al responsabile di quel punto
 *   Liens         GRUPPO  un solo sito pubblico, quindi un solo Facebook
 *   Team          MISTA   il personale e' del punto, ma qualcuno gira: il
 *                         default e' «solo qui», con l'interruttore per dire
 *                         «in tutte le sedi»
 *   Documents     SEDE    tre societa', tre set di contratti. Si separano
 *                         per PERCORSO nel bucket, non per colonna
 *
 * La regola e' per SCHEDA, non per campo: si sa cosa contiene una scheda, e
 * non cambia da cliente a cliente. La strada del campo — condiviso per
 * difetto, con una catena cliccabile accanto a ogni etichetta — era stata
 * provata e non regge: un gruppo puo' avere tre nomi, tre loghi e tre
 * identita' diverse, quindi non esiste nessun elenco di «campi che valgono
 * di sicuro per tutti» che sia vero anche per il cliente dopo.
 *
 * ⚠️ NOTA DEL 16/09/2026. Questo commento diceva «Liens · Team · Documents →
 * del GRUPPO», e per Team e Documents era FALSO: `team` e' mista con default
 * sede (vedi `team.ts`), e i documenti si separano per sede da sempre (vedi
 * `radiceDocs`). Il codice era giusto, la mappa no — e una mappa sbagliata e'
 * peggio di nessuna mappa, perche' si legge invece di andare a guardare.
 * L'elenco qui sopra ora e' verificato da un test contro `CLASSIFICA`.
 */
// ⚠️ `google_review` NON sta piu' qui (17/09). I link sono del MARCHIO — un
// gruppo ha un sito, un Instagram, un Facebook — ma il link «lascia una
// recensione» e' di UNA SCHEDA GOOGLE, e tre societa' hanno tre schede. Con
// un link solo, il cliente che ha cenato a Schaerbeek lasciava la recensione
// a Stockel: la recensione arrivava davvero, solo al posto sbagliato, e
// nessuno se ne accorgeva guardando l'admin.
// Adesso e' un campo di Général, che si scrive sulla sede selezionata in alto.
// La chiave resta `link_google_review`: nessuna migrazione, e per un cliente
// a sede unica il valore di prima continua a valere (il livello marchio e' il
// ripiego quando la sede non ha il suo).
const CHIAVI_LINK = ["facebook", "instagram", "youtube", "tiktok", "linkedin", "x", "foursquare", "tripadvisor", "thefork", "yelp"];

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
  "newsletter_from_name",
  "newsletter_from_email",
  "email_from_name",
  "contact_from_name",
  "contact_from_email",
  "order_from_name",
  "order_from_email",
  "whatsapp_number",
  "timezone",                 // fuso orario del ristorante (IANA, es. Europe/Brussels)
  "brand_logo",               // URL loghi + favicon (bucket Storage "brand")
  "brand_logo_negative",
  "brand_logo_mono",
  "brand_favicon",
  "brand_app_icon",          // PNG 512 quadrato: icona dell'app installata (PWA)
];
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Impostazioni del tab "Réservations" (V1: capienza semplice, niente tavoli)
const CHIAVI_RESA = [
  "reservation_zones",        // sezioni della sala: JSON [{name, seats}]
  "reservation_min_notice_minutes", // minuti minimi di preavviso per prenotare (0 = nessuno)
  "reservation_zone_choice",  // "1" il cliente sceglie la sezione, "0" no
  "reservation_plan_mode",    // "1" i posti veri vengono dal plan de salle (tavoli disegnati)
  "reservation_auto_accept",  // "1" conferma subito (default) · "0" demandes PENDING, conferma il ristoratore
  "reservation_auto_tables",  // "1" tavoli assegnati dal motore (default) · "0" li attribuisce il ristoratore
  "reservation_max_people",   // massimo di persone accettato dal widget
  "reservation_services",     // fasce prenotabili: JSON [{key, from, to, hold, slot}] max 3
  "reservation_corner_style", // angoli del widget: "rounded" | "square"
  "reservation_languages",    // lingue attive sul widget: JSON ["fr","en",…]
  "reservation_options_enabled", // "1" mostra le opzioni nel widget, "0" le nasconde
  "reservation_options",      // opzioni attive: JSON ["high_chair","quiet",…]
  "reservation_from_name",    // nome mittente delle conferme al cliente
  "reservation_from_email",   // mittente delle conferme al cliente
  "reservation_notify_email", // dove arrivano le richieste
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function minOra(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

// Una fascia è valida se open/close sono orari "HH:mm" corretti e la durata è
// positiva. Se close ≤ open la fascia SCAVALCA LA MEZZANOTTE (es. 18:00 → 00:00
// oppure 18:00 → 01:00): la chiusura si intende il giorno dopo.
function fasciaValida(open: string | null, close: string | null): boolean {
  if (!open || !close || !RE_ORA.test(open) || !RE_ORA.test(close)) return false;
  const o = minOra(open);
  let c = minOra(close);
  if (c <= o) c += 1440; // chiusura il giorno seguente
  return c > o && c - o <= 1440;
}

// GET /api/admin/settings — orari dei 7 giorni + prep/slot + email cucina
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);
  let days;
  try {
    days = await leggiOrari(ambito);
  } catch {
    return json({ error: await msg("err.read") }, 500);
  }
  const { valori: cfg, marchio } = await leggiConfig(ambito, [
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
  // I link si leggono dal GRUPPO, non dallo strato della sede: e' il livello
  // in cui vivono. Cosi' un'eventuale riga di sede rimasta indietro non
  // copre il valore vero — verrebbe mostrata e non riscritta mai piu'.
  const links: Record<string, string> = {};
  for (const k of CHIAVI_LINK) links[k] = marchio.get("link_" + k) ?? "";
  const general: Record<string, string> = {};
  for (const k of CHIAVI_GENERAL) general[k] = cfg.get(k) ?? "";
  // Il fuso si legge dal livello installazione — vedi la nota nel PUT.
  general.timezone = marchio.get("timezone") ?? "";
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
    return json({ error: await msg("err.request") }, 400);
  }

  const vuoleChiusura = typeof body.orders_closed === "boolean";
  const vuolePrep = body.prep_time_minutes !== undefined;
  const vuoleBrief = typeof body.daily_brief_enabled === "boolean";
  const vuoleBriefOra = typeof body.daily_brief_hour === "string";
  const vuoleBriefEmail = typeof body.daily_brief_email === "string";
  if (!vuoleChiusura && !vuolePrep && !vuoleBrief && !vuoleBriefOra && !vuoleBriefEmail) {
    return json({ error: await msg("err.request") }, 400);
  }

  // Ora d'invio dell'email quotidienne (HH:MM, fuso del ristorante)
  const ambito = await ambitoDiRichiesta(request, staff);

  if (vuoleBriefOra) {
    const ora = String(body.daily_brief_hour).trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ora)) return json({ error: await msg("err.time") }, 400);
    const err = await scriviConfig(ambito, { daily_brief_hour: ora });
    if (err) return json({ error: await msg("err.save") }, 500);
  }

  // Destinatario dell'email quotidienne (vuoto = default réservations)
  if (vuoleBriefEmail) {
    const em = String(body.daily_brief_email).trim();
    if (em && !RE_EMAIL.test(em)) return json({ error: `Email invalide : ${em}` }, 400);
    const err = await scriviConfig(ambito, { daily_brief_email: em });
    if (err) return json({ error: await msg("err.save") }, 500);
  }

  // Toggle email "Votre journée" (récap quotidiano delle 9h00)
  if (vuoleBrief) {
    const err = await scriviConfig(ambito, { daily_brief_enabled: body.daily_brief_enabled ? "1" : "0" });
    if (err) return json({ error: await msg("err.save") }, 500);
  }

  // Toggle chiusura ordini online (app_config.orders_closed = "1"/"0").
  // Può arrivare assieme a prep_time_minutes: scegliere un tempo riapre.
  if (vuoleChiusura) {
    const err = await scriviConfig(ambito, { orders_closed: body.orders_closed ? "1" : "0" });
    if (err) return json({ error: await msg("err.save") }, 500);
  }

  if (vuolePrep) {
    const prep = Math.floor(Number(body.prep_time_minutes));
    if (!Number.isFinite(prep) || prep < 0 || prep > 240) {
      return json({ error: await msg("err.prep") }, 400);
    }

    // Con una sede selezionata i sette giorni devono esistere prima di
    // poterli aggiornare: vedi `assicuraOrariSede`.
    const manca = await assicuraOrariSede(ambito);
    if (manca) return json({ error: await msg("err.save") }, 500);

    const tabella = ambito.modo === "sede" ? "location_settings" : "settings";
    let q = supabaseAdmin.from(tabella).update({ prep_time_minutes: prep }).gte("day_of_week", 0);
    if (ambito.modo === "sede") q = q.eq("location_id", ambito.id);
    const { error } = await q;

    if (error) return json({ error: await msg("err.save") }, 500);
  }

  return json({ ok: true });
};

// PUT /api/admin/settings — salva orari (2 fasce) + prep/slot + email cucina
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambitoPut = await ambitoDiRichiesta(request, staff);

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
    return json({ error: await msg("err.request") }, 400);
  }

  // --- Validazione ---
  if (!Array.isArray(body.days) || body.days.length !== 7) {
    return json({ error: await msg("err.days7") }, 400);
  }
  const prep = Math.floor(Number(body.prep_time_minutes));
  const slot = Math.floor(Number(body.slot_duration_minutes));
  if (!Number.isFinite(prep) || prep < 0 || prep > 240) {
    return json({ error: await msg("err.prep") }, 400);
  }
  if (!Number.isFinite(slot) || slot < 5 || slot > 120) {
    return json({ error: await msg("err.slotLen") }, 400);
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
      if ((k === "newsletter_from_email" || k === "public_email" || k === "contact_from_email" || k === "order_from_email") && v && !RE_EMAIL.test(v)) {
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
          return json({ error: await msg("err.sections") }, 400);
        }
        if (!Array.isArray(zone) || zone.length > 20) {
          return json({ error: await msg("err.sections20") }, 400);
        }
        const pulite: { name: string; seats: number }[] = [];
        for (const z of zone) {
          const name = String(z.name ?? "").trim();
          const seats = Math.floor(Number(z.seats));
          if (!name) return json({ error: await msg("err.sectionName") }, 400);
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
          return json({ error: await msg("err.occupancy") }, 400);
        }
      }
      if (k === "reservation_slot_minutes" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 10 || n > 120) {
          return json({ error: await msg("err.resSlot") }, 400);
        }
      }
      if (k === "reservation_zone_choice" && v && v !== "0" && v !== "1") {
        return json({ error: await msg("err.valSection") }, 400);
      }
      if ((k === "reservation_auto_accept" || k === "reservation_auto_tables" || k === "reservation_options_enabled") && v && v !== "0" && v !== "1") {
        return json({ error: await msg("err.valSwitch") }, 400);
      }
      if (k === "reservation_corner_style" && v && v !== "rounded" && v !== "square") {
        return json({ error: await msg("err.valCorners") }, 400);
      }
      if (k === "reservation_languages" && v) {
        let lista: unknown;
        try {
          lista = JSON.parse(v);
        } catch {
          return json({ error: await msg("err.langs") }, 400);
        }
        if (!Array.isArray(lista)) return json({ error: await msg("err.langs") }, 400);
        const validi = new Set<string>(LINGUE_WIDGET.map((l) => l.code));
        const scelte = new Set<string>(lista.filter((c): c is string => typeof c === "string" && validi.has(c)));
        scelte.add("fr"); // il francese resta sempre attivo
        v = JSON.stringify(LINGUE_WIDGET.map((l) => l.code).filter((c) => scelte.has(c)));
      }
      if (k === "reservation_options" && v) {
        let lista: unknown;
        try {
          lista = JSON.parse(v);
        } catch {
          return json({ error: await msg("err.options") }, 400);
        }
        if (!Array.isArray(lista)) return json({ error: await msg("err.options") }, 400);
        const OPZIONI_VALIDE = ["high_chair", "quiet", "business", "birthday", "special_event"];
        const scelte = new Set<string>(lista.filter((c): c is string => typeof c === "string" && OPZIONI_VALIDE.includes(c)));
        v = JSON.stringify(OPZIONI_VALIDE.filter((c) => scelte.has(c)));
      }
      if (k === "reservation_min_notice_minutes" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 0 || n > 4320) {
          return json({ error: await msg("err.minDelay") }, 400);
        }
      }
      if (k === "reservation_max_people" && v) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          return json({ error: await msg("err.maxPeople") }, 400);
        }
      }
      if (k === "reservation_services" && v) {
        let lista: unknown;
        try {
          lista = JSON.parse(v);
        } catch {
          return json({ error: await msg("err.services") }, 400);
        }
        if (!Array.isArray(lista) || lista.length > 5) {
          return json({ error: await msg("err.services5") }, 400);
        }
        const RE_ORA = /^\d{2}:\d{2}$/;
        const puliti: { key: string; from: string; to: string; hold: number; slot: number; days: number[] }[] = [];
        for (const sv of lista) {
          const key = String((sv as { key?: unknown }).key ?? "").trim();
          if (!SERVIZI_WIDGET[key]) return json({ error: await msg("err.serviceUnknown") }, 400);
          const from = String((sv as { from?: unknown }).from ?? "");
          const to = String((sv as { to?: unknown }).to ?? "");
          if (!RE_ORA.test(from) || !RE_ORA.test(to) || from >= to) {
            return json({ error: `Horaires invalides pour « ${SERVIZI_WIDGET[key].fr} »` }, 400);
          }
          // Durée d'occupation e créneau propri di ogni service
          const hold = Math.floor(Number((sv as { hold?: unknown }).hold));
          if (!Number.isFinite(hold) || hold < 15 || hold > 360) {
            return json({ error: `${await msg("err.occupancyFor")} « ${SERVIZI_WIDGET[key].fr} »` }, 400);
          }
          const slot = Math.floor(Number((sv as { slot?: unknown }).slot));
          if (!Number.isFinite(slot) || slot < 10 || slot > 120) {
            return json({ error: `${await msg("err.slotFor")} « ${SERVIZI_WIDGET[key].fr} »` }, 400);
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
      if (k === "reservation_from_email" && v && !RE_EMAIL.test(v)) {
        return json({ error: `Email invalide : ${v}` }, 400);
      }
      if (k === "reservation_notify_email" && v) {
        for (const e of v.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!RE_EMAIL.test(e)) return json({ error: `Email invalide : ${e}` }, 400);
        }
      }
      resaPulito.push([k, v]);
    }
  }

  const NOMI = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const visti = new Set<number>();
  for (const g of body.days) {
    if (typeof g.day_of_week !== "number" || g.day_of_week < 0 || g.day_of_week > 6 || visti.has(g.day_of_week)) {
      return json({ error: await msg("err.dayDup") }, 400);
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

  // --- Salvataggio: i sette giorni, dove vanno per questo ambito ---
  const errOrari = await scriviOrari(
    ambitoPut,
    body.days.map((g) => ({
      day_of_week: g.day_of_week,
      lunch_active: g.lunch_active,
      lunch_open: g.lunch_active ? g.lunch_open : null,
      lunch_close: g.lunch_active ? g.lunch_close : null,
      dinner_active: g.dinner_active,
      dinner_open: g.dinner_active ? g.dinner_open : null,
      dinner_close: g.dinner_active ? g.dinner_close : null,
      prep_time_minutes: prep,
      slot_duration_minutes: slot,
    })),
  );
  if (errOrari) return json({ error: await msg("err.save") }, 500);

  // ⚠️ Una scrittura sola per gruppo, non una per chiave: con una sede
  // attiva ogni scrittura deve sapere il valore del marchio per decidere se
  // e' un'eccezione o un ritorno all'eredita', e chiederlo trenta volte
  // sarebbe trenta letture.
  if (email) {
    const err = await scriviConfig(ambitoPut, { kitchen_email: email });
    if (err) return json({ error: await msg("err.kitchenEmail") }, 500);
  }

  // Liens: del GRUPPO. Un solo sito pubblico per tutte le sedi, quindi un
  // solo Facebook, un solo TripAdvisor.
  if (linkPuliti.length > 0) {
    const err = await scriviConfig(ambitoPut, Object.fromEntries(linkPuliti), "gruppo");
    if (err) return json({ error: await msg("err.linksSave") }, 500);
  }

  if (generalPulito.length > 0) {
    // ⚠️ UNA eccezione dentro Général, e non e' «questo campo e' condiviso»
    // (il ragionamento che abbiamo scartato): e' che il CODICE ne supporta
    // uno solo. `TIMEZONE` in `slots.ts` e' una variabile di modulo mutabile,
    // letta da venti file, condivisa fra tutte le richieste del processo.
    // Salvare un fuso per sede darebbe un'impostazione che non fa niente —
    // peggio che non averla. Resta uno per installazione finche' quel
    // refactor non e' fatto (vedi il backlog).
    const fuso = generalPulito.filter(([k]) => k === "timezone");
    const resto = generalPulito.filter(([k]) => k !== "timezone");
    if (fuso.length > 0) {
      const err = await scriviConfig(ambitoPut, Object.fromEntries(fuso), "gruppo");
      if (err) return json({ error: await msg("err.generalSave") }, 500);
    }
    if (resto.length > 0) {
      const err = await scriviConfig(ambitoPut, Object.fromEntries(resto));
      if (err) return json({ error: await msg("err.generalSave") }, 500);
    }
  }
  // brand_favicon fa parte di "général" ed è letta in SSR da AdminHead/AdminHeader:
  // svuotare la cache di boot così il logo nuovo si vede al primo reload.
  if (generalPulito.length > 0) { cacheDel(CACHE_ADMIN_BOOT); cacheDel("public:favicon"); }

  if (resaPulito.length > 0) {
    const err = await scriviConfig(ambitoPut, Object.fromEntries(resaPulito));
    if (err) return json({ error: await msg("err.resSave") }, 500);
  }

  invalidaAppConfig(); // app_config cambiata: la cache (30s) va svuotata subito
  return json({ ok: true });
};
