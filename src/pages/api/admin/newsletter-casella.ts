import type { APIRoute } from "astro";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { statoNewsletter } from "../../../lib/admin/newsletterCasella";

export const prerender = false;

// Super admin → Intégrations → casella Newsletter (5/11/2026). SOLO super.
// GET → quota del mese (incluse + crediti), Resend, mittente e dominio,
// ultimo invio, invii programmati. La quota si salva come prima
// (PUT /api/admin/integrations { newsletter_quota }).

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json(await statoNewsletter());
};
