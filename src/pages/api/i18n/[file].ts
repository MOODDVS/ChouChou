import type { APIRoute } from "astro";
import { fileDizionario } from "../../../lib/admin/dizionarioBrowser";
import { isAdminLang } from "../../../i18n/admin";

export const prerender = false;

// GET /api/i18n/admin-<lingua>.<impronta>.js — le stringhe dell'admin in UNA
// lingua, per il browser (audit 12/11/2026, vedi `i18n/adminClient.ts`).
// Pubblico: sono le etichette dei bottoni, nessun dato. Con l'impronta giusta
// resta in cache un anno (il nome cambia quando cambia il testo); con
// un'impronta vecchia (una pagina aperta prima di un deploy) si rende il
// dizionario di adesso, senza cache: la pagina funziona lo stesso.
export const GET: APIRoute = ({ params }) => {
  const m = /^admin-([a-z]{2})\.([0-9a-f]{12})\.js$/.exec(String(params.file ?? ""));
  if (!m || !isAdminLang(m[1])) return new Response("", { status: 404 });
  const f = fileDizionario(m[1]);
  return new Response(f.corpo, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": f.impronta === m[2] ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
};
