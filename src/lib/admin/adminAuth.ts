import { createClient } from "@supabase/supabase-js";

// Helper di autenticazione per gli endpoint admin (/api/admin/*).
// Verifica che la richiesta arrivi da uno staff autenticato, leggendo il
// token Bearer dall'header Authorization e validandolo con Supabase.
//
// IMPORTANTE: getUser(token) fa una richiesta al server Auth di Supabase e
// restituisce dati ATTENDIBILI. Non ci si fida mai del solo token grezzo.
//
// Usa la chiave PUBBLICA (anon): è quella corretta per validare un token
// utente. La service key NON va usata per questo.

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variabili Supabase mancanti per adminAuth: controlla SUPABASE_URL e SUPABASE_ANON_KEY"
  );
}

// Client server-side senza sessione persistente: lo usiamo solo per validare
// di volta in volta il token ricevuto.
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cache dei token già verificati (60s): evita un round-trip al server
// Auth di Supabase per OGNI chiamata API dell'admin. I token durano 1 ora:
// riusare l'esito per 60 secondi è sicuro, e un logout invalida comunque
// la sessione lato client.
const CACHE_TOKEN_MS = 60_000;
const tokenVerificati = new Map<string, { scade: number; user: Awaited<ReturnType<typeof authClient.auth.getUser>>["data"]["user"] }>();

/**
 * Verifica la richiesta: estrae il token Bearer e lo valida.
 * Ritorna l'utente se autenticato, altrimenti null.
 */
export async function verificaStaff(request: Request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) return null;

  const inCache = tokenVerificati.get(token);
  if (inCache && Date.now() < inCache.scade) return inCache.user;

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;

  if (tokenVerificati.size > 200) tokenVerificati.clear();
  tokenVerificati.set(token, { scade: Date.now() + CACHE_TOKEN_MS, user: data.user });
  return data.user;
}

/** Risposta standard 401 per richieste non autenticate. */
export function nonAutorizzato(): Response {
  return new Response(JSON.stringify({ error: "Non autorisé" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
