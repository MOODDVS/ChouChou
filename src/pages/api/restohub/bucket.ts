import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { rifiutaSenzaChiave } from "../../../lib/chiaveRestohub";
import { applicaPasso } from "../../../lib/admin/supabaseStato";

export const prerender = false;

// POST /api/restohub/bucket — crea (o rimette pubblici/privati) gli spazi di
// archivio del motore. Lo chiede admin.restohub.cloud quando allinea un
// cliente (27/11/2026). Gli spazi si fanno con la service key, che sta qui:
// non serve nessun token. Rilanciabile: cio' che c'e' gia' non si tocca.
export const POST: APIRoute = async ({ request }) => {
  const no = rifiutaSenzaChiave(request);
  if (no) return no;
  try {
    const r = await applicaPasso("bucket");
    return json(r.ok ? { ok: true, fatte: r.fatte } : { ok: false, errore: r.errore, messaggio: r.messaggio ?? "" }, r.ok ? 200 : 502);
  } catch {
    return json({ ok: false, errore: "interno" }, 500);
  }
};
