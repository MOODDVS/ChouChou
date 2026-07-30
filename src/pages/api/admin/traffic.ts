import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Sources de trafic pour Statistiques → onglet Google.
// Agrège les visites (table page_views) par provenance sur N jours.

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
  const GIORNI = [7, 28, 90, 180, 365];
  const d = Number(url.searchParams.get("days"));
  const days = GIORNI.includes(d) ? d : 28;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const { data, error } = await supabaseAdmin.rpc("traffic_sources", { since });
    if (error) return json({ sources: [], total: 0 });
    const sources = (data as { source: string; count: number }[] | null ?? []).map((r) => ({
      source: String(r.source ?? "autre"),
      count: Number(r.count ?? 0),
    }));
    const total = sources.reduce((s, r) => s + r.count, 0);
    return json({ sources, total });
  } catch {
    return json({ sources: [], total: 0 });
  }
};
