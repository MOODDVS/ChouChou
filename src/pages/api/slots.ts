import type { APIRoute } from "astro";
import { slotsDelMese, slotsDelGiorno, giorniOrdinabili, giornoAmmesso } from "../../lib/slotsApi";
// Multi-sede: quale punto sta guardando il sito pubblico (segnaposto, pezzo 8).
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";

export const prerender = false;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Gli slot del SITO PUBBLICO. Il calcolo sta in `lib/slotsApi.ts`, condiviso
// con `/api/admin/slots`: le due porte devono dare la stessa risposta, o il
// cliente prende un orario che il checkout rifiuta.
export const GET: APIRoute = async ({ url, request }) => {
  // La sede la dice la RICHIESTA (header `x-sede` o `?sede=`), non piu' un
  // ripiego sulla prima. Chi non la dice ricade su `ambitoPubblico()`.
  const ambito = await ambitoPubblicoChiesto(request);

  const mese = url.searchParams.get("month");
  if (mese) {
    const r = await slotsDelMese(mese, ambito);
    return "errore" in r ? json({ error: r.errore }, 400) : json(r);
  }

  // ?days=1 → i giorni in cui si puo' ritirare (oggi + la finestra scelta
  // in Réglages). Il checkout ne fa una fila di bottoni; con la finestra a
  // zero la lista e' solo oggi, e il sito non mostra nessuna scelta.
  // `?service=delivery` → gli orari (e i giorni) di una CONSEGNA: piu' tardi
  // del ritiro di quanto serve a portarla (Réglages → «Délai de livraison»).
  const consegna = url.searchParams.get("service") === "delivery";

  if (url.searchParams.get("days")) {
    return json(await giorniOrdinabili(ambito, consegna));
  }

  // ⚠️ Un giorno fuori dalla finestra non si propone: il checkout lo
  // rifiuterebbe, e il cliente avrebbe scelto un orario che non esiste.
  const data = url.searchParams.get("date");
  if (!(await giornoAmmesso(data, ambito))) return json({ error: "err.date" }, 400);
  const r = await slotsDelGiorno(data, ambito, consegna);
  return "errore" in r ? json({ error: r.errore }, 503) : json(r);
};
