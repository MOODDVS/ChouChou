import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { calcolaStatsResa } from "../../../lib/admin/statsResa";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

export const prerender = false;

// GET /api/admin/stats-reservations?giorni=30 -> statistiche prenotazioni aggregate

const AMMESSI = [7, 15, 30, 90, 180, 365];

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let giorni = parseInt(url.searchParams.get("giorni") || "30", 10);
  if (!AMMESSI.includes(giorni)) giorni = 30;
  try {
    const stats = await calcolaStatsResa(giorni, await ambitoDiRichiesta(request, staff));
    return json({ stats });
  } catch (e) {
    console.error("[stats-reservations]", (e as Error)?.message ?? e);
    return json({ error: adminT(await adminLang())("err.read") }, 500);
  }
};
