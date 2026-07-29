import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { cacheOr } from "../../../lib/cache";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Scheda Google del ristorante per la tile dell'Accueil (livello 1: lettura).
// Place ID per-cliente (app_config), chiave Places di MOODD (env).
// Cache 30 min: la nota cambia lentamente e le chiamate Google si pagano.

const KEY = import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface Avis {
  auteur: string;
  note: number;
  texte: string;
  quand: string;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", "google_place_id")
    .maybeSingle();
  const placeId = String(data?.value ?? "").trim();
  if (!placeId || !KEY) return json({ configured: false });

  try {
    const info = await cacheOr(
      "google:place:" + placeId,
      async () => {
        const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`, {
          headers: {
            "X-Goog-Api-Key": KEY,
            "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri,reviews",
          },
        });
        if (!res.ok) throw new Error("google " + res.status);
        const j = (await res.json()) as {
          displayName?: { text?: string };
          rating?: number;
          userRatingCount?: number;
          googleMapsUri?: string;
          reviews?: {
            rating?: number;
            text?: { text?: string };
            originalText?: { text?: string };
            authorAttribution?: { displayName?: string };
            relativePublishTimeDescription?: string;
          }[];
        };
        // Places API (New) ne renvoie que 5 avis max ; le niveau 2 (Business
        // Profile API) permettra de tous les récupérer.
        const avis: Avis[] = (j.reviews ?? []).slice(0, 10).map((r) => ({
          auteur: r.authorAttribution?.displayName ?? "",
          note: Number(r.rating ?? 0),
          texte: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 300),
          quand: r.relativePublishTimeDescription ?? "",
        }));
        return {
          name: j.displayName?.text ?? "",
          rating: j.rating ?? null,
          reviews: j.userRatingCount ?? 0,
          maps_url: j.googleMapsUri ?? "",
          avis,
        };
      },
      30 * 60_000
    );
    return json({ configured: true, ...info });
  } catch {
    return json({ configured: true, error: "Google indisponible" }, 200);
  }
};
