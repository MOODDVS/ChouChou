import type { APIRoute } from "astro";
import { getAgendaTous, slugifyTitre } from "../lib/agenda";

export const prerender = false;

const SITE = (process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "https://www.comptoirchouchou.be").replace(/\/$/, "");

// Pagine pubbliche indicizzabili (FR); l'EN è /en + path. Escluse: feedback,
// order, links, reservation-embed, annulla-token (noindex / robots).
const PATHS = ["", "/menu", "/epicerie", "/contact", "/agenda", "/reservation", "/privacy", "/cookies"];

export const GET: APIRoute = async () => {
  let slugs: string[] = [];
  try {
    const events = await getAgendaTous(500);
    slugs = events.map((e) => "/agenda/" + slugifyTitre(e.title));
  } catch {
    slugs = [];
  }
  const bases = [...PATHS, ...slugs];

  const blocchi = bases
    .map((fr) => {
      const frLoc = SITE + (fr === "" ? "/" : fr);
      const enLoc = SITE + "/en" + fr; // "/en" per la home, "/en/menu", ...
      const alt =
        `\n    <xhtml:link rel="alternate" hreflang="fr-be" href="${frLoc}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="en" href="${enLoc}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${frLoc}"/>`;
      return (
        `  <url>\n    <loc>${frLoc}</loc>${alt}\n  </url>\n` +
        `  <url>\n    <loc>${enLoc}</loc>${alt}\n  </url>`
      );
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${blocchi}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
    },
  });
};
