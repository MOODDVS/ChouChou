import type { APIRoute } from "astro";
import { slotsDelMese, slotsDelGiorno } from "../../lib/slotsApi";
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

  const r = await slotsDelGiorno(url.searchParams.get("date"), ambito);
  return "errore" in r ? json({ error: r.errore }, 503) : json(r);
};
