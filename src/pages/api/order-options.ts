import type { APIRoute } from "astro";
// Multi-sede: quale punto sta guardando il sito pubblico.
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";
import { opzioniOrdini } from "../../lib/ordiniOpzioni";

export const prerender = false;

/**
 * GET /api/order-options — cosa offre QUESTO punto al checkout del ritiro,
 * oltre al pagamento: oggi la sola consegna.
 *
 * ⚠️ Lo chiede il carrello (`OrderApp`) da solo, e non lo riceve come prop
 * dalla pagina /order: quella pagina e' del CLIENTE (`merge=ours`), e un
 * interruttore che funzionasse solo dove qualcuno ha ritoccato la pagina
 * sarebbe un interruttore che in Réglages mente. Cosi' vale su tutti i siti
 * il giorno del merge.
 *
 * ⚠️ Risponde solo si'/no, mai la configurazione: e' una rotta pubblica.
 * Lettura muta → `consegna: false`, cioe' il checkout di sempre.
 */
export const GET: APIRoute = async ({ request }) => {
  let consegna = false;
  try {
    consegna = (await opzioniOrdini(await ambitoPubblicoChiesto(request))).consegna;
  } catch {
    consegna = false;
  }
  return new Response(JSON.stringify({ consegna }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
