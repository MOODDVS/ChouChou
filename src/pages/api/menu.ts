import type { APIRoute } from "astro";
import { getMenuOrderable } from "../../lib/db";

export const prerender = false;

// GET /api/menu — menu ORDINABILE pubblico (categorie + piatti), in JSON.
// Stessa fonte del sito d'ordine (getMenuOrderable): serve ai front-end demo
// e ai siti pubblici per costruire la griglia menu lato client. Nessun dato
// sensibile: il menu e' gia' pubblico sulla pagina /order.
export const GET: APIRoute = async () => {
  try {
    const menu = await getMenuOrderable();
    return new Response(JSON.stringify({ menu }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=30",
      },
    });
  } catch {
    return new Response(JSON.stringify({ menu: [], error: "menu indisponible" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
