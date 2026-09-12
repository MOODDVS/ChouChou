import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";

export const prerender = false;

// GET /api/admin/google/reviews — legge la CACHE locale (istantaneo, niente
// chiamate a Google). Ritorna stato collegamento + meta + elenco recensioni.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data: cfg } = await supabaseAdmin
    .from("app_config")
    .select("key,value")
    .in("key", ["google_oauth_refresh", "google_location_title", "google_rating", "google_review_count", "google_reviews_synced_at", "google_profile"]);
  const m = new Map((cfg ?? []).map((r: { key: string; value: unknown }) => [r.key, String(r.value ?? "")]));

  // ⚠️ A PAGINE DI 1000. PostgREST ne rende al massimo 1000 per richiesta, e
  // senza `range` la lista si fermava li' in silenzio: la scheda diceva 1138
  // recensioni e il filtro «Tutte» ne mostrava 1000 tonde. Non era un limite
  // di Google, era il nostro. Stesso schema di `ordiniPagati` in calcolaStats.
  const PAGINA = 1000;
  const rev: unknown[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("google_reviews")
      .select("review_id,author,photo,rating,comment,create_time,reply_comment,reply_time")
      .order("create_time", { ascending: false })
      .range(da, da + PAGINA - 1);
    if (error) break; // quello che si e' letto finora vale comunque
    rev.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }

  return json({
    connected: Boolean((m.get("google_oauth_refresh") ?? "").trim()),
    location: m.get("google_location_title") ?? "",
    rating: m.get("google_rating") ?? "",
    count: m.get("google_review_count") ?? "",
    syncedAt: m.get("google_reviews_synced_at") ?? "",
    profile: (() => { try { return JSON.parse(m.get("google_profile") || "null"); } catch { return null; } })(),
    reviews: rev,
  });
};
