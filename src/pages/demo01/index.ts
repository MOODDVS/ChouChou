import type { APIRoute } from "astro";
import html from "./_page.html?raw";

// TEMPLATE demo01 — landing page "pizzeria" (ristorante fittizio Bella Napoli),
// servita a /demo01. Vetrina commerciale del motore RestoHub: mostra dal vivo
// prenotazione (widget reale), ordine + coupon, popup, menu e mock admin, con
// selettore lingua FR/IT/EN.
//
// Ogni template vive in una sua cartella src/pages/demoNN/ :
//   index.ts               -> la rotta /demoNN
//   _page.html             -> l'HTML del template (il prefisso "_" evita che
//                             Astro lo tratti come rotta; "?raw" lo incorpora)
//   reservation-embed.astro-> /demoNN/reservation-embed (widget del template)
// Per un nuovo template basta duplicare la cartella e rinominarla.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
