import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, listaSedi, salvaLocation, locationSalvata, sincronizzaRecensioni } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET  /api/admin/google/locations  -> elenca tutte le schede (account × location)
//                                       accessibili col token + la sede attuale.
// POST /api/admin/google/locations  body { path, title } -> salva la sede scelta
//                                       e sincronizza subito le recensioni.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const token = await accessToken();
  if (!token) return json({ connected: false, sedi: [], current: null, error: "" });

  const [{ sedi, error }, current] = await Promise.all([listaSedi(token), locationSalvata()]);
  return json({ connected: true, sedi, current, error });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { path?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const path = String(body.path ?? "").trim();
  const title = String(body.title ?? "").trim();
  // formato v4 atteso: accounts/{id}/locations/{id}
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(path)) {
    return json({ error: "Fiche invalide" }, 400);
  }

  const token = await accessToken();
  if (!token) return json({ error: "Google non collegato" }, 400);

  await salvaLocation(path, title);
  const r = await sincronizzaRecensioni();
  return json({
    ok: true,
    location: r.location ?? title,
    synced: r.synced ?? 0,
    rating: r.average,
    count: r.total,
    reviewError: r.reviewError ?? "",
  });
};
