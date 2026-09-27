import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Verifica di un Place ID Google (livello 1 di Google Business: sola lettura).
// Usa la Places API con la chiave MOODD (GOOGLE_PLACES_API_KEY), condivisa
// tra i clienti: il Place ID invece è per-cliente (app_config).
// GET ?place_id=… → { name, rating, reviews }

const KEY = import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!KEY) return json({ error: await msg("err.placesKey") }, 500);

  const placeId = (url.searchParams.get("place_id") ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(placeId)) return json({ error: await msg("err.placeId") }, 400);

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri",
      },
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[google-place]", res.status, t.slice(0, 500));
      // Messaggio VERO di Google (chiave non valida, API non attiva, billing…)
      let dettaglio = "";
      try {
        const e = JSON.parse(t) as { error?: { message?: string; status?: string } };
        dettaglio = e.error?.message ?? e.error?.status ?? "";
      } catch {
        dettaglio = t.slice(0, 160);
      }
      if (res.status === 404) return json({ error: await msg("err.placeNotFound") }, 404);
      return json({ error: `Google (${res.status}) : ${dettaglio || (await msg("err.googleRefused"))}` }, 502);
    }
    const j = (await res.json()) as {
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
    };
    return json({
      ok: true,
      name: j.displayName?.text ?? "",
      rating: j.rating ?? null,
      reviews: j.userRatingCount ?? 0,
      maps_url: j.googleMapsUri ?? "",
    });
  } catch {
    return json({ error: await msg("err.googleConn") }, 502);
  }
};
