import type { APIRoute } from "astro";
import { calcolaStats, type Periodo } from "../../../lib/admin/calcolaStats";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

/**
 * GET /api/admin/stats?period=day|week|month|ytd|all
 *
 * Qui NON c'e' nessun calcolo: lo fa `calcolaStats`, la stessa funzione che
 * usa il render lato server della pagina Statistiche. Prima questo file ne
 * aveva una copia completa — 180 righe gemelle, con in cima la promessa di
 * tenerle allineate a mano. Le promesse di questo tipo, in questo progetto,
 * sono gia' state disattese due volte (anteprima PDF, rosso del secondo tempo
 * su «Invia a tutti»): il guasto resta invisibile perche' una delle due copie
 * continua a funzionare.
 */
const PERIODI: Periodo[] = ["day", "week", "month", "ytd", "all"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const p = (url.searchParams.get("period") ?? "day") as Periodo;
  if (!PERIODI.includes(p)) return json({ error: "Période invalide" }, 400);

  const stats = await calcolaStats(p);
  if (!stats) return json({ error: "Lecture impossible" }, 500);
  return json(stats);
};
