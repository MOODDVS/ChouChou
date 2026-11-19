import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { segretoUguale } from "../../../lib/cronAuth";
import { statoRestohub } from "../../../lib/statoRestohub";
import { HEADER_CHIAVE } from "../../../lib/statoRestohubRegole";

export const prerender = false;

// GET /api/restohub/stato — il riassunto per la scheda del cliente in
// admin.restohub.cloud (19/11/2026). Solo con la chiave condivisa
// `RESTOHUB_STATO_KEY`, nell'header `x-restohub-key` (mai nell'indirizzo:
// finirebbe nei log di Caddy e di Hostinger). Senza la variabile risponde
// 503 e basta: il resto del sito non ne dipende.
//
// ⚠️ In uscita solo numeri, date e nomi tecnici: niente segreti, niente
// dati dei clienti del ristorante. Vedi `lib/statoRestohub.ts`.

function chiaveAttesa(): string {
  const v = process.env.RESTOHUB_STATO_KEY ?? (import.meta.env as Record<string, unknown>).RESTOHUB_STATO_KEY;
  return String(v ?? "").trim();
}

export const GET: APIRoute = async ({ request }) => {
  const attesa = chiaveAttesa();
  if (!attesa) return json({ errore: "non configurato" }, 503);
  if (!segretoUguale(request.headers.get(HEADER_CHIAVE) ?? "", attesa)) return json({ errore: "non autorizzato" }, 401);
  try {
    return json(await statoRestohub());
  } catch {
    return json({ errore: "interno" }, 500);
  }
};
