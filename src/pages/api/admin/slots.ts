import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { slotsDelMese, slotsDelGiorno } from "../../../lib/slotsApi";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";

export const prerender = false;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Gli stessi slot di `/api/slots`, ma per la SEDE SCELTA NELL'HEADER.
//
// ⚠️ Esiste perche' il modale «nuovo ordine» dell'admin chiamava quello
// pubblico, agganciato al primo punto: il ristoratore di Jourdan si vedeva i
// turni di Stockel. Il calcolo e' lo stesso file, quindi le due porte non
// possono divergere.
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  const mese = url.searchParams.get("month");
  if (mese) {
    const r = await slotsDelMese(mese, ambito);
    return "errore" in r ? json({ error: r.errore }, 400) : json(r);
  }

  const r = await slotsDelGiorno(url.searchParams.get("date"), ambito);
  return "errore" in r ? json({ error: r.errore }, 503) : json(r);
};
