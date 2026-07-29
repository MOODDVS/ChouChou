import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { googleConfigurato, creaState, urlConsenso, scollega } from "../../../lib/googleBusiness";

export const prerender = false;

// Avvio del collegamento Google Business (super admin).
// POST   → ritorna l'URL della schermata di consenso (il browser ci va da solo)
// DELETE → scollega (cancella il refresh token del cliente)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: "Réservé au super admin" }, 403);
  if (!googleConfigurato()) return json({ error: "GOOGLE_CLIENT_ID/SECRET manquants" }, 500);

  return json({ ok: true, url: urlConsenso(creaState()) });
};

export const DELETE: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: "Réservé au super admin" }, 403);
  await scollega();
  return json({ ok: true });
};
