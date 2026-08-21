import type { APIRoute } from "astro";
import { sincronizzaRecensioni } from "../../../lib/googleBusiness";

export const prerender = false;

// GET /api/cron/google-reviews — chiamato OGNI ORA da uno scheduler esterno
// (o pg_cron). Protetto da CRON_SECRET. Sincronizza le recensioni Google nella
// cache locale. Idempotente; se il cliente non è collegato non fa nulla.

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;

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

  const r = await sincronizzaRecensioni();
  return json({ ok: true, ...r });
};
