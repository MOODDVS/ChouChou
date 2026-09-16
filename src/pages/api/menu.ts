import type { APIRoute } from "astro";
import { getMenuOrderable } from "../../lib/db";
// Multi-sede: quale punto sta guardando il sito (segnaposto, pezzo 8).
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";

export const prerender = false;

// GET /api/menu — menu ORDINABILE pubblico (categorie + piatti), in JSON.
// Stessa fonte del sito d'ordine (getMenuOrderable): serve ai front-end demo
// e ai siti pubblici per costruire la griglia menu lato client. Nessun dato
// sensibile: il menu e' gia' pubblico sulla pagina /order.
export const GET: APIRoute = async ({ request }) => {
  try {
    const menu = await getMenuOrderable(await ambitoPubblicoChiesto(request));
    return new Response(JSON.stringify({ menu }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // ⚠️ `private`, non `public`: dal pezzo 8 questa risposta dipende dal
        // punto vendita, e una cache condivisa servirebbe il menu di Stockel a
        // chi guarda Jourdan. E 15 s, non 30: l'esaurito e' uno stato che
        // cambia in cucina e deve arrivare in vetrina mentre il cliente guarda.
        "cache-control": "private, max-age=15",
      },
    });
  } catch {
    return new Response(JSON.stringify({ menu: [], error: "menu indisponible" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
