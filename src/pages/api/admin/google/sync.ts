import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { sincronizzaRecensioni } from "../../../../lib/googleBusiness";

export const prerender = false;

// POST /api/admin/google/sync — tira le recensioni da Google e aggiorna la
// cache. Chiamato da "Sincronizza ora". Puo' impiegare qualche secondo.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const r = await sincronizzaRecensioni();
  if (r.stato === "non_collegato") return json({ error: "Google non collegato" }, 400);
  if (r.stato === "scelta_richiesta") return json({ error: "Plusieurs fiches: choisis la bonne", needChoice: true }, 409);
  if (r.stato === "nessuna_scheda") return json({ error: "Aucune fiche Google trouvée pour ce compte" }, 400);
  return json({
    ok: true,
    location: r.location,
    synced: r.synced,
    rating: r.average,
    count: r.total,
    reviewError: r.reviewError ?? "",
  });
};
