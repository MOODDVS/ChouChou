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
