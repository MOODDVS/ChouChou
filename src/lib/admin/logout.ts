import { supabaseBrowser, scriviCookieToken, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabaseBrowser";

/**
 * DISCONNESSIONE dello staff — unica implementazione, usata da ogni pagina admin.
 *
 * Prima queste righe erano copiate identiche in 13 pagine:
 *     await supabaseBrowser.auth.signOut();
 *     window.location.replace("/admin/login");
 *
 * `signOut()` revoca la sessione su TUTTI i dispositivi, e per farlo fa un giro
 * di rete verso Supabase. Il `await` mette quel giro di rete DAVANTI all'uscita:
 * se la rete e' lenta il bottone resta immobile per secondi e sembra rotto (chi
 * clicca ci riclicca sopra). Il guasto e' intermittente, quindi passa inosservato.
 *
 * Qui l'ordine e' rovesciato:
 *  1. la revoca globale parte in sottofondo con `keepalive`, cosi' il browser la
 *     porta a termine anche dopo il cambio di pagina: non c'e' nulla da aspettare;
 *  2. la sessione LOCALE viene tolta subito — `scope: "local"` non chiama nessun
 *     endpoint — e con lei il cookie SSR `mdd_at`;
 *  3. si va al login immediatamente.
 *
 * Se la rete e' giu' il punto 1 fallisce in silenzio: si esce lo stesso, che e'
 * il comportamento giusto (in locale il token non c'e' piu').
 */

/** Tetto massimo di attesa prima di andarsene comunque. Non dovrebbe mai scattare:
 *  tutto quello che aspettiamo e' locale. E' la rete di sicurezza. */
const CAP_MS = 1200;

const attesa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Toglie a mano la sessione dal localStorage (chiave `sb-<ref>-auth-token`).
 *  Ultima spiaggia: se l'SDK non avesse risposto in tempo, senza questo la
 *  pagina di login ci rispedirebbe dentro. Idempotente. */
function svuotaSessioneLocale(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
    }
  } catch {
    /* localStorage negato (modalita' privata): il cookie e il replace bastano */
  }
}

async function scollega(): Promise<void> {
  // Lettura locale della sessione: nessuna rete (salvo token gia' scaduto, e in
  // quel caso la revoca non serve piu' comunque).
  const { data } = await supabaseBrowser.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    // Revoca su tutti i dispositivi. keepalive = sopravvive alla navigazione.
    void fetch(`${SUPABASE_URL}/auth/v1/logout?scope=global`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    }).catch(() => {
      /* rete giu': la sessione locale sparisce lo stesso, qui sotto */
    });
  }
  // Solo locale: niente rete, risposta immediata.
  await supabaseBrowser.auth.signOut({ scope: "local" });
}

/** Esce e va al login. Non ritorna mai davvero: la pagina cambia. */
export async function esci(): Promise<void> {
  await Promise.race([scollega().catch(() => {}), attesa(CAP_MS)]);
  svuotaSessioneLocale();
  scriviCookieToken(null);
  window.location.replace("/admin/login");
}

/** Aggancia il bottone di disconnessione dell'header. Gestisce anche il doppio
 *  clic e lo stato "sto uscendo", cosi' il bottone non sembra mai morto. */
export function collegaLogout(btn: HTMLElement | null | undefined): void {
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (btn.dataset.uscita) return;
    btn.dataset.uscita = "1";
    btn.setAttribute("aria-busy", "true");
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
    void esci();
  });
}
