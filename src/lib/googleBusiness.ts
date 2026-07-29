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
