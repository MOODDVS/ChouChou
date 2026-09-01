import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { calcolaStatsResa } from "../../../lib/admin/statsResa";

export const prerender = false;

// GET /api/admin/stats-reservations?giorni=30 -> statistiche prenotazioni aggregate
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const AMMESSI = [7, 15, 30, 90, 180, 365];

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let giorni = parseInt(url.searchParams.get("giorni") || "30", 10);
  if (!AMMESSI.includes(giorni)) giorni = 30;
  try {
    const stats = await calcolaStatsResa(giorni);
    return json({ stats });
  } catch (e) {
    return json({ error: (e as Error).message || "Errore" }, 500);
  }
};
