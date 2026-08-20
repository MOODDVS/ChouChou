import type { APIRoute } from "astro";
import { popupPerPagina } from "../../lib/popups";

export const prerender = false;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}

// GET /api/popup?page=home&lang=fr|en — pubblico. Pop-up marketing attivo
// ADESSO per la pagina (default "home"), gestito dall'admin (Marketing -> Pop-up):
// titolo, testo, immagine, bottoni, max_shows. Il limite di visualizzazioni per
// visitatore e' applicato lato client (localStorage), come in SitePopup.astro.
// Risposta: { active:false } oppure { active:true, popup:{...} }.
export const GET: APIRoute = async ({ url }) => {
  const lang = url.searchParams.get("lang") === "en" ? "en" : "fr";
  const page = (url.searchParams.get("page") || "home").trim() || "home";
  try {
    const p = await popupPerPagina(page, lang);
    return json(p ? { active: true, popup: p } : { active: false });
  } catch {
    return json({ active: false });
  }
};
