import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";
import { cacheOr } from "../../lib/cache";

export const prerender = false;

// Chiave Places di MOODD (env). Place ID per-cliente (app_config).
const KEY = import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

interface Rev { auteur: string; note: number; texte: string; quand: string; photo: string }

// GET /api/reviews — pubblico. Ultime 3 recensioni Google a 5 stelle del
// ristorante (per la sezione infos del sito). Cache 30 min (le chiamate Google
// si pagano). { configured, avis, rating, count, maps_url }.
export const GET: APIRoute = async ({ request }) => {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "google_place_id")
      .maybeSingle();
    const placeId = String(data?.value ?? "").trim();
    if (!placeId || !KEY) return json({ configured: false, avis: [] });

    const info = await cacheOr(
      "reviews:public:" + placeId,
      async () => {
        const res = await fetch(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`,
          { headers: { "X-Goog-Api-Key": KEY as string, "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri,reviews" } }
        );
        if (!res.ok) throw new Error("google " + res.status);
        const j = (await res.json()) as {
          rating?: number;
          userRatingCount?: number;
          googleMapsUri?: string;
          reviews?: {
            rating?: number;
            text?: { text?: string };
            originalText?: { text?: string };
            authorAttribution?: { displayName?: string; photoUri?: string };
            relativePublishTimeDescription?: string;
            publishTime?: string;
          }[];
        };
        const sec = (v?: string) => (v ? Date.parse(v) || 0 : 0);
        const all = (j.reviews ?? []).map((r) => ({
          auteur: r.authorAttribution?.displayName ?? "",
          note: Number(r.rating ?? 0),
          texte: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 320),
          quand: r.relativePublishTimeDescription ?? "",
          photo: r.authorAttribution?.photoUri ?? "",
          t: sec(r.publishTime),
        }));
        return { rating: j.rating ?? null, count: j.userRatingCount ?? 0, maps_url: j.googleMapsUri ?? "", all };
      },
      30 * 60_000
    );
    const url = new URL(request.url);
    const min = Math.max(1, Math.min(5, Number(url.searchParams.get("min")) || 5));
    const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit")) || 3));
    const avis: Rev[] = (info.all ?? [])
      .filter((r) => r.note >= min)
      .sort((a, b) => b.t - a.t)
      .slice(0, limit)
      .map((r) => ({ auteur: r.auteur, note: r.note, texte: r.texte, quand: r.quand, photo: r.photo }));
    return json({ configured: true, rating: info.rating, count: info.count, maps_url: info.maps_url, avis });
  } catch {
    return json({ configured: true, avis: [], error: "google" });
  }
};
