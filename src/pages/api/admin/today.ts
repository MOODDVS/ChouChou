import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { configGiornoEffettiva } from "../../../lib/schedule";
import { TIMEZONE } from "../../../lib/slots";

export const prerender = false;

// GET /api/admin/today — config oraria EFFETTIVA di oggi (Europe/Brussels).
// Riusa configGiornoEffettiva: stessa fonte di verità di /api/slots e checkout,
// quindi tiene già conto dei giorni speciali (chiusure e aperture eccezionali).
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const config = await configGiornoEffettiva(DateTime.now().setZone(TIMEZONE));

  return new Response(JSON.stringify({ config }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
