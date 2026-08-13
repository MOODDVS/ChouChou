import type { APIRoute } from "astro";
import html from "./_demo.html?raw";

// Pagina demo commerciale del MOTORE (RestoHub), servita a /demo.
// È un HTML statico autonomo (ristorante fittizio "Maison Léa") con selettore
// lingua FR/IT/EN, prenotazione, ordine + coupon, popup promo e mock della
// dashboard admin. Serve a mostrare le funzioni del prodotto ai prospect.
//
// Perché un endpoint e non public/demo/index.html: Astro NON serve l'index di
// una sottocartella di public come URL pulito (/demo dà 404, funziona solo
// /demo/index.html). Qui invece la rotta /demo restituisce l'HTML verbatim,
// identico in locale e in produzione, e senza che Astro interpreti le graffe
// del JavaScript. Il file vive in src/pages/_demo.html: il prefisso "_" evita
// che Astro lo tratti come rotta, e l'import "?raw" lo incorpora come stringa.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // demo pubblica ma fuori dai motori di ricerca
      "x-robots-tag": "noindex, nofollow",
    },
  });
