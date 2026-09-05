import { createClient } from "@supabase/supabase-js";

// Client Supabase per il BROWSER (lato client).
// Usa la chiave PUBBLICA (publishable / anon): è sicura da esporre,
// è limitata dalla RLS e serve solo a gestire login/logout e sessione
// dello staff. NON confondere con `supabaseAdmin` in db.ts, che usa la
// service key e gira esclusivamente sul server.

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variabili Supabase pubbliche mancanti: controlla PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_ANON_KEY nel file .env"
  );
}

export const supabaseBrowser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Mantiene la sessione nel browser e la rinnova da sola: così lo staff
    // resta loggato tra una pagina e l'altra senza dover rifare il login.
    persistSession: true,
    autoRefreshToken: true,
  },
});

// ============================================================
// Cookie di sessione per il RENDER LATO SERVER (SSR) — Fase 2
// ============================================================
// La sessione vive nel localStorage (sopra), ma il localStorage NON è
// leggibile dal server. Durante una navigazione di pagina il browser invia
// solo i COOKIE (non l'header Authorization), quindi per far autenticare il
// server in SSR teniamo un cookie con l'access token, sincronizzato al login,
// ad ogni refresh del token e al logout.
//
// È ADDITIVO: non tocca l'auth esistente. Se il cookie manca o è scaduto, le
// pagine ricadono sul comportamento attuale (fetch lato client). Non è
// httpOnly (lo scrive il client) → stessa esposizione del token già in
// localStorage. Scope `Path=/admin` così viaggia solo sulle pagine admin.
export function scriviCookieToken(token: string | null): void {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  if (token) {
    // 30 giorni (non 1h): il token dentro scade comunque dopo 1h (i DATI richiedono
    // sempre un token vivo), ma il cookie che sopravvive dice al server «questo
    // browser si è già loggato qui» → il middleware renderizza l'admin invece di
    // rimbalzare al login chi torna il giorno dopo. Al logout viene cancellato.
    document.cookie = `mdd_at=${token}; Path=/admin; Max-Age=2592000; SameSite=Lax${secure}`;
  } else {
    document.cookie = `mdd_at=; Path=/admin; Max-Age=0; SameSite=Lax${secure}`;
  }
}

if (typeof document !== "undefined") {
  // sync iniziale (pagina aperta con sessione già presente)
  supabaseBrowser.auth.getSession().then(({ data }) => {
    scriviCookieToken(data.session?.access_token ?? null);
  });
  // login / refresh token / logout
  supabaseBrowser.auth.onAuthStateChange((_event, session) => {
    scriviCookieToken(session?.access_token ?? null);
  });
}
