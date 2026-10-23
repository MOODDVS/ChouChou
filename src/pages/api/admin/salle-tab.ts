import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
import { contiApertiDellaSala, validaConto, rifiutaConto } from "../../../lib/admin/contiSala";
import { tavoloDellaRiga } from "../../../lib/admin/schedaTavoloRegole";
import { linguaPalmare } from "../../../lib/admin/linguaPalmare";
import { adminT } from "../../../i18n/admin";

/**
 * VALIDARE O RIFIUTARE UN CONTO DAL PALMARE (23/10/2026).
 *
 * POST { table, azione: "valida" | "rifiuta" } → { ok }
 *
 * ⚠️ Non l'API del tablet (`table-tabs`): quella incassa, chiude e legge
 * tutti i conti. Il palmare sa fare SOLO queste due cose, con la STESSA
 * decisione del tablet (`validaConto` / `rifiutaConto` in contiSala).
 * Si indica il TAVOLO, non il conto: il palmare guarda un tavolo.
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
  let body: { table?: unknown; azione?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const t = adminT(await linguaPalmare(request));
  const tavolo = String(body.table ?? "");
  const conto = (await contiApertiDellaSala(ambito)).find((c) => tavoloDellaRiga(c, tavolo));
  if (!conto) return json({ error: t("err.tabNotFound") }, 404);
  if (body.azione === "valida") {
    return (await validaConto(ambito, conto)) === "ok" ? json({ ok: true }) : json({ error: t("sal.ord.err.save") }, 500);
  }
  if (body.azione === "rifiuta") {
    const esito = await rifiutaConto(ambito, conto);
    if (esito === "ok") return json({ ok: true });
    return json({ error: t(esito === "non_valido" ? "err.tabNotFound" : "sal.ord.err.save") }, esito === "non_valido" ? 409 : 500);
  }
  return json({ error: "requete invalide" }, 400);
};
