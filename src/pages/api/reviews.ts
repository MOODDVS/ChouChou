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

interface Rev { auteur: string; note: number; texte: string; quand: string }

// GET /api/reviews — pubblico. Ultime 3 recensioni Google a 5 stelle del
// ristorante (per la sezione infos del sito). Cache 30 min (le chiamate Google
// si pagano). { configured, avis, rating, count, maps_url }.
export const GET: APIRoute = async () => {
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
            authorAttribution?: { displayName?: string };
            relativePublishTimeDescription?: string;
            publishTime?: string;
          }[];
        };
        const sec = (v?: string) => (v ? Date.parse(v) || 0 : 0);
        const avis: Rev[] = (j.reviews ?? [])
          .filter((r) => Number(r.rating ?? 0) === 5)
          .sort((a, b) => sec(b.publishTime) - sec(a.publishTime))
          .slice(0, 3)
          .map((r) => ({
            auteur: r.authorAttribution?.displayName ?? "",
            note: 5,
            texte: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 320),
            quand: r.relativePublishTimeDescription ?? "",
          }));
        return { rating: j.rating ?? null, count: j.userRatingCount ?? 0, maps_url: j.googleMapsUri ?? "", avis };
      },
      30 * 60_000
    );
    return json({ configured: true, ...info });
  } catch {
    return json({ configured: true, avis: [], error: "google" });
  }
};
