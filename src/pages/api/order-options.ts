import type { APIRoute } from "astro";
// Multi-sede: quale punto sta guardando il sito pubblico.
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";
import { opzioniOrdini, soglieConsegna, manceDi } from "../../lib/ordiniOpzioni";

export const prerender = false;

/**
 * GET /api/order-options — cosa offre QUESTO punto al checkout del ritiro,
 * oltre al pagamento: la consegna (con soglie e costo) e le mance.
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
  // Le soglie si dicono: sono scritte sul sito («minimum 50 €»), non segreti.
  let soglie: Awaited<ReturnType<typeof soglieConsegna>> = { minimo: 0, gratis: 0, costo: 0, zone: [] };
  // Le mance: tipo e tre valori, o `null` se spente. Al TAVOLO decide la sala.
  let mance: Awaited<ReturnType<typeof manceDi>> = null;
  try {
    const ambito = await ambitoPubblicoChiesto(request);
    consegna = (await opzioniOrdini(ambito)).consegna;
    if (consegna) soglie = await soglieConsegna(ambito);
    // `?sala=1`: chiede la pagina del tavolo, e in sala le mance hanno un
    // interruttore loro (`orders_table_tips`). Tipo e valori sono gli stessi.
    mance = await manceDi(ambito, { sala: new URL(request.url).searchParams.get("sala") === "1" });
  } catch {
    consegna = false;
  }
  return new Response(JSON.stringify({ consegna, minimo_cents: soglie.minimo, gratis_cents: soglie.gratis, costo_cents: soglie.costo,
    // Le zone col nome: il checkout le mostra in un menu a tendina
    // («1050 — Ixelles»), e il nome e' scritto in Réglages sapendolo.
    zone: soglie.zone.map((z) => ({ nome: z.nome, cap: z.cap, costo_cents: z.costo_cents })),
    mance }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
