import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { visibilite, visibiliteDetail } from "../../../lib/searchConsole";

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
  const url = new URL(request.url);
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
