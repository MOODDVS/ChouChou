import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, pagamentoOnlineAttivo } from "../../../lib/admin/sede";
import { creaCheckoutIncasso } from "../../../lib/stripe";
import { indirizzoPubblico } from "../../../lib/indirizzoPubblico";
import { qrSvg } from "../../../lib/qrSvg";
import { CLIENT } from "../../../config/client";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

/**
 * L'INCASSO COL QR (26/10/2026) — Commandes: oltre a contanti e carta, un QR
 * che il cliente inquadra col telefono per pagare online.
 *
 * POST { ids: [id…] } → { ok, url, svg, totale_cents }
 *   Gli ordini devono essere tutti DA INCASSARE (`pending` + `onsite`) e di
 *   questo punto. Il webhook li segna pagati (`lib/incassoQr.ts`).
 * ⚠️ Solo se il pagamento online e' configurato (chiave + firma del webhook):
 * senza la firma il webhook non arriverebbe, e il tavolo pagato resterebbe
 * «da incassare».
 * ⚠️ Il totale si rilegge QUI dal database: il prezzo non viaggia dal browser.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  const t = adminT(await adminLang());
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length || ids.length > 20) return json({ error: t("err.orderNotFound") }, 400);
  if (!(await pagamentoOnlineAttivo(ambito))) return json({ error: t("err.qrOff") }, 409);
  const { data, error } = await leggi("orders", ambito, "id, status, payment_method, total_cents, table_label").in("id", ids);
  if (error) return json({ error: t("err.update") }, 500);
  const righe = (data ?? []) as unknown as { id: string; status: string; payment_method: string | null; total_cents: number | null; table_label: string | null }[];
  if (righe.length !== ids.length || righe.some((o) => o.status !== "pending" || o.payment_method !== "onsite")) {
    return json({ error: t("err.qrNotDue") }, 409);
  }
  const totale = righe.reduce((n, o) => n + Math.max(0, Math.round(Number(o.total_cents) || 0)), 0);
  if (totale <= 0) return json({ error: t("err.qrNotDue") }, 409);
  const base = indirizzoPubblico(request);
  if (!base) return json({ error: t("err.qrOff") }, 500);
  const tavolo = righe.map((o) => String(o.table_label ?? "").trim()).find(Boolean) ?? "";
  try {
    const s = await creaCheckoutIncasso({
      ambito,
      ordini: righe.map((o) => o.id),
      nome: `${CLIENT.nome}${tavolo ? ` · ${tavolo}` : ""}`,
      totaleCents: totale,
      successUrl: `${base}/paiement/ok`,
      cancelUrl: `${base}/paiement/ok?annule=1`,
    });
    return json({ ok: true, url: s.url, svg: qrSvg(s.url), totale_cents: totale });
  } catch (e) {
    console.error("[qr-incasso] Stripe:", String((e as Error)?.message ?? e));
    return json({ error: t("err.qrStripe") }, 502);
  }
};
