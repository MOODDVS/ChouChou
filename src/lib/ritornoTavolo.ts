/**
 * IL RITORNO SULLA PAGINA DEL TAVOLO dopo l'ordine — la lettura.
 *
 * L'ordine si ritrova col suo `cancel_token` (`?order=`), non con la sede:
 * chi torna da Stripe non dice da quale punto ha ordinato, e il token — un
 * uuid che conosce solo chi ha ordinato — E' l'autorizzazione. Stesso motivo
 * di `order-cancel` (vedi `tests/sede.test.mjs`, AMMESSI_AGGREGATO).
 *
 * ⚠️ STRIPE E' PIU' LENTO DEL CLIENTE. Il browser torna dal pagamento prima
 * che il webhook abbia messo l'ordine a `paid`: la pagina direbbe «en cours
 * de vérification» a chi ha appena pagato. Se la sessione e' QUELLA
 * dell'ordine e Stripe dice `paid`, lo si conferma da qui — con la stessa
 * funzione idempotente del webhook (`confermaOrdinePagato`): chi arriva
 * secondo non fa niente.
 */
import { leggi, tutteLeSedi, ambitoDiRiga, pagamentoOnlineAttivo } from "./admin/sede";
import { stripeDi } from "./stripe";
import { confermaOrdinePagato } from "./confermaOrdine";
import { idSessioneStripe } from "./esitoTavoloRegole";

export interface OrdineTavolo {
  id: string;
  status: string;
  payment_method: string | null;
  customer_name: string | null;
  customer_email: string | null;
  table_label: string | null;
  items: { name: string; qty: number; price_cents: number; notes?: string }[] | null;
  total_cents: number;
  stripe_session_id: string | null;
  location_id: string | null;
}

const CAMPI =
  "id, status, payment_method, customer_name, customer_email, table_label, items, total_cents, stripe_session_id, location_id";

/** Un token che ha la forma di un uuid: il resto non arriva al database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rileggi(token: string): Promise<OrdineTavolo | null> {
  const { data, error } = await leggi("orders", tutteLeSedi(), CAMPI)
    .eq("cancel_token", token)
    .maybeSingle();
  if (error) {
    console.error("[ritorno tavolo] lettura ordine fallita:", error);
    return null;
  }
  return (data as unknown as OrdineTavolo | null) ?? null;
}

export async function ordineDelRitorno(token: string, sessionId: string): Promise<OrdineTavolo | null> {
  const t = token.trim();
  if (!UUID.test(t)) return null;
  const ordine = await rileggi(t);
  if (!ordine || ordine.status !== "pending" || ordine.payment_method === "onsite") return ordine;

  // ⚠️ Solo la sessione di QUESTO ordine: un `session_id` qualunque
  // nell'indirizzo non deve poter confermare niente.
  const sid = sessionId.trim();
  if (!sid.startsWith("cs_") || idSessioneStripe(ordine.stripe_session_id) !== sid) return ordine;
  try {
    const suo = ambitoDiRiga(ordine.location_id);
    if (!(await pagamentoOnlineAttivo(suo))) return ordine;
    const sess = await (await stripeDi(suo)).checkout.sessions.retrieve(sid);
    if (sess.payment_status !== "paid") return ordine;
    await confermaOrdinePagato({ orderId: ordine.id, ambito: suo, sessionId: sid });
    return (await rileggi(t)) ?? ordine;
  } catch (e) {
    // Non e' grave: ci pensa il webhook, e la pagina si ricarica da sola.
    console.error("[ritorno tavolo] verifica Stripe fallita:", e);
    return ordine;
  }
}
