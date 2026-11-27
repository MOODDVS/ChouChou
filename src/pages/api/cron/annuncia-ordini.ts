import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
// Multi-sede: il cron passa su TUTTI i punti.
import { tutteLeSedi } from "../../../lib/admin/sede";
import { segretoUguale } from "../../../lib/cronAuth";
import { rilasciaAnnunci } from "../../../lib/annuncioOrdini";
import { rilasciaInviiScaduti } from "../../../lib/contoServer";
import { liberaCasseScadute } from "../../../lib/admin/incassoSeduta";

export const prerender = false;

// GET /api/cron/annuncia-ordini — job pg_cron OGNI 5 MINUTI (27/11/2026).
//
// Gli ordini presi a locale chiuso per un altro giorno aspettano l'apertura
// del giorno del ritiro (`orders.announce_at`, #101): qui, passata l'ora,
// escono il ticket in cucina e la notifica sul telefono; il toast col suono
// di RestoHub segue da solo (vedi `annuncioOrdini.ts`).
// Idempotente: ogni ordine si prende una volta sola. Nessuna email.
//
// ⚠️ E DI RISERVA GLI INVII DEL CONTO APERTO (audit 27/11/2026). Un invio
// parte quando un giro lo chiede (`rilasciaInviiScaduti`): il tablet su
// Commandes, la pagina del tavolo, il checkout del conto. Col tablet chiuso
// e nessuno che ordina dopo, il secondo giro di un tavolo restava fermo e
// in cucina non usciva niente. Qui lo si prende al massimo 5 minuti dopo; il
// passaggio a `released` e' condizionato, quindi mai un ticket doppio.
//
// ⚠️ E I TAVOLI COL «PAGAMENTO IN CASSA» DA VENTI MINUTI (#102): si liberano e
// i loro ordini da incassare si chiudono come pagati in cassa.

const CRON_SECRET = import.meta.env.CRON_SECRET;

export const GET: APIRoute = async ({ request }) => {
  if (!CRON_SECRET) return json({ error: "CRON_SECRET non configurato" }, 503);
  const chiave = request.headers.get("x-cron-key") ?? "";
  if (!segretoUguale(chiave, CRON_SECRET)) return json({ error: "Non autorisé" }, 401);
  try {
    const annunciati = await rilasciaAnnunci(tutteLeSedi(), 200);
    const invii = await rilasciaInviiScaduti(tutteLeSedi());
    // «Pagamento in cassa» da venti minuti: il tavolo si libera (#102).
    const liberati = await liberaCasseScadute(tutteLeSedi());
    return json({ annunciati, invii, liberati });
  } catch {
    return json({ error: "Annonce impossible" }, 500);
  }
};
