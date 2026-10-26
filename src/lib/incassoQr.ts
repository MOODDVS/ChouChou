/**
 * L'INCASSO COL QR, lato webhook (26/10/2026): gli ordini di un tavolo pagati
 * dal telefono del cliente (`creaCheckoutIncasso`).
 *
 * ⚠️ NON passa da `confermaOrdinePagato`: quella ANNUNCIA l'ordine (email al
 * cliente e alla cucina, notifica, ticket). Questi ordini sono gia' stati
 * annunciati quando il cameriere li ha presi: qui il denaro arriva e basta.
 * ⚠️ Solo cio' che e' ancora DA INCASSARE (`pending` + `onsite`): un webhook
 * consegnato due volte, o un tavolo incassato in contanti nel frattempo, non
 * si tocca. Gia' pronto (#89 `ready_at`) = chiuso (`done`), come l'incasso al
 * banco; il metodo e' `link` (pagato con un link Stripe).
 */
import { aggiorna, type Ambito } from "./admin/sede";
import { chiudiSeContoChiesto } from "./admin/incassoSeduta";

const RE_ID = /^[0-9a-f-]{36}$/i;

export async function incassaOrdiniQr(ambito: Ambito, idsGrezzi: string, sessionId: string, chiudiSeduta?: string): Promise<number> {
  const ids = String(idsGrezzi ?? "").split(",").map((x) => x.trim()).filter((x) => RE_ID.test(x));
  if (!ids.length) return 0;
  const base = { payment_method: "link", stripe_session_id: sessionId };
  let fatti = 0;
  // Prima quelli gia' pronti: si chiudono. Senza la #89 la colonna non c'e'.
  const pronti = await aggiorna("orders", ambito, { ...base, status: "done" })
    .in("id", ids).eq("status", "pending").eq("payment_method", "onsite").not("ready_at", "is", null)
    .select("id, reservation_id");
  if (!pronti.error) fatti += (pronti.data ?? []).length;
  const resto = await aggiorna("orders", ambito, { ...base, status: "paid" })
    .in("id", ids).eq("status", "pending").eq("payment_method", "onsite")
    .select("id, reservation_id");
  if (resto.error) throw resto.error;
  fatti += (resto.data ?? []).length;
  /* Il tavolo si libera (26/10/2026): col QR del palmare sempre; col QR della
     cassa se il conto era stato chiesto («Paiement en caisse»). */
  const toccati = [...(pronti.error ? [] : (pronti.data ?? [])), ...(resto.data ?? [])] as unknown as { reservation_id: string | null }[];
  const sedute = new Set(toccati.map((o) => String(o.reservation_id ?? "")).filter(Boolean));
  if (chiudiSeduta) sedute.add(chiudiSeduta);
  for (const id of sedute) {
    try { await chiudiSeContoChiesto(ambito, id, id === chiudiSeduta); } catch (e) { console.error("[incasso QR] seduta:", e); }
  }
  return fatti;
}
