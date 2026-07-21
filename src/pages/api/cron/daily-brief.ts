import type { APIRoute } from "astro";
import { eseguiDailyBrief } from "../../../lib/admin/dailyBrief";

export const prerender = false;

// GET /api/cron/daily-brief — chiamato OGNI ORA da uno scheduler esterno
// (es. cron-job.org, fuso Europe/Brussels). Protetto da CRON_SECRET (.env).
// È la lib a decidere se inviare davvero (toggle, ora configurata, una
// sola volta al giorno) → chiamarlo più spesso non fa danni.
// ?force=1 = invio immediato di test (ignora ora e "già inviata oggi",
// ma NON il toggle: l'email parte solo se attivata nei Réglages).

const CRON_SECRET = import.meta.env.CRON_SECRET;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  const chiave = request.headers.get("x-cron-key") ?? url.searchParams.get("key") ?? "";
  if (chiave !== CRON_SECRET) return json({ error: "Non autorisé" }, 401);

  const force = url.searchParams.get("force") === "1";
  try {
    const esito = await eseguiDailyBrief(force);
    return json(esito);
  } catch {
    return json({ sent: false, reason: "errore interno" }, 500);
  }
};
