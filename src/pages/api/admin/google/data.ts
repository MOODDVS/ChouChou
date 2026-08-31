import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, locationSalvata, leggiPerformance } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET /api/admin/google/data?giorni=30  -> statistiche (serie + keyword) del periodo

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const token = await accessToken();
  if (!token) return json({ error: "Google non collegato" }, 400);
  const loc = await locationSalvata();
  if (!loc?.path) return json({ error: "Scheda Google non configurata" }, 400);

  let giorni = parseInt(url.searchParams.get("giorni") || "30", 10);
  if (![7, 30, 90].includes(giorni)) giorni = 30;

  const data = await leggiPerformance(token, loc.path, giorni);
  if (data.error && data.serie.length === 0) return json({ error: data.error }, 502);
  return json(data);
};
