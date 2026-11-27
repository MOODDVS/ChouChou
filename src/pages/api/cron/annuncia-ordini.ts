import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
// Multi-sede: il cron passa su TUTTI i punti.
import { tutteLeSedi } from "../../../lib/admin/sede";
import { segretoUguale } from "../../../lib/cronAuth";
import { rilasciaAnnunci } from "../../../lib/annuncioOrdini";

export const prerender = false;

// GET /api/cron/annuncia-ordini — job pg_cron OGNI 5 MINUTI (27/11/2026).
//
// Gli ordini presi a locale chiuso per un altro giorno aspettano l'apertura
// del giorno del ritiro (`orders.announce_at`, #101): qui, passata l'ora,
// escono il ticket in cucina e la notifica sul telefono; il toast col suono
// di RestoHub segue da solo (vedi `annuncioOrdini.ts`).
// Idempotente: ogni ordine si prende una volta sola. Nessuna email.

const CRON_SECRET = import.meta.env.CRON_SECRET;

export const GET: APIRoute = async ({ request }) => {
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  const chiave = request.headers.get("x-cron-key") ?? "";
  if (!segretoUguale(chiave, CRON_SECRET)) return json({ error: "Non autorisé" }, 401);
  try {
    const annunciati = await rilasciaAnnunci(tutteLeSedi(), 200);
    return json({ annunciati });
  } catch {
    return json({ error: "Annonce impossible" }, 500);
  }
};
