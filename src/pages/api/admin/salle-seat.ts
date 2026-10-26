import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
import { installaClienti, annullaInstallazione, spostaTavoli, cambiaPersone, estendiTavolo } from "../../../lib/admin/installaTavolo";
import { chiediContoInCassa, incassaSeduta, qrSeduta, sedutaPagata } from "../../../lib/admin/incassoSeduta";
import { pagamentoOnlineAttivo } from "../../../lib/admin/sede";
import { indirizzoPubblico } from "../../../lib/indirizzoPubblico";
import { linguaPalmare } from "../../../lib/admin/linguaPalmare";
import { adminT } from "../../../i18n/admin";

/**
 * INSTALLARE DEI CLIENTI A UN TAVOLO — la prima API del palmare (23/10/2026).
 *
 * POST { tables: [id…], people } → { ok: true, id }
 *   409 «occupato»: un collega ha seduto qualcuno nel frattempo.
 * POST { azione: "annulla", table } → { ok: true }   (23/10/2026)
 *   I clienti seduti senza aver ordinato se ne vanno: i tavoli si liberano.
 *   409 se nel frattempo c'e' un ordine o un conto.
 * POST { azione: "sposta", table, tables: [id…], people? } → { ok: true }   (23/10/2026)
 *   La tavolata seduta a `table` va sui tavoli `tables` (cambiare tavolo,
 *   aggiungerne, liberarne). 409 se un collega ne ha preso uno.
 * POST { azione: "persone", table, people } → { ok: true }   (23/10/2026)
 * POST { azione: "estendi", table, minuti: 15|30|45, forza? } → { ok, fine }
 *   (23/10/2026) piu' tempo al tavolo; 409 { conflitto } se una prenotazione
 *   sugli stessi tavoli inizia nei minuti aggiunti (si conferma con forza).
 * POST { azione: "cassa", table } → { ok, stampa }   (26/10/2026)
 *   «Paiement en caisse»: l'addizione sulla principale + richiesta d'addizione
 *   (notifica, tavolo blu finche' qualcuno non incassa).
 * POST { azione: "incassa", table, metodo: cash|card } → { ok, totale }
 *   Tutto pagato e la seduta chiusa: il tavolo torna libero.
 * POST { azione: "qr", table } → { ok, svg, totale }  il QR Stripe del tavolo
 * POST { azione: "qr-stato", table } → { pagato }       il palmare guarda
 *   (`lib/admin/incassoSeduta.ts`)
 *
 * ⚠️ E' in `API_PALMARE` (permessiRegole): l'UNICA cosa che il palmare puo'
 * chiamare. Per gli altri ruoli vale la pagina «reservations».
 * Le regole stanno in `lib/admin/installaTavolo.ts`.
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
  let body: { tables?: unknown; people?: unknown; azione?: unknown; table?: unknown; minuti?: unknown; forza?: unknown; metodo?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const t = adminT(await linguaPalmare(request));
  if (body.azione === "annulla") {
    const a = await annullaInstallazione(ambito, String(body.table ?? ""));
    if (a.ok) return json({ ok: true });
    if (a.errore === "ordini") return json({ error: t("sal.seat.cancelHasOrders") }, 409);
    if (a.errore === "nessuno") return json({ error: t("sal.seat.cancelNone") }, 404);
    return json({ error: t("sal.seat.error") }, 500);
  }
  if (body.azione === "sposta") {
    const m = await spostaTavoli(ambito, String(body.table ?? ""), body.tables, body.people);
    if (m.ok) return json({ ok: true });
    if (m.errore === "occupato") return json({ error: t("sal.seat.taken") }, 409);
    if (m.errore === "nessuno") return json({ error: t("sal.seat.cancelNone") }, 404);
    if (m.errore === "tavoli") return json({ error: t("sal.seat.badTables") }, 400);
    return json({ error: t("sal.mv.error") }, 500);
  }
  if (body.azione === "estendi") {
    const e = await estendiTavolo(ambito, String(body.table ?? ""), body.minuti, body.forza === true);
    if (e.ok) return json({ ok: true, fine: e.fine });
    if (e.errore === "conflitto") {
      return json({
        conflitto: true,
        error: t("sal.ext.conflict").replace("{nom}", e.nome || "—").replace("{h}", e.heure).replace("{t}", e.tavoli.join(" + ")),
      }, 409);
    }
    if (e.errore === "nessuno") return json({ error: t("sal.seat.cancelNone") }, 404);
    return json({ error: t("sal.mv.error") }, e.errore === "minuti" ? 400 : 500);
  }
  if (body.azione === "cassa") {
    const c = await chiediContoInCassa(ambito, String(body.table ?? ""));
    if (c.ok) return json({ ok: true, stampa: c.stampa, message: t(c.stampa ? "sal.pay.deskOk" : "sal.pay.deskNoPrint") });
    if (c.errore === "conto") return json({ error: t("sal.tb.freeTab") }, 409);
    if (c.errore === "vuoto") return json({ error: t("sal.pay.nothing") }, 409);
    return json({ error: t("sal.seat.cancelNone") }, 404);
  }
  if (body.azione === "incassa") {
    const c = await incassaSeduta(ambito, String(body.table ?? ""), body.metodo);
    if (c.ok) return json({ ok: true, totale: c.totale });
    if (c.errore === "conto") return json({ error: t("sal.tb.freeTab") }, 409);
    if (c.errore === "nessuno") return json({ error: t("sal.seat.cancelNone") }, 404);
    return json({ error: t("err.generalSave") }, 500);
  }
  if (body.azione === "qr") {
    if (!(await pagamentoOnlineAttivo(ambito))) return json({ error: t("err.qrOff") }, 409);
    const base = indirizzoPubblico(request);
    if (!base) return json({ error: t("err.qrOff") }, 500);
    const q = await qrSeduta(ambito, String(body.table ?? ""), base);
    if (q.ok) return json({ ok: true, svg: q.svg, totale: q.totale });
    if (q.errore === "conto") return json({ error: t("sal.tb.freeTab") }, 409);
    if (q.errore === "vuoto") return json({ error: t("sal.pay.nothing") }, 409);
    if (q.errore === "stripe") return json({ error: t("err.qrStripe") }, 502);
    return json({ error: t("sal.seat.cancelNone") }, 404);
  }
  if (body.azione === "qr-stato") {
    return json({ pagato: await sedutaPagata(ambito, String(body.table ?? "")) });
  }
  if (body.azione === "persone") {
    const n = await cambiaPersone(ambito, String(body.table ?? ""), body.people);
    if (n.ok) return json({ ok: true });
    if (n.errore === "nessuno") return json({ error: t("sal.seat.cancelNone") }, 404);
    if (n.errore === "numero") return json({ error: t("sal.mv.error") }, 400);
    return json({ error: t("err.generalSave") }, 500);
  }
  const esito = await installaClienti(ambito, body.tables, body.people);
  if (esito.ok) return json({ ok: true, id: esito.id });
  if (esito.errore === "occupato") return json({ error: t("sal.seat.taken") }, 409);
  if (esito.errore === "tavoli") return json({ error: t("sal.seat.badTables") }, 400);
  return json({ error: t("err.generalSave") }, 500);
};
