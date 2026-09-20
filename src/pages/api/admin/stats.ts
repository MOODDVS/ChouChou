import type { APIRoute } from "astro";
import { calcolaStats, type Periodo } from "../../../lib/admin/calcolaStats";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
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
  if (!PERIODI.includes(p)) return json({ error: await msg("err.period") }, 400);

  const stats = await calcolaStats(p, await ambitoDiRichiesta(request, staff));
  if (!stats) return json({ error: await msg("err.read") }, 500);
  return json(stats);
};
