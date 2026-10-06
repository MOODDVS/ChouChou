import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { visibilite, visibiliteDetail, sitoValido } from "../../../lib/searchConsole";
import { isSuperUser } from "../../../lib/admin/superAdmin";

export const prerender = false;

// Dati Search Console per la tile « Visibilité » dell'Accueil.
// Sito per-cliente (app_config: gsc_site), chiave service account MOODD (env).

const K_SITE = "gsc_site";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const url = new URL(request.url);

  // ---- PROVARE una proprietà SENZA SCRIVERE NIENTE ------------------------
  // ⚠️ Il bottone «Vérifier» del pannello SALVAVA `gsc_site` prima di
  // interrogare, perche' questa rotta sapeva leggere il sito solo da
  // app_config. Una prova andata male lasciava registrata la proprieta'
  // sbagliata, e nessuno aveva chiesto di salvarla: un bottone che fa una
  // cosa in piu' di quella che dice e' il modo di perdere una
  // configurazione che funzionava.
  //
  // Solo il super: e' lui che configura. Il robot risponde comunque soltanto
  // per le proprieta' a cui e' stato aggiunto come utente, quindi non c'e'
  // niente da scoprire provando indirizzi a caso.
  const prova = url.searchParams.get("site");
  if (prova !== null) {
    if (!isSuperUser(staff)) return nonAutorizzato();
    const sito = prova.trim().slice(0, 300);
    // `visibilite("")` torna gia' «non configurata»: niente chiamata a Google
    // per una proprieta' scritta male.
    return json(await visibilite(sitoValido(sito) ? sito : ""));
  }

  let site = "";
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", K_SITE)
      .maybeSingle();
    site = String(data?.value ?? "");
  } catch {
    /* niente config */
  }

  if (!site) return json({ configured: false });

  // Modalità dettaglio per la pagina Statistiques → onglet Google.
  if (url.searchParams.get("detail")) {
    const GIORNI = [7, 28, 90, 180, 365];
    const d = Number(url.searchParams.get("days"));
    const days = GIORNI.includes(d) ? d : 28;
    const v = await visibiliteDetail(site, days);
    return json(v);
  }

  const v = await visibilite(site);
  return json(v);
};
