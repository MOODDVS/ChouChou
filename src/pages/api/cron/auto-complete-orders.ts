import type { APIRoute } from "astro";
import { segretoUguale } from "../../../lib/cronAuth";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { TIMEZONE } from "../../../lib/slots";

export const prerender = false;

// GET /api/cron/auto-complete-orders — chiamato OGNI ORA da uno scheduler
// esterno (es. cron-job.org), fuso Europe/Brussels. Protetto da CRON_SECRET.
//
// Regola: un ordine PAGATO non ancora completato dallo staff viene messo
// automaticamente in stato "done" alle 02:00 del giorno SUCCESSIVO al ritiro.
// Cioè: passata l'02:00, tutti i pagati con ritiro PRIMA della mezzanotte
// odierna diventano "done". Prima delle 02:00 vale ancora la soglia del
// giorno precedente (grazia notturna). Idempotente: chiamarlo più volte non fa
// danni. Non tocca pending / cancelled / done. Nessuna email inviata.

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
  if (!segretoUguale(chiave, CRON_SECRET)) return json({ error: "Non autorisé" }, 401);

  const nowB = DateTime.now().setZone(TIMEZONE);
  // Prima delle 02:00 gli ordini di IERI hanno ancora la grazia → soglia = inizio di ieri.
  const soglia = (nowB.hour < 2 ? nowB.minus({ days: 1 }) : nowB).startOf("day");
  const sogliaISO = soglia.toISO();
  if (!sogliaISO) return json({ error: "Data non valida" }, 500);

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "done" })
    .eq("status", "paid")
    .lt("pickup_time", sogliaISO)
    .select("id");

  if (error) return json({ error: "Mise à jour impossible" }, 500);
  return json({ completed: data?.length ?? 0, threshold: sogliaISO });
};
