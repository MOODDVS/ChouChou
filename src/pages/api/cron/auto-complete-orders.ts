import type { APIRoute } from "astro";
// Multi-sede: il cron passa su TUTTI i punti.
import { aggiorna, tutteLeSedi, SEDE_UNICA } from "../../../lib/admin/sede";
import { segretoUguale } from "../../../lib/cronAuth";
import { DateTime } from "luxon";
import { fusoDi } from "../../../lib/fuso";

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
  // ⚠️ AGGREGATO, chiesto per nome. Il cron passa su TUTTI i punti: e' un
  // lavoro di manutenzione del gruppo, non di una sede.
  const ambito = tutteLeSedi();
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  const chiave = request.headers.get("x-cron-key") ?? url.searchParams.get("key") ?? "";
  if (!segretoUguale(chiave, CRON_SECRET)) return json({ error: "Non autorisé" }, 401);

  // ⚠️ Fuso dell'INSTALLAZIONE: questo cron passa su tutte le sedi insieme e
  // la soglia e' una sola. Non e' gratis — con sedi in fusi diversi, la
  // grazia delle 02:00 e' quella dell'installazione — ma e' una scelta
  // dichiarata, non una variabile globale che decide per conto suo.
  const nowB = DateTime.now().setZone(await fusoDi(SEDE_UNICA));
  // Prima delle 02:00 gli ordini di IERI hanno ancora la grazia → soglia = inizio di ieri.
  const soglia = (nowB.hour < 2 ? nowB.minus({ days: 1 }) : nowB).startOf("day");
  const sogliaISO = soglia.toISO();
  if (!sogliaISO) return json({ error: "Data non valida" }, 500);

  const { data, error } = await aggiorna("orders", ambito, { status: "done" })
    .eq("status", "paid")
    .lt("pickup_time", sogliaISO)
    .select("id");

  if (error) return json({ error: "Mise à jour impossible" }, 500);
  return json({ completed: data?.length ?? 0, threshold: sogliaISO });
};
