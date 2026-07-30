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

// Places API (New) restituisce 5 recensioni scelte da Google come "pertinenti"
// e NON sa ordinarle per data. L'unico endpoint che lo sa fare è Places API
// (Legacy) con reviews_sort=newest. Lo proviamo per primo; se il progetto
// Cloud non ha la Legacy attiva torniamo alle recensioni della New API.
async function avisPlusRecents(placeId: string): Promise<Avis[] | null> {
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    u.searchParams.set("place_id", placeId);
    u.searchParams.set("fields", "reviews");
    u.searchParams.set("reviews_sort", "newest");
    u.searchParams.set("language", "fr");
    u.searchParams.set("key", String(KEY));
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      result?: {
        reviews?: {
          author_name?: string;
          rating?: number;
          text?: string;
          relative_time_description?: string;
          time?: number;
        }[];
      };
    };
    const brut = j.status === "OK" ? j.result?.reviews ?? [] : [];
    if (!brut.length) return null;
    return brut
      .slice()
      .sort((a2, b2) => Number(b2.time ?? 0) - Number(a2.time ?? 0))
      .slice(0, 5)
      .map((r) => ({
        auteur: r.author_name ?? "",
        note: Number(r.rating ?? 0),
        texte: (r.text ?? "").slice(0, 1500),
        quand: r.relative_time_description ?? "",
      }));
  } catch {
    return null;
  }
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
            publishTime?: string;
          }[];
        };
        // 5 avis max de toute façon ; le niveau 2 (Business Profile API)
        // permettra de tous les récupérer, et d'y répondre.
        const secondi = (v?: string) => (v ? Date.parse(v) || 0 : 0);
        const avisNew: Avis[] = (j.reviews ?? [])
          .slice()
          .sort((a2, b2) => secondi(b2.publishTime) - secondi(a2.publishTime))
          .slice(0, 5)
          .map((r) => ({
            auteur: r.authorAttribution?.displayName ?? "",
            note: Number(r.rating ?? 0),
            texte: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 1500),
            quand: r.relativePublishTimeDescription ?? "",
          }));
        const avis = (await avisPlusRecents(placeId)) ?? avisNew;
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
