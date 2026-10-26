import type { APIRoute } from "astro";
import { popupPerPagina } from "../../lib/popups";
import { languages, defaultLang } from "../../i18n/ui";

export const prerender = false;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}

// GET /api/popup?page=home&lang=<lingua del sito> — pubblico. Pop-up marketing attivo
// ADESSO per la pagina (default "home"), gestito dall'admin (Marketing -> Pop-up):
// titolo, testo, immagine, bottoni, max_shows. Il limite di visualizzazioni per
// visitatore e' applicato lato client (localStorage), come in SitePopup.astro.
// Risposta: { active:false } oppure { active:true, popup:{...} }.
export const GET: APIRoute = async ({ url }) => {
  // ⚠️ Una delle lingue del sito, altrimenti quella di base (non il francese).
  const chiesta = String(url.searchParams.get("lang") ?? "");
  const lang = Object.hasOwn(languages, chiesta) ? chiesta : defaultLang;
  const page = (url.searchParams.get("page") || "home").trim() || "home";
  try {
    const p = await popupPerPagina(page, lang);
    return json(p ? { active: true, popup: p } : { active: false });
  } catch {
    return json({ active: false });
  }
};
