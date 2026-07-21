import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { caricaToday } from "../../../lib/admin/caricaToday";

export const prerender = false;

// GET /api/admin/today — config oraria EFFETTIVA di oggi (Europe/Brussels).
// Riusa configGiornoEffettiva: stessa fonte di verità di /api/slots e checkout,
// quindi tiene già conto dei giorni speciali (chiusure e aperture eccezionali).
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const dati = await caricaToday();

  return new Response(JSON.stringify(dati), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
