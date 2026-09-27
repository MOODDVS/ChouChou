import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { sincronizzaRecensioni, erroreGoogle } from "../../../../lib/googleBusiness";
import { adminLang } from "../../../../lib/admin/adminLang";
import { adminT } from "../../../../i18n/admin";
import { ambitoDiRichiesta } from "../../../../lib/admin/sede";

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

  // Sincronizzazione a mano dalla pagina Google: il punto e' quello scelto
  // nell'header, non tutti.
  const r = await sincronizzaRecensioni(await ambitoDiRichiesta(request, staff));
  if (r.stato === "non_collegato") return json({ error: await erroreGoogle(r.motivo ?? "mai") }, 400);
  const t = adminT(await adminLang());
  if (r.stato === "scelta_richiesta") return json({ error: t("gg.err.scelta"), needChoice: true }, 409);
  if (r.stato === "nessuna_scheda") return json({ error: t("gg.err.nessuna") }, 400);
  return json({
    ok: true,
    location: r.location,
    synced: r.synced,
    rating: r.average,
    count: r.total,
    reviewError: r.reviewError ?? "",
    // ⚠️ Separato dalle recensioni apposta: una scheda che Google rifiuta
    // lascia il pannello business vuoto ma il sync riesce lo stesso. Senza
    // questo, il punto con il pannello vuoto non aveva niente da dire.
    schedaError: r.schedaError ?? "",
  });
};
