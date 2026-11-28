import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi } from "../../../lib/admin/sede";
import { creaAsporto } from "../../../lib/admin/asportoPalmare";
import { linguaPalmare } from "../../../lib/admin/linguaPalmare";
import { adminT } from "../../../i18n/admin";

/**
 * L'ASPORTO DAL PALMARE — API (28/11/2026).
 *
 * POST { items: [{ id, qty, variant?, note?, extra? }], nome, telefono?,
 *        orario: "HH:mm", pagamento: "onsite" | "cash" | "card" } → { ok, id }
 *
 * Le regole in `lib/admin/asportoPalmare.ts`. In `API_PALMARE`; per gli altri
 * ruoli vale la pagina «orders».
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
  const t = adminT(await linguaPalmare(request));
  let body: { items?: unknown; nome?: unknown; telefono?: unknown; orario?: unknown; pagamento?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: t("err.request") }, 400);
  }
  // Chi l'ha preso: il dipendente del Team, o il nome dell'utente.
  let cameriere = "";
  if (staff.employee_id) {
    const { data } = await leggi("team", ambito, "name").eq("id", staff.employee_id).maybeSingle();
    cameriere = String((data as { name?: string } | null)?.name ?? "").trim().split(/\s+/)[0] ?? "";
  }
  if (!cameriere) cameriere = String(staff.nome ?? "").trim();

  const esito = await creaAsporto({
    ambito, righe: body.items, nome: body.nome, telefono: body.telefono,
    orario: body.orario, pagamento: body.pagamento,
    cameriere, cameriereId: staff.employee_id ?? null,
  });
  if (esito.ok) return json({ ok: true, id: esito.id });
  const MESSAGGI: Record<string, [string, number]> = {
    vuoto: ["sal.ord.err.empty", 400],
    nome: ["sal.ta.err.name", 400],
    orario: ["sal.ta.err.time", 409],
    piatto: ["sal.ord.err.dish", 409],
    formato: ["sal.ord.err.dish", 409],
    menu: ["sal.ord.err.save", 503],
    salvataggio: ["sal.ord.err.save", 500],
  };
  const [chiave, stato] = MESSAGGI[esito.errore] ?? ["sal.ord.err.save", 500];
  return json({ error: t(chiave) }, stato);
};
