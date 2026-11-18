/**
 * I LINK DEL SITO PUBBLICO per la libreria del pannello (ImagePicker in modo
 * «link», tab «Pages du site», 18/11/2026): chi crea un pop-up o un evento
 * sceglie la pagina invece di copiare l'indirizzo dalla barra del browser.
 *
 * Le pagine del menu (`config/sitePages.ts`, nella lingua di base: il sito
 * ci mette poi la lingua della pagina) e i link in piu' del cliente
 * (`config/linkSito.ts`: eventi, prodotti…). Le etichette standard viaggiano
 * come chiave (`labelKey`): le traduce il pannello nella sua lingua.
 */
import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
import { SITE_PAGES } from "../../../config/sitePages";
import { linkExtraSito, type LinkSito } from "../../../config/linkSito";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let extra: LinkSito[] = [];
  try {
    extra = await linkExtraSito(await ambitoDiRichiesta(request, staff));
  } catch {
    extra = [];
  }
  return json({
    pagine: SITE_PAGES.map((p) => ({ k: p.k, url: p.path || "/", label: p.label ?? null, labelKey: p.labelKey ?? null })),
    extra,
  });
};
