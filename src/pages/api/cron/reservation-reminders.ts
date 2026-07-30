import type { APIRoute } from "astro";
import { eseguiRappelReservations } from "../../../lib/rappelReservations";

export const prerender = false;

// GET /api/cron/reservation-reminders — appelé par un scheduler externe
// (cron-job.org), fuseau Europe/Brussels, TOUTES LES HEURES (ou 30 min pour
// un timing plus serré). Protégé par CRON_SECRET. La lib décide quoi envoyer
// (résa future, dans les 3 h, pas déjà rappelée) → l'appeler plus souvent ne
// fait aucun mal.

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
    const esito = await eseguiRappelReservations(force);
    return json(esito);
  } catch {
    return json({ sent: 0, checked: 0, reason: "errore interno" }, 500);
  }
};
