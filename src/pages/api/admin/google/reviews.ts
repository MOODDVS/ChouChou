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
    .in("key", ["google_oauth_refresh", "google_location_title", "google_rating", "google_review_count", "google_reviews_synced_at"]);
  const m = new Map((cfg ?? []).map((r: { key: string; value: unknown }) => [r.key, String(r.value ?? "")]));

  const { data: rev } = await supabaseAdmin
    .from("google_reviews")
    .select("review_id,author,photo,rating,comment,create_time,reply_comment,reply_time")
    .order("create_time", { ascending: false });

  return json({
    connected: Boolean((m.get("google_oauth_refresh") ?? "").trim()),
    location: m.get("google_location_title") ?? "",
    rating: m.get("google_rating") ?? "",
    count: m.get("google_review_count") ?? "",
    syncedAt: m.get("google_reviews_synced_at") ?? "",
    reviews: rev ?? [],
  });
};
