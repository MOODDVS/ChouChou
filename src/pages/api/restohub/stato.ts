import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { statoRestohub } from "../../../lib/statoRestohub";
import { rifiutaSenzaChiave } from "../../../lib/chiaveRestohub";

export const prerender = false;

// GET /api/restohub/stato — il riassunto per la scheda del cliente in
// admin.restohub.cloud (19/11/2026). Solo con la chiave condivisa
// `RESTOHUB_STATO_KEY`, nell'header `x-restohub-key` (mai nell'indirizzo:
// finirebbe nei log di Caddy e di Hostinger). Senza la variabile risponde
// 503 e basta: il resto del sito non ne dipende.
//
// ⚠️ In uscita solo numeri, date e nomi tecnici: niente segreti, niente
// dati dei clienti del ristorante. Vedi `lib/statoRestohub.ts`.

export const GET: APIRoute = async ({ request }) => {
  const no = rifiutaSenzaChiave(request);
  if (no) return no;
  try {
    return json(await statoRestohub());
  } catch {
    return json({ errore: "interno" }, 500);
  }
};
