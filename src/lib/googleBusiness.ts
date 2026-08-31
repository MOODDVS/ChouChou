import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./db";

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

/** Access token fresco a partire dal refresh token salvato (null se non collegato). */
export async function accessToken(): Promise<string | null> {
  if (!googleConfigurato()) return null;
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", K_REFRESH)
    .maybeSingle();
  const refresh = String(data?.value ?? "").trim();
  if (!refresh) return null;
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
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch {
    return null;
  }
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
async function gGet<T>(token: string, url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Come gGet ma cattura status ed errore, per diagnosticare liste vuote / 403 (allowlist Google). */
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

/** Salva esplicitamente la sede scelta dall'utente. */
export async function salvaLocation(path: string, title: string): Promise<void> {
  await supabaseAdmin.from("app_config").upsert(
    [
      { key: K_LOCATION, value: path },
      { key: K_LOCATION_TITLE, value: title },
    ],
    { onConflict: "key" }
  );
}

/** Sede attualmente salvata (null se nessuna scelta). */
export async function locationSalvata(): Promise<{ path: string; title: string } | null> {
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("key,value")
    .in("key", [K_LOCATION, K_LOCATION_TITLE]);
  const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, String(r.value ?? "")]));
  const p = map.get(K_LOCATION);
  return p ? { path: p, title: map.get(K_LOCATION_TITLE) ?? "" } : null;
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

/** Dettagli della scheda dal Business Information API v1 (owner-managed). */
export async function dettagliScheda(token: string, path: string): Promise<GScheda | null> {
  // path v4 = accounts/{a}/locations/{l}; v1 vuole solo "locations/{l}"
  const locName = path.split("/").slice(-2).join("/");
  const mask = "title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,latlng,profile";
  const { data } = await gGetErr<{
    title?: string;
    storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string; administrativeArea?: string };
    phoneNumbers?: { primaryPhone?: string };
    websiteUri?: string;
    regularHours?: { periods?: { openDay?: string; openTime?: { hours?: number; minutes?: number }; closeTime?: { hours?: number; minutes?: number } }[] };
    categories?: { primaryCategory?: { displayName?: string } };
    latlng?: { latitude?: number; longitude?: number };
    profile?: { description?: string };
  }>(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${locName}?readMask=${mask}`);
  if (!data) return null;

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
  return {
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
  };
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

/** Location salvata in app_config; se manca la scopre e la salva. null = non trovata. */
export async function assicuraLocation(token: string): Promise<{ path: string; title: string } | null> {
  const { data } = await supabaseAdmin.from("app_config").select("key,value").in("key", [K_LOCATION, K_LOCATION_TITLE]);
  const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, String(r.value ?? "")]));
  const salvata = map.get(K_LOCATION);
  if (salvata) return { path: salvata, title: map.get(K_LOCATION_TITLE) ?? "" };
  const scoperta = await scopriLocation(token);
  if (!scoperta) return null;
  await supabaseAdmin.from("app_config").upsert(
    [
      { key: K_LOCATION, value: scoperta.path },
      { key: K_LOCATION_TITLE, value: scoperta.title },
    ],
    { onConflict: "key" }
  );
  return scoperta;
}

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
  for (let i = 0; i < 40; i++) {
    // fino a 40 pagine (2000 recensioni) di sicurezza
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
 * Sincronizza le recensioni da Google nel Supabase del cliente (upsert).
 * Riusata da /api/admin/google/sync (manuale) e dal cron orario.
 */
export async function sincronizzaRecensioni(): Promise<{
  stato: "non_collegato" | "nessuna_scheda" | "scelta_richiesta" | "ok";
  location?: string;
  synced?: number;
  average?: number;
  total?: number;
  reviewError?: string;
}> {
  const token = await accessToken();
  if (!token) return { stato: "non_collegato" };

  // Sede: prima quella scelta esplicitamente; poi auto-selezione se ce n'e' 1
  // sola; altrimenti serve che l'utente scelga (picker) -> "scelta_richiesta".
  let loc = await locationSalvata();
  if (!loc) {
    const auto = await scopriLocation(token);
    if (auto) {
      await salvaLocation(auto.path, auto.title);
      loc = auto;
    } else {
      const { sedi } = await listaSedi(token);
      return { stato: sedi.length > 1 ? "scelta_richiesta" : "nessuna_scheda" };
    }
  }

  const { reviews, average, total, error } = await listaRecensioni(token, loc.path);
  const nowISO = new Date().toISOString();

  let dbError = "";
  if (reviews.length) {
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
    }));
    const { error: upErr } = await supabaseAdmin.from("google_reviews").upsert(righe, { onConflict: "review_id" });
    if (upErr) dbError = upErr.message;
  }

  await supabaseAdmin.from("app_config").upsert(
    [
      { key: K_RATING, value: String(average || "") },
      { key: K_COUNT, value: String(total || reviews.length) },
      { key: K_SYNCED, value: nowISO },
    ],
    { onConflict: "key" }
  );

  // Dettagli scheda (fiche) per il pannello business — best-effort.
  const scheda = await dettagliScheda(token, loc.path);
  if (scheda) {
    await supabaseAdmin
      .from("app_config")
      .upsert([{ key: K_PROFILE, value: JSON.stringify(scheda) }], { onConflict: "key" });
  }

  return {
    stato: "ok",
    location: loc.title,
    synced: reviews.length,
    average,
    total,
    reviewError: error || (dbError ? `DB: ${dbError}` : undefined),
  };
}

/** Nome-risorsa v4 di una recensione a partire dal suo id (per rispondere). */
export async function nomeRecensione(reviewId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("google_reviews").select("name").eq("review_id", reviewId).maybeSingle();
  const name = String(data?.name ?? "").trim();
  return name || null;
}
