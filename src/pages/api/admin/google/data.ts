import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, locationSalvata, leggiPerformance } from "../../../../lib/googleBusiness";
import { ambitoDiRichiesta } from "../../../../lib/admin/sede";

import { adminLang } from "../../../../lib/admin/adminLang";
import { adminT } from "../../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

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
  const { token: token, stato: sttoken } = await tokenGoogle();
  if (!token) return json({ error: await erroreGoogle(sttoken) }, 400);
  const loc = await locationSalvata(await ambitoDiRichiesta(request, staff));
  if (!loc?.path) return json({ error: await msg("err.googleNotLinked") }, 400);

  let giorni = parseInt(url.searchParams.get("giorni") || "30", 10);
  if (![7, 30, 90].includes(giorni)) giorni = 30;

  const data = await leggiPerformance(token, loc.path, giorni);
  if (data.error && data.serie.length === 0) return json({ error: data.error }, 502);
  return json(data);
};
