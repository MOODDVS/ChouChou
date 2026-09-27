import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sedeDaAttribuire, campoSede, schedaValida, classificaErroreToken, type StatoGoogle } from "./googleRegole";
export { schedaValida };
import { supabaseAdmin } from "./db";
import { adminLang } from "./admin/adminLang";
import { adminT } from "../i18n/admin";
import { inviaPushRecensione } from "./push";
import { multiSedeAttivo, ambitoDiRiga, leggiConfig, scriviConfig, elencoSedi, leggi, type Ambito } from "./admin/sede";

/**
 * Google Business Profile — collegamento OAuth per-cliente (livello 2).
 *
 * MODELLO: credenziali dell'app UNICHE di MOODD (env GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET); ogni ristoratore autorizza la SUA scheda e il
 * refresh token finisce in `app_config` del SUO Supabase. Nessun dato di
 * un cliente è raggiungibile da un altro.
 *
 * Lazy come Stripe: senza credenziali il motore parte lo stesso, il
 * pulsante « Connecter » resta spento.
 */

const CLIENT_ID = import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = import.meta.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";
const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");
// Segreto per firmare lo `state` anti-CSRF: riusa la service key (mai esposta)
const FIRMA = import.meta.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "moodd";

export const SCOPE = "https://www.googleapis.com/auth/business.manage";
export const REDIRECT_URI = `${SITE_URL}/api/google/callback`;
const K_REFRESH = "google_oauth_refresh";

export function googleConfigurato(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ============================================================
// state firmato (anti-CSRF): payload.firma, valido 10 minuti
// ============================================================

function firma(payload: string): string {
  return createHmac("sha256", FIRMA).update(payload).digest("base64url");
}

export function creaState(): string {
  const payload = Buffer.from(
    JSON.stringify({ n: randomBytes(9).toString("base64url"), exp: Date.now() + 10 * 60_000 })
  ).toString("base64url");
  return `${payload}.${firma(payload)}`;
}

export function verificaState(state: string): boolean {
  const [payload, mac] = String(state ?? "").split(".");
  if (!payload || !mac) return false;
  const atteso = firma(payload);
  if (mac.length !== atteso.length) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(atteso))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

// ============================================================
// Flusso OAuth
// ============================================================

/** URL della schermata di consenso Google (accesso offline = refresh token). */
export function urlConsenso(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // forza il rilascio del refresh token anche al 2° collegamento
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Scambia il `code` del callback con i token; salva il refresh token. */
export async function salvaTokenDaCode(code: string): Promise<{ ok: boolean; errore?: string }> {
  if (!googleConfigurato()) return { ok: false, errore: "Google non configuré" };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const j = (await res.json()) as { refresh_token?: string; error_description?: string; error?: string };
    if (!res.ok) return { ok: false, errore: j.error_description ?? j.error ?? "échange impossible" };
    if (!j.refresh_token) {
      return { ok: false, errore: "Google n'a pas renvoyé de refresh token (déconnecte l'app dans ton compte Google et réessaie)." };
    }
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert([{ key: K_REFRESH, value: j.refresh_token }], { onConflict: "key" });
    if (error) return { ok: false, errore: "Enregistrement impossible" };
    return { ok: true };
  } catch {
    return { ok: false, errore: "Connexion à Google impossible" };
  }
}

/**
 * Access token fresco, E il motivo quando non si puo' avere.
 *
 * ⚠️ «Non ho un token» non e' una cosa sola. Puo' voler dire che la funzione
 * e' spenta, che nessuno si e' mai collegato, che Google ha revocato il
 * permesso, o che in questo momento non si riesce a chiedere. Prima erano
 * tutte `null`, e l'admin diceva sempre «Google non collegato»: il ristoratore
 * che si era collegato una settimana prima pensava di non aver mai cliccato il
 * pulsante, e nessuno andava a cercare la causa vera.
 */
export async function tokenGoogle(): Promise<{ token: string | null; stato: StatoGoogle }> {
  if (!googleConfigurato()) return { token: null, stato: "spento" };
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", K_REFRESH)
    .maybeSingle();
  const refresh = String(data?.value ?? "").trim();
  if (!refresh) return { token: null, stato: "mai" };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refresh,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      // Il corpo dice se e' una revoca o un guaio passeggero: vedi
      // classificaErroreToken in googleRegole.ts.
      const corpo = await res.text().catch(() => "");
      return { token: null, stato: classificaErroreToken(res.status, corpo) };
    }
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ? { token: j.access_token, stato: "ok" } : { token: null, stato: "incerto" };
  } catch {
    // Rete caduta: NON e' «scaduto». Dirlo manderebbe a ricollegare per niente.
    return { token: null, stato: "incerto" };
  }
}

/** Access token fresco (null se non si puo' avere). Chi ha bisogno di sapere
 *  PERCHE' usa `tokenGoogle()`. */
export async function accessToken(): Promise<string | null> {
  return (await tokenGoogle()).token;
}

/**
 * Il messaggio da rendere quando non c'e' un token, nella lingua dell'admin.
 * Quattro stati, quattro frasi: «ricollega» e «non ti sei mai collegato» sono
 * due azioni diverse, e «Google non risponde» non e' colpa di nessuno.
 */
export async function erroreGoogle(stato: StatoGoogle): Promise<string> {
  const chiave =
    stato === "scaduto" ? "gg.err.scaduto" :
    stato === "spento" ? "gg.err.spento" :
    stato === "incerto" ? "gg.err.incerto" : "gg.err.mai";
  return adminT(await adminLang())(chiave);
}

/** Lo stato del collegamento, per l'admin. */
export async function statoGoogle(): Promise<StatoGoogle> {
  return (await tokenGoogle()).stato;
}

/** Scollega: cancella il refresh token salvato. */
export async function scollega(): Promise<void> {
  try {
    await supabaseAdmin.from("app_config").upsert([{ key: K_REFRESH, value: "" }], { onConflict: "key" });
  } catch {
    /* best-effort */
  }
}

// ============================================================
// RECENSIONI — Google Business Profile (livello 2)
// Reviews via API v4 (mybusiness.googleapis.com), scoperta account/location
// via Account Management + Business Information v1. Richiede l'allowlisting
// dell'app Google per l'accesso alle recensioni.
// ============================================================

const K_LOCATION = "google_location"; // "accounts/{id}/locations/{id}" (percorso v4)
const K_LOCATION_TITLE = "google_location_title";

export type GReview = {
  reviewId: string;
  name: string; // resource name completo v4
  author: string;
  photo: string;
  rating: number; // 1..5
  comment: string;
  createTime: string;
  updateTime: string;
  replyComment: string | null;
  replyTime: string | null;
};

const STELLE: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** GET autenticato verso le API Google; ritorna il JSON (o null su errore). */
/** GET autenticata che cattura status ed errore, per diagnosticare liste vuote / 403 (allowlist Google). */
async function gGetErr<T>(token: string, url: string): Promise<{ data: T | null; status: number; error: string }> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const txt = await r.text();
    let data: T | null = null;
    try { data = txt ? (JSON.parse(txt) as T) : null; } catch { data = null; }
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { data: null, status: r.status, error: msg || `HTTP ${r.status}` };
    }
    return { data, status: r.status, error: "" };
  } catch {
    return { data: null, status: 0, error: "Connexion à Google impossible" };
  }
}

export type GSede = { path: string; title: string; address: string };

/** Tutte le schede (account × location) accessibili col token — per il selettore. */
export async function listaSedi(token: string): Promise<{ sedi: GSede[]; error: string }> {
  const sedi: GSede[] = [];
  const accounts: string[] = [];
  let accTok = "";
  for (let i = 0; i < 10; i++) {
    const u =
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20" +
      (accTok ? `&pageToken=${accTok}` : "");
    const { data, error } = await gGetErr<{ accounts?: { name?: string }[]; nextPageToken?: string }>(token, u);
    if (error) return { sedi, error };
    for (const a of data?.accounts ?? []) if (a.name) accounts.push(a.name);
    accTok = String(data?.nextPageToken ?? "");
    if (!accTok) break;
  }
  if (!accounts.length) return { sedi, error: "" };

  for (const account of accounts) {
    let locTok = "";
    for (let i = 0; i < 20; i++) {
      const u =
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations` +
        "?readMask=name,title,storefrontAddress&pageSize=100" +
        (locTok ? `&pageToken=${locTok}` : "");
      const { data, error } = await gGetErr<{
        locations?: {
          name?: string;
          title?: string;
          storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string };
        }[];
        nextPageToken?: string;
      }>(token, u);
      if (error) return { sedi, error };
      for (const l of data?.locations ?? []) {
        if (!l.name) continue;
        const a = l.storefrontAddress;
        const address = [(a?.addressLines ?? []).join(" "), a?.postalCode, a?.locality]
          .filter(Boolean)
          .join(", ");
        sedi.push({ path: `${account}/${l.name}`, title: String(l.title ?? ""), address });
      }
      locTok = String(data?.nextPageToken ?? "");
      if (!locTok) break;
    }
  }
  return { sedi, error: "" };
}

/**
 * LA SCHEDA GOOGLE DI UN PUNTO.
 *
 * ⚠️ Una scheda per sede, ma una sola AUTORIZZAZIONE per installazione.
 * Google Business Profile e' fatto cosi': un account gestisce piu' «locations»
 * — e' esattamente il caso di 450 Gradi, tre societa' sotto un conto solo.
 * Quindi il token OAuth resta in `app_config` (non appartiene a nessun punto),
 * mentre QUALE scheda sia di questo punto sta in `location_config`, accanto
 * all'indirizzo: e' un fatto di identita' della sede.
 *
 * `leggiConfig` sovrappone i due piani da sola — sede se c'e', installazione
 * altrimenti — quindi a sede unica il comportamento e' identico a prima.
 */
export async function salvaLocation(path: string, title: string, ambito: Ambito): Promise<void> {
  await scriviConfig(ambito, { [K_LOCATION]: path, [K_LOCATION_TITLE]: title });
}

/** Scheda salvata per questo punto (null se non ne ha ancora una). */
export async function locationSalvata(ambito: Ambito): Promise<{ path: string; title: string } | null> {
  const cfg = await leggiConfig(ambito, [K_LOCATION, K_LOCATION_TITLE]);
  const p = (cfg.valori.get(K_LOCATION) ?? "").trim();
  return p ? { path: p, title: cfg.valori.get(K_LOCATION_TITLE) ?? "" } : null;
}

/** Scheda Google (fiche) completa: dati profilo per il pannello a sinistra. */
export type GScheda = {
  title: string;
  address: string;
  phone: string;
  website: string;
  category: string;
  description: string;
  logo: string; // URL del logo/foto profilo che Google ha in memoria
  lat: number | null;
  lng: number | null;
  hours: { d: number; ranges: string[] }[]; // d = 0(lun)..6(dom)
};

const GIORNI = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** Logo/foto profilo della scheda dalla Media API v4 (LOGO -> PROFILE -> COVER). */
async function logoScheda(token: string, path: string): Promise<string> {
  const { data } = await gGetErr<{
    mediaItems?: { googleUrl?: string; thumbnailUrl?: string; locationAssociation?: { category?: string } }[];
  }>(token, `https://mybusiness.googleapis.com/v4/${path}/media`);
  const items = data?.mediaItems ?? [];
  const pick = (cat: string) =>
    items.find((m) => m.locationAssociation?.category === cat && (m.googleUrl || m.thumbnailUrl));
  const chosen = pick("LOGO") || pick("PROFILE") || pick("COVER");
  return chosen ? String(chosen.googleUrl || chosen.thumbnailUrl || "") : "";
}

/**
 * Dettagli della scheda dal Business Information API v1 (owner-managed).
 *
 * ⚠️ Rende anche il PERCHE' di un fallimento. Prima rendeva solo `null`, e chi
 * chiamava scriveva `if (scheda) …`: se Google rifiutava una scheda — non
 * verificata, in attesa, o su cui il conto non ha il ruolo giusto — il
 * pannello di QUEL punto restava vuoto e non lo diceva nessuno. Con tre
 * pizzerie si vede: due hanno la mappa e una no, e non c'e' niente da
 * guardare per capire perche'. Un lavoro «best-effort» che fallisce senza
 * lasciare traccia e' un lavoro che nessuno sistemera' mai.
 */
export async function dettagliScheda(
  token: string,
  path: string,
): Promise<{ scheda: GScheda | null; error: string }> {
  // path v4 = accounts/{a}/locations/{l}; v1 vuole solo "locations/{l}"
  const locName = path.split("/").slice(-2).join("/");
  const mask = "title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,latlng,profile";
  const { data, error: errScheda } = await gGetErr<{
    title?: string;
    storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string; administrativeArea?: string };
    phoneNumbers?: { primaryPhone?: string };
    websiteUri?: string;
    regularHours?: { periods?: { openDay?: string; openTime?: { hours?: number; minutes?: number }; closeTime?: { hours?: number; minutes?: number } }[] };
    categories?: { primaryCategory?: { displayName?: string } };
    latlng?: { latitude?: number; longitude?: number };
    profile?: { description?: string };
  }>(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}?readMask=${mask}`);
  if (!data) return { scheda: null, error: errScheda || "Fiche illisible" };

  const a = data.storefrontAddress;
  const address = a
    ? [(a.addressLines ?? []).join(" "), a.postalCode, a.locality, a.administrativeArea].filter(Boolean).join(", ")
    : "";
  const hm = (t?: { hours?: number; minutes?: number }): string =>
    `${String(t?.hours ?? 0).padStart(2, "0")}:${String(t?.minutes ?? 0).padStart(2, "0")}`;
  const byDay: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const p of data.regularHours?.periods ?? []) {
    const di = GIORNI.indexOf(String(p.openDay ?? ""));
    if (di < 0) continue;
    byDay[di].push(`${hm(p.openTime)}\u2013${hm(p.closeTime)}`);
  }
  const logo = await logoScheda(token, path);
  return { scheda: {
    title: String(data.title ?? ""),
    address,
    phone: String(data.phoneNumbers?.primaryPhone ?? ""),
    website: String(data.websiteUri ?? ""),
    category: String(data.categories?.primaryCategory?.displayName ?? ""),
    description: String(data.profile?.description ?? ""),
    logo,
    lat: typeof data.latlng?.latitude === "number" ? data.latlng.latitude : null,
    lng: typeof data.latlng?.longitude === "number" ? data.latlng.longitude : null,
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, ranges: byDay[d] })),
  }, error: "" };
}

// ============================================================
// MODIFICA SCHEDA (Business Information API v1) — orari, orari speciali,
// descrizione, telefono, sito. Categorie/attributi = step successivo.
// ============================================================
export type OrarioRange = { a: string; b: string };
export type IndirizzoEdit = {
  lines: string;       // via/numero (addressLines uniti)
  postalCode: string;  // CAP
  locality: string;    // citta'
  adminArea: string;   // provincia/regione (opzionale)
  regionCode: string;  // codice paese CLDR (es. BE) — necessario per l'update
};
export type SchedaEdit = {
  title: string;
  address: string;        // versione display (unita) per il banner
  addr: IndirizzoEdit;    // indirizzo strutturato modificabile
  category: string;
  description: string;
  phone: string;          // telefono principale
  phone2: string;         // telefono aggiuntivo (primo additionalPhones)
  website: string;
  status: string;         // openInfo.status: OPEN | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  hours: { d: number; chiuso: boolean; ranges: OrarioRange[] }[]; // d 0..6 = lun..dom
  special: { date: string; closed: boolean; a: string; b: string }[]; // date ISO YYYY-MM-DD
};

/** Legge la scheda in forma MODIFICABILE (orari come {a,b}, orari speciali). */
export async function leggiScheda(token: string, path: string): Promise<SchedaEdit | null> {
  const locName = path.split("/").slice(-2).join("/");
  const mask = "title,storefrontAddress,phoneNumbers,websiteUri,regularHours,specialHours,categories,profile,openInfo";
  const { data } = await gGetErr<{
    title?: string;
    storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string; administrativeArea?: string; regionCode?: string };
    phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
    websiteUri?: string;
    regularHours?: { periods?: { openDay?: string; openTime?: { hours?: number; minutes?: number }; closeTime?: { hours?: number; minutes?: number } }[] };
    specialHours?: { specialHourPeriods?: { startDate?: { year?: number; month?: number; day?: number }; closed?: boolean; openTime?: { hours?: number; minutes?: number }; closeTime?: { hours?: number; minutes?: number } }[] };
    categories?: { primaryCategory?: { displayName?: string } };
    profile?: { description?: string };
    openInfo?: { status?: string };
  }>(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}?readMask=${mask}`);
  if (!data) return null;

  const hm = (t?: { hours?: number; minutes?: number }): string =>
    `${String(t?.hours ?? 0).padStart(2, "0")}:${String(t?.minutes ?? 0).padStart(2, "0")}`;
  const pad = (n?: number) => String(n ?? 0).padStart(2, "0");
  const a = data.storefrontAddress;
  const address = a
    ? [(a.addressLines ?? []).join(" "), a.postalCode, a.locality, a.administrativeArea].filter(Boolean).join(", ")
    : "";

  const byDay: Record<number, OrarioRange[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const p of data.regularHours?.periods ?? []) {
    const di = GIORNI.indexOf(String(p.openDay ?? ""));
    if (di < 0) continue;
    byDay[di].push({ a: hm(p.openTime), b: hm(p.closeTime) });
  }
  const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, chiuso: byDay[d].length === 0, ranges: byDay[d] }));

  const special = (data.specialHours?.specialHourPeriods ?? [])
    .map((sp) => {
      const sd = sp.startDate;
      const date = sd?.year ? `${sd.year}-${pad(sd.month)}-${pad(sd.day)}` : "";
      if (sp.closed) return { date, closed: true, a: "", b: "" };
      return { date, closed: false, a: hm(sp.openTime), b: hm(sp.closeTime) };
    })
    .filter((x) => x.date);

  const addr: IndirizzoEdit = {
    lines: (a?.addressLines ?? []).join(" "),
    postalCode: String(a?.postalCode ?? ""),
    locality: String(a?.locality ?? ""),
    adminArea: String(a?.administrativeArea ?? ""),
    regionCode: String(a?.regionCode ?? ""),
  };

  return {
    title: String(data.title ?? ""),
    address,
    addr,
    category: String(data.categories?.primaryCategory?.displayName ?? ""),
    description: String(data.profile?.description ?? ""),
    phone: String(data.phoneNumbers?.primaryPhone ?? ""),
    phone2: String((data.phoneNumbers?.additionalPhones ?? [])[0] ?? ""),
    website: String(data.websiteUri ?? ""),
    status: String(data.openInfo?.status ?? "OPEN"),
    hours,
    special,
  };
}

/** PATCH della location: corpo + updateMask (campi con dot-path). */
export async function aggiornaScheda(
  token: string,
  path: string,
  corpo: Record<string, unknown>,
  updateMask: string
): Promise<{ ok: boolean; error: string }> {
  const locName = path.split("/").slice(-2).join("/");
  try {
    const r = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}?updateMask=${encodeURIComponent(updateMask)}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo) }
    );
    const txt = await r.text();
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

/** Legge l'indirizzo grezzo (storefrontAddress) così com'è su Google — per fare
 *  un merge in scrittura senza perdere languageCode e senza introdurre campi
 *  che il paese non usa (es. administrativeArea in Belgio → INVALID_ARGUMENT). */
export async function leggiIndirizzoRaw(token: string, path: string): Promise<Record<string, unknown> | null> {
  const locName = path.split("/").slice(-2).join("/");
  const { data } = await gGetErr<{ storefrontAddress?: Record<string, unknown> }>(
    token,
    `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}?readMask=storefrontAddress`
  );
  return data?.storefrontAddress ?? null;
}

/** Mappa giorno 0..6 (lun..dom) -> enum Google. */
export const GIORNI_ENUM = GIORNI;

// ---------------------------------------------------------------------------
// ATTRIBUTI della scheda (parcheggio, pagamenti, accessibilita', servizi...).
// Dinamici e dipendenti dalla categoria: si leggono da Google, non si hardcodano.
// ---------------------------------------------------------------------------
export type AttrType = "BOOL" | "ENUM" | "URL" | "REPEATED_ENUM";
export type AttrOption = { value: string; label: string };
export type AttrItem = {
  id: string;                 // "attributes/xxx"
  type: AttrType;
  label: string;
  options: AttrOption[];      // ENUM / REPEATED_ENUM
  bool: boolean | null;       // BOOL
  enumVal: string | null;     // ENUM
  set: string[];              // REPEATED_ENUM (valori attivi)
  urls: string[];             // URL
  repeatable: boolean;
};
export type AttrGroup = { group: string; items: AttrItem[] };

type MetaRaw = {
  parent?: string;
  valueType?: string;
  displayName?: string;
  groupDisplayName?: string;
  repeatable?: boolean;
  deprecated?: boolean;
  valueMetadata?: { value?: string; displayName?: string }[];
};
type AttrRaw = {
  name?: string;
  valueType?: string;
  values?: unknown[];
  repeatedEnumValue?: { setValues?: string[]; unsetValues?: string[] };
  uriValues?: { uri?: string }[];
};

/** Legge gli attributi disponibili per la categoria + i valori correnti, raggruppati. */
export async function leggiAttributi(token: string, path: string, lang: string): Promise<{ gruppi: AttrGroup[] | null; error: string }> {
  const locName = path.split("/").slice(-2).join("/");
  const base = "https://mybusinessbusinessinformation.googleapis.com/v1";

  // 0) categoria (gcid) + regione della scheda: servono per attributes.list.
  //    NB: con "parent" Google vieta languageCode/showAll; con categoryName+regionCode
  //    si puo' invece scegliere la lingua. Quindi preferiamo la seconda via.
  const { data: info } = await gGetErr<{
    categories?: { primaryCategory?: { name?: string } };
    storefrontAddress?: { regionCode?: string };
  }>(token, `${base}/${locName}?readMask=categories,storefrontAddress`);
  const categoryName = String(info?.categories?.primaryCategory?.name ?? "");
  const regionCode = String(info?.storefrontAddress?.regionCode ?? "");

  // 1) metadati disponibili (paginati)
  const metas: MetaRaw[] = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const qs = categoryName && regionCode
      ? `categoryName=${encodeURIComponent(categoryName)}&regionCode=${encodeURIComponent(regionCode)}&languageCode=${encodeURIComponent(lang || "en")}&pageSize=100`
      : `parent=${encodeURIComponent(locName)}&pageSize=100`;
    const url = `${base}/attributes?${qs}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const { data, status, error } = await gGetErr<{ attributeMetadata?: MetaRaw[]; nextPageToken?: string }>(token, url);
    if (!data) return { gruppi: null, error: `[meta ${status}] ${error} (cat=${categoryName || "?"} reg=${regionCode || "?"})` };
    for (const m of data.attributeMetadata ?? []) metas.push(m);
    pageToken = String(data.nextPageToken ?? "");
    if (!pageToken) break;
  }

  // 2) valori correnti della scheda
  // Valori correnti dall'endpoint dedicato locations.getAttributes
  // (locations/{id}/attributes), lo STESSO su cui si scrive. NB: leggere via
  // ?readMask=attributes sulla location dà una vista diversa/non aggiornata.
  const { data: cur } = await gGetErr<{ attributes?: AttrRaw[] }>(
    token,
    `${base}/${locName}/attributes`
  );
  const byId = new Map<string, AttrRaw>();
  for (const a of cur?.attributes ?? []) if (a.name) byId.set(a.name, a);

  // 3) merge -> gruppi
  const groups = new Map<string, AttrItem[]>();
  for (const m of metas) {
    if (m.deprecated) continue;
    const id = String(m.parent ?? "");
    const type = String(m.valueType ?? "") as AttrType;
    if (!id || !["BOOL", "ENUM", "URL", "REPEATED_ENUM"].includes(type)) continue;
    const c = byId.get(id);
    const options: AttrOption[] = (m.valueMetadata ?? [])
      .filter((v) => v.value != null)
      .map((v) => ({ value: String(v.value), label: String(v.displayName ?? v.value) }));
    const boolVal = type === "BOOL"
      ? (c?.values?.[0] === true ? true : c?.values?.[0] === false ? false : null)
      : null;
    const item: AttrItem = {
      id,
      type,
      label: String(m.displayName ?? id),
      options,
      bool: boolVal,
      enumVal: type === "ENUM" ? (c?.values?.[0] != null ? String(c.values[0]) : null) : null,
      set: type === "REPEATED_ENUM" ? (c?.repeatedEnumValue?.setValues ?? []).map(String) : [],
      urls: type === "URL" ? (c?.uriValues ?? []).map((u) => String(u.uri ?? "")).filter(Boolean) : [],
      repeatable: Boolean(m.repeatable),
    };
    const g = String(m.groupDisplayName ?? "").trim() || "Autres";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  return { gruppi: [...groups.entries()].map(([group, items]) => ({ group, items })), error: "" };
}

/** Aggiorna gli attributi cambiati. items = solo quelli modificati. */
export async function aggiornaAttributi(
  token: string,
  path: string,
  items: { id: string; type: AttrType; bool?: boolean | null; enumVal?: string | null; set?: string[]; unset?: string[]; urls?: string[] }[]
): Promise<{ ok: boolean; error: string; notApplied?: string[]; resp?: string }> {
  const locName = path.split("/").slice(-2).join("/");
  const attributes: AttrRaw[] = [];
  const mask: string[] = [];
  for (const it of items) {
    // NB: valueType è "output only" per Google → NON va inviato nel body.
    const a: AttrRaw = { name: it.id };
    if (it.type === "BOOL") a.values = it.bool === true ? [true] : it.bool === false ? [false] : [];
    else if (it.type === "ENUM") a.values = it.enumVal ? [it.enumVal] : [];
    else if (it.type === "REPEATED_ENUM") a.repeatedEnumValue = { setValues: (it.set ?? []).filter(Boolean), unsetValues: (it.unset ?? []).filter(Boolean) };
    else if (it.type === "URL") a.uriValues = (it.urls ?? []).filter(Boolean).map((u) => ({ uri: u }));
    attributes.push(a);
    mask.push(it.id);
  }
  if (!mask.length) return { ok: true, error: "" };
  try {
    const r = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}/attributes?attributeMask=${encodeURIComponent(mask.join(","))}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${locName}/attributes`, attributes }),
      }
    );
    const txt = await r.text();
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    // La risposta di updateAttributes È l'oggetto Attributes aggiornato:
    // verifichiamo che i valori inviati siano stati davvero applicati.
    let respAttrs: AttrRaw[] = [];
    try { respAttrs = (JSON.parse(txt) as { attributes?: AttrRaw[] }).attributes ?? []; } catch { /* ignore */ }
    const byName = new Map<string, AttrRaw>();
    for (const a of respAttrs) if (a.name) byName.set(a.name, a);
    const notApplied: string[] = [];
    for (const it of items) {
      const g = byName.get(it.id);
      let okv = false;
      if (it.type === "BOOL") { const v = g?.values?.[0]; okv = it.bool === null ? v === undefined : v === it.bool; }
      else if (it.type === "ENUM") { const v = g?.values?.[0]; okv = it.enumVal ? v === it.enumVal : v === undefined; }
      else if (it.type === "REPEATED_ENUM") { const got = new Set((g?.repeatedEnumValue?.setValues ?? []).map(String)); const want = new Set((it.set ?? []).filter(Boolean)); okv = got.size === want.size && [...want].every((x) => got.has(x)); }
      else if (it.type === "URL") { const got = new Set((g?.uriValues ?? []).map((u) => String(u.uri ?? ""))); const want = new Set((it.urls ?? []).filter(Boolean)); okv = got.size === want.size && [...want].every((x) => got.has(x)); }
      if (!okv) notApplied.push(it.id);
    }
    return { ok: true, error: "", notApplied, resp: txt.slice(0, 500) };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

// ---------------------------------------------------------------------------
// FOTO / MEDIA della scheda (logo, copertina, galleria) — API v4.
// ---------------------------------------------------------------------------
export type GMedia = { id: string; url: string; category: string };

/** Elenca le foto della scheda (paginato). */
export async function listaMedia(token: string, path: string): Promise<{ media: GMedia[]; error: string }> {
  const media: GMedia[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const url = `https://mybusiness.googleapis.com/v4/${path}/media?pageSize=100` + (pageToken ? `&pageToken=${pageToken}` : "");
    const { data, error } = await gGetErr<{
      mediaItems?: { name?: string; googleUrl?: string; thumbnailUrl?: string; sourceUrl?: string; locationAssociation?: { category?: string } }[];
      nextPageToken?: string;
    }>(token, url);
    if (!data) return { media, error };
    for (const m of data.mediaItems ?? []) {
      media.push({
        id: String(m.name ?? ""),
        url: String(m.googleUrl || m.thumbnailUrl || m.sourceUrl || ""),
        category: String(m.locationAssociation?.category ?? "ADDITIONAL"),
      });
    }
    pageToken = String(data.nextPageToken ?? "");
    if (!pageToken) break;
  }
  return { media, error: "" };
}

/** Carica una foto (da URL pubblico) con una categoria (LOGO/COVER/ADDITIONAL...). */
export async function caricaMedia(token: string, path: string, sourceUrl: string, category: string): Promise<{ ok: boolean; error: string }> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${path}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mediaFormat: "PHOTO", locationAssociation: { category }, sourceUrl }),
    });
    const txt = await r.text();
    if (!r.ok) {
      let msg = ""; try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

/** Elimina una foto (mediaName = accounts/../locations/../media/..). */
export async function eliminaMedia(token: string, mediaName: string): Promise<{ ok: boolean; error: string }> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${mediaName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      let msg = ""; try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

// ---------------------------------------------------------------------------
// FOOD MENU (menu del ristorante su Google) — API v4.
// ---------------------------------------------------------------------------
export type FMLabel = { displayName: string; description?: string; languageCode: string };
export type FMItem = { labels: FMLabel[]; attributes: { price: { currencyCode: string; units: string; nanos: number } } };
export type FMSection = { labels: FMLabel[]; items: FMItem[] };
export type FMMenu = { labels: FMLabel[]; sections: FMSection[] };

/** Stato del menu Google attuale (best-effort): quante sezioni ha già. */
export async function leggiFoodMenuStato(token: string, path: string): Promise<{ ok: boolean; sezioni: number; error: string }> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${path}/foodMenus`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const txt = await r.text();
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, sezioni: 0, error: msg || `HTTP ${r.status}` };
    }
    let sez = 0;
    try {
      const d = JSON.parse(txt) as { menus?: { sections?: unknown[] }[] };
      for (const m of d.menus ?? []) sez += (m.sections ?? []).length;
    } catch { /* ignore */ }
    return { ok: true, sezioni: sez, error: "" };
  } catch {
    return { ok: false, sezioni: 0, error: "Connexion à Google impossible" };
  }
}

/** Sostituisce il menu Google con quello fornito (updateMask=menus). */
export async function spingiFoodMenu(token: string, path: string, menus: FMMenu[]): Promise<{ ok: boolean; error: string }> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${path}/foodMenus?updateMask=menus`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${path}/foodMenus`, menus }),
    });
    const txt = await r.text();
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

/**
 * Scopre la scheda (location) del cliente: primo account + prima location.
 * NB: fase 1 = una sola scheda per cliente (auto-selezione della prima).
 * Il multi-sede sara' un raffinamento successivo (picker).
 */
export async function scopriLocation(token: string): Promise<{ path: string; title: string } | null> {
  const { sedi } = await listaSedi(token);
  // 1 sola scheda -> auto-selezione (zero attrito). 0 o piu' di 1 -> serve la
  // scelta esplicita dell'utente (il picker), cosi' non si lega la sede sbagliata.
  if (sedi.length !== 1) return null;
  return { path: sedi[0].path, title: sedi[0].title };
}

// ⚠️ Qui c'era `assicuraLocation(token)`: leggeva e scriveva la scheda Google
// in `app_config` senza ambito. Non la chiamava piu' nessuno — `locationSalvata`
// e `salvaLocation` la sostituiscono, e prendono l'ambito — ma restava
// esportata, pronta a rendere la scheda di un'altra sede al primo che la
// riusava. Tolta il 20/09/2026.

type ReviewApi = {
  reviewId?: string;
  name?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

/** Elenco COMPLETO delle recensioni della scheda (paginato) + voto medio e totale. */
export async function listaRecensioni(
  token: string,
  path: string
): Promise<{ reviews: GReview[]; average: number; total: number; error: string }> {
  const out: GReview[] = [];
  let average = 0;
  let total = 0;
  let error = "";
  let pageToken = "";
  // Tetto anti-runaway: 200 pagine da 50 = 10 000 recensioni. Era 40 (2000),
  // e una scheda oltre quella soglia perdeva il resto SENZA dirlo — vedi il
  // messaggio qui sotto: se il tetto si tocca davvero, ora si legge nei log.
  const MAX_PAGINE = 200;
  for (let i = 0; i < MAX_PAGINE; i++) {
    const url =
      `https://mybusiness.googleapis.com/v4/${path}/reviews?pageSize=50` + (pageToken ? `&pageToken=${pageToken}` : "");
    const { data: j, error: e } = await gGetErr<{
      reviews?: ReviewApi[];
      averageRating?: number;
      totalReviewCount?: number;
      nextPageToken?: string;
    }>(token, url);
    if (e && !out.length) error = e;
    if (!j) break;
    if (typeof j.averageRating === "number") average = j.averageRating;
    if (typeof j.totalReviewCount === "number") total = j.totalReviewCount;
    for (const r of j.reviews ?? []) {
      const reviewId = String(r.reviewId ?? r.name ?? "").trim();
      if (!reviewId || !r.name) continue;
      out.push({
        reviewId,
        name: r.name,
        author: String(r.reviewer?.displayName ?? "").trim(),
        photo: String(r.reviewer?.profilePhotoUrl ?? "").trim(),
        rating: STELLE[String(r.starRating ?? "")] ?? 0,
        comment: String(r.comment ?? "").trim(),
        createTime: String(r.createTime ?? ""),
        updateTime: String(r.updateTime ?? ""),
        replyComment: r.reviewReply?.comment ? String(r.reviewReply.comment) : null,
        replyTime: r.reviewReply?.updateTime ? String(r.reviewReply.updateTime) : null,
      });
    }
    pageToken = String(j.nextPageToken ?? "");
    if (!pageToken) break;
    if (i === MAX_PAGINE - 1) {
      console.error(
        `[google] recensioni troncate al tetto di ${MAX_PAGINE} pagine (${out.length} lette, totale dichiarato ${total}): alzare MAX_PAGINE.`
      );
    }
  }
  return { reviews: out, average, total, error };
}

/** Pubblica/aggiorna la risposta del ristorante a una recensione. */
export async function rispondiRecensione(token: string, reviewName: string, comment: string): Promise<boolean> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Elimina la risposta del ristorante (non la recensione). */
export async function eliminaRisposta(token: string, reviewName: string): Promise<boolean> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ============================================================
// POST (Local Posts) — Google Business Profile, API v4.
// Tipi: STANDARD ("Novità"), EVENT, OFFER. Scope business.manage (già presente).
// La foto è un URL pubblico (media.sourceUrl): riusiamo lo storage del motore.
// ============================================================
export type GData = { year: number; month: number; day: number };
export type GPost = {
  name?: string;            // accounts/../locations/../localPosts/..
  languageCode?: string;
  summary?: string;
  topicType?: string;       // STANDARD | EVENT | OFFER | ALERT
  state?: string;           // LIVE | REJECTED | PROCESSING
  createTime?: string;
  updateTime?: string;
  searchUrl?: string;
  media?: { mediaFormat?: string; sourceUrl?: string; googleUrl?: string }[];
  callToAction?: { actionType?: string; url?: string };
  event?: { title?: string; schedule?: { startDate?: GData; endDate?: GData } };
  offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string };
};

export async function listaPost(token: string, path: string): Promise<{ posts: GPost[]; error: string }> {
  const { data, error } = await gGetErr<{ localPosts?: GPost[] }>(
    token,
    `https://mybusiness.googleapis.com/v4/${path}/localPosts?pageSize=100`
  );
  if (error) return { posts: [], error };
  return { posts: data?.localPosts ?? [], error: "" };
}

export async function creaPost(
  token: string,
  path: string,
  corpo: Record<string, unknown>
): Promise<{ ok: boolean; error: string; post?: GPost }> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${path}/localPosts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const txt = await r.text();
    if (!r.ok) {
      let msg = "";
      try { msg = String((JSON.parse(txt) as { error?: { message?: string } })?.error?.message ?? ""); } catch { /* ignore */ }
      return { ok: false, error: msg || `HTTP ${r.status}` };
    }
    let post: GPost | undefined;
    try { post = JSON.parse(txt) as GPost; } catch { /* ignore */ }
    return { ok: true, error: "", post };
  } catch {
    return { ok: false, error: "Connexion à Google impossible" };
  }
}

/** postName = accounts/../locations/../localPosts/.. (campo name del post). */
export async function eliminaPost(token: string, postName: string): Promise<boolean> {
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${postName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

const K_PROFILE = "google_profile";
const K_RATING = "google_rating";
const K_COUNT = "google_review_count";
const K_SYNCED = "google_reviews_synced_at";

/**
 * DI CHI SONO LE RECENSIONI DI QUESTA SCHEDA.
 *
 * `google_reviews` e' una tabella «sede»: tre societa', tre schede Google,
 * tre flussi. Ma Google non sa niente di sedi — quello che lega una
 * recensione a un punto e' la SCHEDA da cui arriva.
 *
 * ⚠️ Prima questa funzione non esisteva e il sync scriveva senza
 * `location_id`: le recensioni gia' in tabella sopravvivevano (un upsert
 * non tocca le colonne che non gli passi), ma ogni recensione NUOVA
 * nasceva orfana e spariva da ogni punto. Il travaso dello storico
 * ripara il passato; senza questa riga, il futuro si rompeva di nuovo.
 *
 * Due fonti, in ordine, e nessuna delle due e' un'ipotesi:
 *  1. la sede che dichiara QUESTA scheda in `location_config.google_location`
 *     (e' cosi' dal pezzo 6 in poi: una scheda per punto);
 *  2. finche' la scheda e' ancora una sola per installazione, la sede a cui
 *     appartengono le recensioni GIA' in tabella — cioe' la risposta che il
 *     super admin ha dato accendendo il multi-sede.
 * Se non si sa, si rende null e la recensione resta orfana: comparira' nel
 * prossimo conteggio invece di essere attribuita a caso.
 */
async function sedeDelleRecensioni(path: string): Promise<string | null> {
  try {
    if (!(await multiSedeAttivo())) return null; // sede unica: NULL e' la verita'

    const { data: dichiarata } = await supabaseAdmin
      .from("location_config")
      .select("location_id")
      .eq("key", K_LOCATION)
      .eq("value", path)
      .maybeSingle();
    const id = (dichiarata as { location_id?: string } | null)?.location_id;
    if (id) return id;

    const { data: gia } = await supabaseAdmin
      .from("google_reviews")
      .select("location_id")
      .not("location_id", "is", null)
      .limit(1)
      .maybeSingle();
    return (gia as { location_id?: string } | null)?.location_id ?? null;
  } catch {
    return null; // migrazione non ancora lanciata: com'era prima
  }
}

/**
 * La sede che dichiara GIA' questa scheda, se c'e'. `null` = libera.
 *
 * ⚠️ Non usa `maybeSingle()`: con due sedi sullo stesso percorso la query
 * rende due righe e `maybeSingle` fallisce, cioe' proprio nel caso che
 * questa funzione esiste per scoprire risponderebbe «nessuna».
 */
export async function sedeConLaScheda(path: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("location_config")
      .select("location_id")
      .eq("key", K_LOCATION)
      .eq("value", path)
      .limit(1);
    const riga = (data ?? [])[0] as { location_id?: string } | undefined;
    return riga?.location_id ?? null;
  } catch {
    return null; // migrazione non lanciata: non c'e' niente da separare
  }
}

/**
 * Sincronizza le recensioni da Google nel Supabase del cliente (upsert).
 * Riusata da /api/admin/google/sync (manuale) e dal cron orario.
 */
export async function sincronizzaRecensioni(ambito: Ambito): Promise<{
  stato: "non_collegato" | "nessuna_scheda" | "scelta_richiesta" | "ok";
  /** Quando `stato` e' "non_collegato": PERCHE'. Mai collegato e scaduto
   *  portano a due azioni diverse, e chiamare entrambi «non collegato»
   *  manda il ristoratore a cercare un pulsante gia' premuto. */
  motivo?: StatoGoogle;
  location?: string;
  synced?: number;
  average?: number;
  total?: number;
  reviewError?: string;
  /** ⚠️ Google ha rifiutato la SCHEDA (non le recensioni): il pannello
   *  business di questo punto resta vuoto, e questo dice perche'. */
  schedaError?: string;
}> {
  const { token, stato: motivo } = await tokenGoogle();
  if (!token) return { stato: "non_collegato", motivo };
  let schedaError = "";

  // Sede: prima quella scelta esplicitamente; poi auto-selezione se ce n'e' 1
  // sola; altrimenti serve che l'utente scelga (picker) -> "scelta_richiesta".
  let loc = await locationSalvata(ambito);
  if (!loc) {
    const auto = await scopriLocation(token);
    if (auto) {
      await salvaLocation(auto.path, auto.title, ambito);
      loc = auto;
    } else {
      const { sedi } = await listaSedi(token);
      return { stato: sedi.length > 1 ? "scelta_richiesta" : "nessuna_scheda" };
    }
  }

  const { reviews, average, total, error } = await listaRecensioni(token, loc.path);
  const nowISO = new Date().toISOString();

  // Recensioni gia' note (per rilevare le NUOVE e notificare l'admin).
  // ⚠️ Anche qui a PAGINE DI 1000, e qui il troncamento faceva un danno vero:
  // oltre le mille recensioni gli id mancanti facevano sembrare NUOVE delle
  // recensioni vecchie, e il ristoratore riceveva una notifica push per una
  // recensione di mesi prima. Con 1138 recensioni stava gia' succedendo.
  let idsEsistenti = new Set<string>();
  try {
    const PAGINA = 1000;
    for (let da = 0; ; da += PAGINA) {
      const { data: ex, error } = await supabaseAdmin
        .from("google_reviews")
        .select("review_id")
        .order("review_id", { ascending: true })
        .range(da, da + PAGINA - 1);
      if (error) throw error;
      for (const x of ex ?? []) idsEsistenti.add(String((x as { review_id?: unknown }).review_id ?? ""));
      if (!ex || ex.length < PAGINA) break;
    }
  } catch { /* best-effort: se fallisce, semplicemente non notifica */ }

  let dbError = "";
  if (reviews.length) {
    // La sede la sa gia' il chiamante: la scheda appartiene a QUESTO punto.
    // `sedeDelleRecensioni` resta come ripiego per l'installazione che non ha
    // ancora dichiarato la scheda sede per sede.
    const sedeRec = sedeDaAttribuire({
      ambito,
      dichiarata: await sedeDelleRecensioni(loc.path),
      multiSede: await multiSedeAttivo(),
    });
    const righe = reviews.map((r) => ({
      review_id: r.reviewId,
      name: r.name,
      author: r.author,
      photo: r.photo,
      rating: r.rating,
      comment: r.comment,
      create_time: r.createTime || null,
      update_time: r.updateTime || null,
      reply_comment: r.replyComment,
      reply_time: r.replyTime || null,
      synced_at: nowISO,
      // ⚠️ La colonna entra nel payload SOLO se la sede si sa. Un upsert
      // aggiorna quello che gli passi: mettendo `location_id: null` quando
      // non si sa, ogni sync CANCELLEREBBE l'attribuzione di tutte le
      // recensioni gia' assegnate — l'opposto di quello che serve. Non
      // sapendo, si tace: le righe vecchie restano dove sono e le nuove
      // nascono orfane, e come tali compaiono nel conteggio.
      ...campoSede(sedeRec),
    }));
    const { error: upErr } = await supabaseAdmin.from("google_reviews").upsert(righe, { onConflict: "review_id" });
    if (upErr) dbError = upErr.message;

    // Notifica push all'admin per le recensioni NUOVE. Salta il primissimo
    // sync (DB vuoto) per non notificare l'intero storico all'attivazione.
    if (!upErr && idsEsistenti.size > 0) {
      const nuove = reviews.filter((r) => r.reviewId && !idsEsistenti.has(r.reviewId));
      if (nuove.length) {
        // la piu' recente per create_time → autore/voto da mostrare
        const ultima = [...nuove].sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))[0];
        // La sede e' quella della SCHEDA da cui arriva la recensione: un
        // avviso per Stockel non deve suonare a Jourdan.
        void inviaPushRecensione(
          { author: ultima.author, rating: ultima.rating, count: nuove.length },
          ambitoDiRiga(sedeRec),
        );
      }
    }
  }

  // Voto, numero di recensioni e ultimo sync sono della SCHEDA, quindi del
  // punto: `scriviConfig` li mette in `location_config` dentro una sede e in
  // `app_config` a sede unica. Senza questo, tre pizzerie si sovrascriverebbero
  // il voto a vicenda ogni ora, e la tile della home mostrerebbe quello
  // dell'ultimo sync arrivato.
  await scriviConfig(ambito, {
    [K_RATING]: String(average || ""),
    [K_COUNT]: String(total || reviews.length),
    [K_SYNCED]: nowISO,
  });

  // Dettagli scheda (fiche) per il pannello business.
  //
  // ⚠️ Un fallimento qui NON blocca le recensioni — sono due cose diverse e
  // una scheda illeggibile non deve far perdere un sync — ma si DICE. Il
  // pannello vuoto di un punto solo, senza spiegazione, e' il guasto che si
  // guarda per mezz'ora prima di capire che Google sta rifiutando la scheda.
  const { scheda, error: errScheda } = await dettagliScheda(token, loc.path);
  if (scheda) {
    await scriviConfig(ambito, { [K_PROFILE]: JSON.stringify(scheda) });
  } else if (errScheda) {
    console.error(`[google] scheda illeggibile per ${loc.path}: ${errScheda}`);
    schedaError = errScheda;
  }

  return {
    stato: "ok",
    location: loc.title,
    synced: reviews.length,
    average,
    total,
    reviewError: error || (dbError ? `DB: ${dbError}` : undefined),
    schedaError,
  };
}

/**
 * SINCRONIZZA TUTTI I PUNTI, uno per uno. La usa il cron orario.
 *
 * ⚠️ Un punto che fallisce NON deve fermare gli altri: se la scheda di
 * Stockel da' errore, Jourdan e Schaerbeek devono comunque aggiornarsi.
 * Per questo il `try` sta DENTRO il ciclo e l'esito si accumula invece di
 * propagarsi. A sede unica il ciclo fa un giro solo, com'e' sempre stato.
 */
export async function sincronizzaTutteLeSedi(): Promise<{
  sedi: { sede: string; stato: string; synced?: number; errore?: string }[];
}> {
  if (!(await multiSedeAttivo())) {
    const r = await sincronizzaRecensioni(ambitoDiRiga(null));
    return { sedi: [{ sede: "", stato: r.stato, synced: r.synced, errore: r.reviewError }] };
  }
  const esiti: { sede: string; stato: string; synced?: number; errore?: string }[] = [];
  for (const s of await elencoSedi()) {
    try {
      const r = await sincronizzaRecensioni(ambitoDiRiga(s.id));
      esiti.push({ sede: s.name, stato: r.stato, synced: r.synced, errore: r.reviewError });
    } catch (e) {
      esiti.push({ sede: s.name, stato: "errore", errore: e instanceof Error ? e.message : "" });
    }
  }
  return { sedi: esiti };
}

/** Nome-risorsa v4 di una recensione a partire dal suo id (per rispondere). */
export async function nomeRecensione(reviewId: string, ambito: Ambito): Promise<string | null> {
  // ⚠️ FILTRATO. Rispondere e' un atto PUBBLICO firmato dal ristorante: senza
  // il filtro, il responsabile di Stockel potrebbe rispondere a una recensione
  // di Jourdan, e la risposta comparirebbe su Google a nome di un'altra
  // societa'. Qui l'id arriva dal browser.
  const { data } = await leggi("google_reviews", ambito, "name")
    .eq("review_id", reviewId)
    .maybeSingle();
  const name = String((data as { name?: unknown } | null)?.name ?? "").trim();
  return name || null;
}


// ============================================================
//  PERFORMANCE — statistiche della scheda (viste, click, chiamate,
//  indicazioni, prenotazioni, ordini, menu) + parole chiave di ricerca.
//  Business Profile Performance API v1 (scope business.manage).
//  NB: i dati Google hanno qualche giorno di latenza; gli ultimi 1-3
//  giorni sono spesso 0. Le keyword sono mensili.
// ============================================================

const PERF_BASE = "https://businessprofileperformance.googleapis.com/v1";

const PERF_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;

export type PerfPoint = { date: string; value: number }; // date = "YYYY-MM-DD"
export type PerfSerie = { metric: string; total: number; punti: PerfPoint[] };
export type PerfKeyword = { keyword: string; value: number; approx: boolean };
export type PerfData = {
  serie: PerfSerie[];
  keywords: PerfKeyword[];
  from: string;
  to: string;
  error: string;
};

function perfYmd(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function perfIso(o: { year?: number; month?: number; day?: number }): string {
  const y = o.year ?? 0, m = o.month ?? 1, d = o.day ?? 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parole chiave di ricerca (mensili) aggregate sul range di mesi coperto. */
async function leggiKeywords(
  token: string,
  locName: string,
  inizio: Date,
  fine: Date,
): Promise<PerfKeyword[]> {
  const qp = new URLSearchParams();
  qp.set("monthlyRange.start_month.year", String(inizio.getUTCFullYear()));
  qp.set("monthlyRange.start_month.month", String(inizio.getUTCMonth() + 1));
  qp.set("monthlyRange.end_month.year", String(fine.getUTCFullYear()));
  qp.set("monthlyRange.end_month.month", String(fine.getUTCMonth() + 1));
  qp.set("pageSize", "100");
  const url = `${PERF_BASE}/${locName}/searchkeywords/impressions/monthly?${qp.toString()}`;
  const { data } = await gGetErr<{
    searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[];
  }>(token, url);
  const agg = new Map<string, { value: number; approx: boolean }>();
  for (const k of data?.searchKeywordsCounts ?? []) {
    const kw = String(k?.searchKeyword ?? "").trim();
    if (!kw) continue;
    const iv = k?.insightsValue ?? {};
    const val = iv.value != null ? Number(iv.value) : iv.threshold != null ? Number(iv.threshold) : 0;
    const approx = iv.value == null; // threshold = valore approssimato ("<X")
    const prev = agg.get(kw) ?? { value: 0, approx: false };
    prev.value += Number.isFinite(val) ? val : 0;
    prev.approx = prev.approx || approx;
    agg.set(kw, prev);
  }
  return [...agg.entries()]
    .map(([keyword, v]) => ({ keyword, value: v.value, approx: v.approx }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);
}

/** Serie temporali giornaliere + keyword per il periodo indicato (in giorni). */
export async function leggiPerformance(token: string, path: string, giorni: number): Promise<PerfData> {
  const locName = path.split("/").slice(-2).join("/"); // "locations/{id}"
  const oggi = new Date();
  const inizio = new Date(oggi);
  inizio.setUTCDate(inizio.getUTCDate() - (giorni - 1));
  const s = perfYmd(inizio), e = perfYmd(oggi);

  const qp = new URLSearchParams();
  for (const m of PERF_METRICS) qp.append("dailyMetrics", m);
  qp.set("dailyRange.start_date.year", String(s.year));
  qp.set("dailyRange.start_date.month", String(s.month));
  qp.set("dailyRange.start_date.day", String(s.day));
  qp.set("dailyRange.end_date.year", String(e.year));
  qp.set("dailyRange.end_date.month", String(e.month));
  qp.set("dailyRange.end_date.day", String(e.day));

  const url = `${PERF_BASE}/${locName}:fetchMultiDailyMetricsTimeSeries?${qp.toString()}`;
  const { data, error } = await gGetErr<{
    multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: unknown }[];
  }>(token, url);

  const serie: PerfSerie[] = [];
  for (const blocco of data?.multiDailyMetricTimeSeries ?? []) {
    const raw = blocco?.dailyMetricTimeSeries;
    const lista = (Array.isArray(raw) ? raw : raw ? [raw] : []) as {
      dailyMetric?: string;
      timeSeries?: { datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[] };
    }[];
    for (const dm of lista) {
      const metric = String(dm?.dailyMetric ?? "");
      if (!metric) continue;
      const punti: PerfPoint[] = [];
      let total = 0;
      for (const dv of dm?.timeSeries?.datedValues ?? []) {
        const v = Number(dv?.value ?? 0) || 0;
        total += v;
        punti.push({ date: perfIso(dv?.date ?? {}), value: v });
      }
      serie.push({ metric, total, punti });
    }
  }

  let keywords: PerfKeyword[] = [];
  try { keywords = await leggiKeywords(token, locName, inizio, oggi); } catch { keywords = []; }

  return { serie, keywords, from: perfIso(s), to: perfIso(e), error };
}
