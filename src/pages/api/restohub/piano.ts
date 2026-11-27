import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { rifiutaSenzaChiave } from "../../../lib/chiaveRestohub";
import { pianoAllineamento } from "../../../lib/pianoRestohub";

export const prerender = false;

// GET /api/restohub/piano — cosa admin.restohub.cloud deve applicare sul
// Supabase di questo cliente: migrazioni del codice, estensioni, job pg_cron
// (27/11/2026). Solo con la chiave dell'admin. Vedi `lib/pianoRestohub.ts`:
// il token di Supabase resta nell'admin, qui escono solo le cose del cliente.
export const GET: APIRoute = async ({ request }) => {
  const no = rifiutaSenzaChiave(request);
  if (no) return no;
  try {
    return json(pianoAllineamento());
  } catch {
    return json({ errore: "interno" }, 500);
  }
};
