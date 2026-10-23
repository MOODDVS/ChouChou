import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi } from "../../../lib/admin/sede";
import { ordinaDalPalmare } from "../../../lib/admin/ordineCameriere";
import { linguaPalmare } from "../../../lib/admin/linguaPalmare";
import { adminT } from "../../../i18n/admin";

/**
 * L'ORDINE DEL CAMERIERE — API del palmare (23/10/2026).
 *
 * POST { table, items: [{ id, qty, variant?, note? }] } → { ok, id }
 * Le regole in `lib/admin/ordineCameriere.ts`. In `API_PALMARE`; per gli
 * altri ruoli vale la pagina «orders».
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  let body: { table?: unknown; items?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  // Chi ha preso l'ordine: il dipendente del Team, o il nome dell'utente.
  let cameriere = "";
  if (staff.employee_id) {
    const { data } = await leggi("team", ambito, "name").eq("id", staff.employee_id).maybeSingle();
    cameriere = String((data as { name?: string } | null)?.name ?? "").trim().split(/\s+/)[0] ?? "";
  }
  if (!cameriere) cameriere = String(staff.nome ?? "").trim();

  const t = adminT(await linguaPalmare(request));
  const esito = await ordinaDalPalmare({ ambito, tavoloId: String(body.table ?? ""), righe: body.items, cameriere });
  if (esito.ok) return json({ ok: true, id: esito.id });
  const MESSAGGI: Record<string, [string, number]> = {
    vuoto: ["sal.ord.err.empty", 400],
    libero: ["sal.ord.err.free", 409],
    valida_prima: ["sal.ord.err.validate", 409],
    piatto: ["sal.ord.err.dish", 409],
    formato: ["sal.ord.err.dish", 409],
    menu: ["sal.ord.err.save", 503],
    salvataggio: ["sal.ord.err.save", 500],
  };
  const [chiave, stato] = MESSAGGI[esito.errore] ?? ["sal.ord.err.save", 500];
  return json({ error: t(chiave) }, stato);
};
