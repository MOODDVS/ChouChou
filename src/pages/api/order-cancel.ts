import type { APIRoute } from "astro";
// Multi-sede: qui l'AGGREGATO e' la risposta giusta (vedi sotto).
import { leggi, aggiorna, tutteLeSedi, cercaAmbito } from "../../lib/admin/sede";
import { stripeDi } from "../../lib/stripe";
import { PUBLIC_LANG_CODES } from "../../lib/admin/superAdmin";

// Annullamento PUBBLICO di un ordine manuale non ancora pagato.
// Identificato dal cancel_token (email "Annuler ma commande").
// Solo status 'pending': un ordine pagato non si annulla da qui (si chiama).

export const prerender = false;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET ?token= → riepilogo minimo per la pagina di conferma
export const GET: APIRoute = async ({ url }) => {
  // ⚠️ AGGREGATO, chiesto per nome. L'ordine si trova con il suo token di
  // annullo, che e' un segreto: il token E' l'autorizzazione. Filtrare per
  // sede non protegge niente in piu' e romperebbe l'annullo di ogni punto
  // che non sia il primo — il cliente clicca il link e non succede niente.
  const ambito = tutteLeSedi();
  const token = url.searchParams.get("token") ?? "";
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);
  const { data } = await leggi("orders", ambito, "status, pickup_time, total_cents, customer_name, lang")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!data) return json({ error: "invalid" }, 404);
  return json({
    status: data.status,
    pickup_time: data.pickup_time,
    total_cents: data.total_cents,
    customer_name: data.customer_name,
    // ⚠️ LA LINGUA VERA DELL'ORDINE, non due su cinque. Dalla #49 `orders.lang`
    // tiene fr/en/it/nl/es — il checkout salva la lingua della pagina in cui il
    // cliente ha ordinato — e qui si schiacciava tutto su `fr` tranne `en`: chi
    // aveva ordinato in italiano apriva «Annuler ma commande» in francese.
    // Il link dell'email non porta la lingua, quindi questa risposta e' l'UNICO
    // modo che il sito ha di saperla. Si ripiega su `fr` solo se manca o non e'
    // una lingua che il motore conosce; l'elenco sta in un posto solo.
    lang: PUBLIC_LANG_CODES.includes(String(data.lang)) ? String(data.lang) : "fr",
  });
};

// POST { token } → annulla (solo pending) + fa scadere la sessione Stripe,
// così il link di pagamento non può più incassare un ordine annullato.
export const POST: APIRoute = async ({ request }) => {
  // ⚠️ AGGREGATO, chiesto per nome. L'ordine si trova con il suo token di
  // annullo, che e' un segreto: il token E' l'autorizzazione. Filtrare per
  // sede non protegge niente in piu' e romperebbe l'annullo di ogni punto
  // che non sia il primo — il cliente clicca il link e non succede niente.
  const ambito = tutteLeSedi();
  let body: { token?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* token solo nel body */
  }
  const token = String(body.token ?? "");
  if (!RE_UUID.test(token)) return json({ error: "invalid" }, 404);

  const { data: ordine } = await leggi("orders", ambito, "id, status, stripe_session_id")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!ordine) return json({ error: "invalid" }, 404);
  if (ordine.status === "cancelled") return json({ ok: true }); // idempotente
  if (ordine.status !== "pending") return json({ error: "paid" }, 409);

  const { error } = await aggiorna("orders", ambito, { status: "cancelled" })
    .eq("id", ordine.id)
    .eq("status", "pending");
  if (error) return json({ error: "server" }, 500);

  // La sessione Stripe viene fatta scadere (l'id cs_… può essere nell'URL salvato)
  const m = /cs_(?:test|live)_[A-Za-z0-9]+/.exec(String(ordine.stripe_session_id ?? ""));
  if (m) {
    try {
      // La sessione da far scadere vive nel conto che l'aveva creata: quello
      // della sede dell'ordine. Con la chiave di un'altra societa' Stripe
      // risponderebbe «no such checkout session» e il link resterebbe vivo.
      const sp = await stripeDi(await cercaAmbito("orders", String(ordine.id), ambito));
      await sp.checkout.sessions.expire(m[0]);
    } catch {
      /* già scaduta o pagata nel frattempo: non bloccante */
    }
  }
  return json({ ok: true });
};
