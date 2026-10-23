import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi } from "../../../lib/admin/sede";
import { ordinaDalPalmare, modificaOrdine } from "../../../lib/admin/ordineCameriere";
import { linguaPalmare } from "../../../lib/admin/linguaPalmare";
import { adminT } from "../../../i18n/admin";

/**
 * L'ORDINE DEL CAMERIERE — API del palmare (23/10/2026).
 *
 * POST { table, items: [{ id, qty, variant?, note? }] } → { ok, id }
 * POST { azione: "togli", table, order, qty: { indice: quantita' } } → { ok, annullato }
 *   (23/10/2026) modificare un ordine gia' fatto e ancora da incassare: cio'
 *   che scende si toglie, cio' che sale parte come ordine nuovo (ticket).
 *   Regole in `modificaOrdineRegole.ts`.
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
  let body: { table?: unknown; items?: unknown; azione?: unknown; order?: unknown; qty?: unknown };
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

  if (body.azione === "togli") {
    const tt = adminT(await linguaPalmare(request));
    const m = await modificaOrdine({
      ambito, tavoloId: String(body.table ?? ""), ordineId: String(body.order ?? ""), nuove: body.qty,
      cameriere, cameriereId: staff.employee_id ?? null,
    });
    if (m.ok) return json({ ok: true, annullato: m.annullato });
    if (m.errore === "aggiunta") {
      const e = m.dettaglio.ok ? "salvataggio" : m.dettaglio.errore;
      return json({ error: tt(e === "piatto" || e === "formato" ? "sal.ord.err.dish" : e === "valida_prima" ? "sal.ord.err.validate" : "sal.ed.error") }, 409);
    }
    if (m.errore === "bloccato") return json({ error: tt("sal.ed.locked") }, 409);
    if (m.errore === "nessuno") return json({ error: tt("sal.tb.notFound") }, 404);
    if (m.errore === "righe") return json({ error: tt("sal.ed.error") }, 400);
    return json({ error: tt("sal.ed.error") }, 500);
  }
  const t = adminT(await linguaPalmare(request));
  const esito = await ordinaDalPalmare({
    ambito, tavoloId: String(body.table ?? ""), righe: body.items, cameriere,
    cameriereId: staff.employee_id ?? null,
  });
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
