import { createClient } from "@supabase/supabase-js";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// Helper di autenticazione per gli endpoint admin (/api/admin/*).
// Verifica che la richiesta arrivi da uno staff autenticato, leggendo il
// token Bearer dall'header Authorization.
//
// STRATEGIA (veloce + sicura):
//   1. Cache 60s degli esiti già verificati (evita lavoro ripetuto).
//   2. PERCORSO VELOCE: verifica la firma del JWT IN LOCALE, senza rete,
//      usando le chiavi pubbliche del progetto (JWKS, chiavi asimmetriche
//      ES256/RS256). La firma la controlla il `crypto` nativo di Node:
//      nessuna dipendenza aggiuntiva.
//   3. FALLBACK: se il token non è verificabile in locale (algoritmo
//      simmetrico HS256, chiave sconosciuta, o JWKS irraggiungibile), si
//      ricade sul vecchio metodo `getUser(token)` che interroga il server
//      Auth di Supabase. Così NON si rompe nulla in nessuno scenario.
//
// SICUREZZA: un token con firma NON valida fallisce sia in locale sia nel
// fallback (getUser lo rifiuta comunque). Il fallback non indebolisce mai
// la verifica: serve solo a coprire i casi in cui la firma non si può
// controllare offline.

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variabili Supabase mancanti per adminAuth: controlla SUPABASE_URL e SUPABASE_ANON_KEY"
  );
}

// Client server-side senza sessione persistente: usato SOLO per il fallback
// di rete (validazione token quando la verifica locale non è possibile).
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ============================================================
// AUTORIZZAZIONE (non solo autenticazione)
// ============================================================
// Un JWT valido prova solo che l'utente esiste sul progetto Supabase del
// cliente. Per accedere all'admin serve essere STAFF PROVISIONATO:
//  - super admin MOODD (email fissa), oppure
//  - un ruolo esplicito in app_metadata (scrivibile solo con service key:
//    lo assegna il pannello Réglages → Users), oppure
//  - un'email nella allowlist di bootstrap (env, per account legacy).
// Chi si auto-registrasse (registrazioni Supabase per errore aperte) NON ha
// ruolo → viene RIFIUTATO. Difesa in profondità: anche se le registrazioni
// fossero aperte, non si ottiene accesso all'admin.
const SUPER_EMAIL_AUTH = "admin@moodd.online";
const BOOTSTRAP_EMAILS = new Set(
  String(import.meta.env.ADMIN_BOOTSTRAP_EMAILS ?? process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function staffAutorizzato(u: StaffUser): boolean {
  const email = (u.email ?? "").trim().toLowerCase();
  if (email === SUPER_EMAIL_AUTH) return true; // super MOODD: sempre
  if (u.role === "super" || u.role === "admin" || u.role === "user") return true; // ruolo esplicito
  if (u.is_super === true) return true; // vecchio flag booleano
  if (email && BOOTSTRAP_EMAILS.has(email)) return true; // valvola legacy (env)
  return false; // nessun ruolo → probabile auto-registrato → rifiutato
}

// Forma minima dell'utente usata dagli endpoint admin: bastano id ed email.
export interface StaffUser {
  id: string;
  email: string | null;
  /** Ruolo (app_metadata, scrivibile solo con service key): super | admin | user. */
  role?: string;
  /** Vecchio flag booleano, tenuto per retrocompatibilità. */
  is_super?: boolean;
}

// ============================================================
// Verifica LOCALE del JWT (percorso veloce, zero rete per richiesta)
// ============================================================

const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const JWKS_TTL_MS = 10 * 60_000; // le chiavi pubbliche cambiano di rado

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  [k: string]: unknown;
}

let jwksCache: { keys: Jwk[]; scade: number } | null = null;

async function leggiJwks(forza = false): Promise<Jwk[]> {
  if (!forza && jwksCache && Date.now() < jwksCache.scade) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { headers: { apikey: SUPABASE_ANON_KEY } });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const body: any = await res.json();
  const keys: Jwk[] = Array.isArray(body?.keys) ? body.keys : [];
  jwksCache = { keys, scade: Date.now() + JWKS_TTL_MS };
  return keys;
}

function b64urlBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlJson(s: string): any {
  return JSON.parse(b64urlBuf(s).toString("utf8"));
}

/**
 * Prova a verificare il token IN LOCALE.
 * Ritorna lo StaffUser se la firma è valida e i claim sono ok.
 * Ritorna `null` se NON verificabile localmente (algoritmo non asimmetrico,
 * chiave sconosciuta, firma non valida, token scaduto, JWKS irraggiungibile):
 * in tutti questi casi il chiamante ricade sul fallback di rete, che è sicuro
 * perché un token davvero invalido fallisce anche lì.
 */
async function verificaLocale(token: string, opts: { ignoraScadenza?: boolean } = {}): Promise<StaffUser | null> {
  const parti = token.split(".");
  if (parti.length !== 3) return null;

  let header: any;
  let payload: any;
  try {
    header = b64urlJson(parti[0]);
    payload = b64urlJson(parti[1]);
  } catch {
    return null;
  }

  const alg = header?.alg;
  // Solo algoritmi asimmetrici sono verificabili con la sola chiave pubblica.
  if (alg !== "ES256" && alg !== "RS256") return null;

  // Trova la chiave giusta (per kid). Se non c'è, ricarica il JWKS una volta
  // (potrebbe essere stata ruotata).
  let jwk: Jwk | undefined;
  try {
    let keys = await leggiJwks();
    jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await leggiJwks(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
  } catch (e) {
    if (opts.ignoraScadenza) throw e; // modalità guard: il chiamante fa fail-open
    return null; // JWKS non raggiungibile → fallback di rete
  }
  if (!jwk) return null;

  let ok = false;
  try {
    const pub = createPublicKey({ key: jwk as any, format: "jwk" });
    const input = Buffer.from(parti[0] + "." + parti[1]);
    const sig = b64urlBuf(parti[2]);
    if (alg === "ES256") {
      // Le firme JOSE ES256 sono in formato raw r||s (IEEE P1363).
      ok = cryptoVerify("sha256", input, { key: pub, dsaEncoding: "ieee-p1363" }, sig);
    } else {
      ok = cryptoVerify("RSA-SHA256", input, pub, sig);
    }
  } catch {
    return null;
  }
  if (!ok) return null; // firma non valida → il fallback la rifiuterà comunque

  // Controllo claim essenziali.
  const now = Math.floor(Date.now() / 1000);
  if (!opts.ignoraScadenza && typeof payload.exp === "number" && payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 5) return null;
  if (payload.iss && !String(payload.iss).startsWith(SUPABASE_URL)) return null;
  if (!payload.sub) return null;

  return {
    id: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : null,
    role: typeof payload.app_metadata?.role === "string" ? payload.app_metadata.role : undefined,
    is_super: payload.app_metadata?.is_super === true,
  };
}

// ============================================================
// Cache degli esiti verificati (60s)
// ============================================================

const CACHE_TOKEN_MS = 60_000;
const tokenVerificati = new Map<string, { scade: number; user: StaffUser }>();

/**
 * Verifica la richiesta: estrae il token Bearer e lo valida.
 * Ritorna lo StaffUser se autenticato, altrimenti null.
 */
export async function verificaStaff(request: Request): Promise<StaffUser | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) return null;

  const inCache = tokenVerificati.get(token);
  if (inCache && Date.now() < inCache.scade) return inCache.user;

  // 1) Percorso veloce: verifica locale (nessuna rete).
  let user = await verificaLocale(token);

  // 2) Fallback di rete: solo se la verifica locale non è stata possibile.
  if (!user) {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return null;
    user = {
      id: data.user.id,
      email: data.user.email ?? null,
      role: (data.user.app_metadata as { role?: string } | undefined)?.role,
      is_super: (data.user.app_metadata as { is_super?: boolean } | undefined)?.is_super === true,
    };
  }

  // AUTORIZZAZIONE: token valido ma utente non provisionato → niente accesso.
  if (!staffAutorizzato(user)) return null;

  if (tokenVerificati.size > 200) tokenVerificati.clear();
  tokenVerificati.set(token, { scade: Date.now() + CACHE_TOKEN_MS, user });
  return user;
}

/**
 * Verifica un token IN LOCALE (per il render lato server delle pagine /admin).
 * Ritorna lo StaffUser se la firma è valida, altrimenti null. NON fa fallback
 * di rete: in SSR, se la verifica locale non riesce, la pagina ricade
 * semplicemente sul caricamento lato client.
 */
export async function verificaTokenLocale(token: string): Promise<StaffUser | null> {
  if (!token) return null;
  const user = await verificaLocale(token);
  if (!user || !staffAutorizzato(user)) return null;
  return user;
}

/**
 * «Questo browser si è già loggato qui?» — per il GUARD delle pagine /admin
 * nel middleware: firma valida di uno staff autorizzato, SCADENZA IGNORATA.
 * Decide solo se RENDERIZZARE la pagina (mai i dati: quelli richiedono sempre
 * un token vivo via Bearer/verificaStaff). Un token scaduto ma autentico =
 * utente che torna dopo un'ora → render, e il client rinfresca la sessione.
 */
export async function sessioneRiconosciuta(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    // Solo la FIRMA: non si controlla staffAutorizzato qui, altrimenti un utente
    // loggato ma non provisionato rimbalzerebbe login→admin→login all'infinito
    // (oggi quel caso lo chiude il client col 401 → signOut, e resta così).
    return !!(await verificaLocale(token, { ignoraScadenza: true }));
  } catch {
    return true; // JWKS irraggiungibile: fail-open (render come prima), mai un loop di login
  }
}

/** Risposta standard 401 per richieste non autenticate. */
export function nonAutorizzato(): Response {
  return new Response(JSON.stringify({ error: "Non autorisé" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
