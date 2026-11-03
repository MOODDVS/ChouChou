import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { segretoUguale } from "../../../lib/cronAuth";
import { sincronizzaTutteLeSedi } from "../../../lib/googleBusiness";

export const prerender = false;

// GET /api/cron/google-reviews — chiamato OGNI ORA da uno scheduler esterno
// (o pg_cron). Protetto da CRON_SECRET. Sincronizza le recensioni Google nella
// cache locale. Idempotente; se il cliente non è collegato non fa nulla.

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;


export const GET: APIRoute = async ({ request }) => {
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  // Audit 3/11/2026: la chiave SOLO nell'header. Nell'indirizzo finiva nei log
  // di Caddy, di Hostinger e dello scheduler (controllato: nessun cron la usava).
  const chiave = request.headers.get("x-cron-key") ?? "";
  if (!segretoUguale(chiave, CRON_SECRET)) return json({ error: "Non autorisé" }, 401);

  // Tutti i punti, non piu' uno: ogni sede ha la sua scheda Google.
  const r = await sincronizzaTutteLeSedi();
  return json({ ok: true, ...r });
};
